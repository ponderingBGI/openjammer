// AudioWorklet global scope (AudioWorkletProcessor, registerProcessor, sampleRate)
// is declared ambiently in worklet-types.d.ts; these are globals, not module
// exports, so a triple-slash reference is the correct way to pull them in.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./worklet-types.d.ts" />
/**
 * ojcore AudioWorklet processor (U17) — runs the wasm `ojcore` engine on the
 * audio render thread and feeds its mono master output into the AudioContext.
 *
 * This is the wasm half of the cutover's browser path. It owns the wasm Host
 * (`init` / `process` / `load_graph`) on its single processor thread, exactly as
 * `crates/ojcore-wasm/src/lib.rs` documents (the host lives in one `static mut`
 * touched only from this thread).
 *
 * ── Control transport: postMessage fallback (SAB upgrade documented) ─────────
 * The standard `wasm32-unknown-unknown` build produces NON-shared linear memory,
 * so the UI thread cannot lay a `SharedArrayBuffer` view over the wasm cmd ring.
 * We therefore deliver graphs and RtCommands via `postMessage`, and write the
 * command into the wasm cmd ring HERE (same thread as the Host), in the exact
 * length-prefixed LE frame format `ojcore-midiring` expects, so `process`'s
 * `drain_commands` consumes them unchanged. To UPGRADE to the true zero-latency
 * SAB path: build the crate with shared memory + atomics (a `+atomics,+bulk-
 * memory` build-std target), import that shared `WebAssembly.Memory` here, and
 * move the ring writes in {@link OjcoreProcessor.pushCommandFrame} to the UI
 * thread over the SAB — the frame format and ring offsets are already identical.
 *
 * Message protocol (UI -> worklet):
 *   { type: 'init',   module: WebAssembly.Module, blockSize: number }
 *   { type: 'graph',  bytes: Uint8Array }     // serde-JSON OjGraph
 *   { type: 'command', bytes: Uint8Array }    // serde-JSON RtCommand frame
 *   { type: 'load-sample', node, pcm, sampleRate, rootNote }  // sampler live-load
 * Worklet -> UI:
 *   { type: 'ready' } | { type: 'graph-ack', ok: boolean } | { type: 'error', message }
 *   { type: 'sample-stored', node, assetId, rootNote }        // sampler live-load ack
 *
 * ── Microphone input ─────────────────────────────────────────────────────────
 * When the UI wires a `MediaStreamSource` to this `AudioWorkletNode`'s input
 * (input 0), each {@link OjcoreProcessor.process} reads `inputs[0][0]` and copies
 * it into the engine's first `MicIn` node output buffer (via the wasm
 * `mic_in_ptr` / `mic_in_len` getters) BEFORE rendering, so the captured block
 * flows downstream that same render quantum. No `MicIn` node (or no input wired)
 * => the getters report a null/zero buffer and the copy is skipped.
 */

// MUST be the FIRST import: installs a `TextDecoder` into the AudioWorkletGlobalScope
// before the wasm-bindgen glue below runs its module-top-level `new TextDecoder()`.
// `TextDecoder` is undefined in worklet scope, so without this the glue throws at
// module-eval time and `registerProcessor` (further down) never runs — the dead
// browser engine. ES import side effects run in source order, so this lands first.
import { WORKLET_TEXT_CODEC_INSTALLED } from './worklet-text-codec';

// The wasm-bindgen `--target web` glue (committed under ../wasm/pkg). We need its
// SYNCHRONOUS `initSync(bytes)` — the worklet compiles + instantiates from the posted
// wasm bytes on this thread, with no fetch/await (see {@link InitMsg.bytes} for why
// bytes and not a `WebAssembly.Module`). The glue's DEFAULT export is `__wbg_init`
// (the ASYNC, fetch-based initializer), so importing
// the default and calling it as `initSync` silently instantiated nothing (it
// returned a Promise and treated the module object as a fetch path), leaving the
// `wasm` binding undefined — `wasm.init()` then threw and the engine never came up.
// Because the default-import path never referenced the real `initSync`, Rollup also
// tree-shook the synchronous instantiate out of the production bundle entirely. Pull
// the NAMED `initSync` so the side-effectful sync instantiate is kept and used.
// @ts-expect-error - generated JS module has no .d.ts (built by build-wasm.sh).
import { initSync } from '../wasm/pkg/ojcore_wasm.js';
// @ts-expect-error - generated JS module has no .d.ts (built by build-wasm.sh).
import * as wasm from '../wasm/pkg/ojcore_wasm.js';

interface InitMsg {
    type: 'init';
    /**
     * The RAW wasm bytes (transferred). We deliberately ship bytes, NOT a compiled
     * `WebAssembly.Module`: a `WebAssembly.Module` cannot be structured-cloned across
     * the agent-cluster boundary into an `AudioWorkletGlobalScope` — in a
     * cross-origin-isolated context Chromium SILENTLY DROPS such a message (no error
     * on the sender, `onmessage` never fires in the worklet), so the engine never
     * initialised and never posted `ready`. An `ArrayBuffer` clones/transfers
     * cleanly, and `initSync` compiles it on this thread (`new WebAssembly.Module`).
     */
    bytes: ArrayBuffer;
    blockSize: number;
}
interface GraphMsg {
    type: 'graph';
    bytes: Uint8Array;
}
interface CommandMsg {
    type: 'command';
    bytes: Uint8Array;
}
/** Enable/disable the per-node meter level stream back to the UI. */
interface MetersMsg {
    type: 'meters';
    enabled: boolean;
}
/** Install mono PCM as a node's sampler buffer (best-effort, see handler). */
interface LoadSampleMsg {
    type: 'load-sample';
    node: number;
    pcm: Float32Array;
    sampleRate: number;
    rootNote: number;
}
/** Begin capturing a node's output for the recorder. */
interface RecorderStartMsg {
    type: 'recorder-start';
    node: number;
}
/** Stop capturing and return the captured PCM. */
interface RecorderStopMsg {
    type: 'recorder-stop';
    node: number;
}
type InboundMsg =
    | InitMsg
    | GraphMsg
    | CommandMsg
    | MetersMsg
    | LoadSampleMsg
    | RecorderStartMsg
    | RecorderStopMsg;

/** Size in bytes of the ring's frame length prefix (mirrors LEN_PREFIX). */
const LEN_PREFIX = 4;

/** The wasm instance exports include the linear `WebAssembly.Memory`. */
interface WasmExports {
    memory: WebAssembly.Memory;
}

class OjcoreProcessor extends AudioWorkletProcessor {
    private ready = false;
    /** The instantiated wasm exports (carries `.memory`; the JS glue does not). */
    private exports: WasmExports | null = null;
    /** DataView over the wasm cmd ring (for writing command frames locally). */
    private ringBase = 0;
    private ringCapacity = 0;
    private offWrite = 0;
    private offRead = 0;
    private offData = 0;
    private blockSize = 128;

    /** Whether to drain + post per-node meter levels each block. */
    private metersEnabled = false;
    /** Block counter so meters are posted at ~UI rate, not every render quantum. */
    private meterTick = 0;
    /** Block counter so faults drain at a fixed cadence, not every render quantum. */
    private eventTick = 0;
    // NOTE: speaker volume / mute is NO LONGER a worklet concern. It is applied
    // ONCE by the engine via the SpeakerOut sink's `master_param` (VOLUME/MUTE)
    // `SetParam`s the executor sends over the command ring (exec.rs `master_gain`).
    // The old `master-gain` postMessage path scaled a SECOND time after the engine
    // and risked double-applying gain; it has been removed. The mono->channel copy
    // below is now a straight unity copy.
    /** Block counter so looper snapshots/edges drain at ~UI rate (every ~4 blocks),
     *  ungated by metering — the row/playhead must surface even with meters off. */
    private looperTick = 0;
    /** Blocks between fault drains (~10 Hz). Recomputed from the rate in init. */
    private eventDrainBlocks = 38;
    /** Per-node recorder captures: node id -> accumulated mono PCM chunks. */
    private captures = new Map<number, Float32Array[]>();

    constructor() {
        super();
        // Reference the codec-install flag so the side-effectful polyfill import
        // can never be tree-shaken out of the bundle (it must run before the glue).
        void WORKLET_TEXT_CODEC_INSTALLED;
        this.port.onmessage = (e: MessageEvent<InboundMsg>) => this.onMessage(e.data);
    }

    private onMessage(msg: InboundMsg): void {
        try {
            switch (msg.type) {
                case 'init':
                    this.handleInit(msg);
                    break;
                case 'graph':
                    this.handleGraph(msg.bytes);
                    break;
                case 'command':
                    this.pushCommandFrame(msg.bytes);
                    break;
                case 'meters':
                    this.metersEnabled = msg.enabled;
                    if (this.ready) wasm.set_metering(msg.enabled);
                    break;
                case 'load-sample':
                    this.handleLoadSample(msg);
                    break;
                case 'recorder-start':
                    this.captures.set(msg.node, []);
                    break;
                case 'recorder-stop':
                    this.handleRecorderStop(msg.node);
                    break;
            }
        } catch (err) {
            this.port.postMessage({ type: 'error', message: String(err) });
        }
    }

    /**
     * Install mono PCM as a node's sampler buffer (wasm sample live-load).
     *
     * Stores the transferred PCM in the wasm host's content-addressed asset store
     * (`store_asset` -> `AssetId`) and replies with that id. The UI binds the id
     * onto the node's `AssetRef` and re-pushes the graph, so the next
     * `load_graph` recompiles through `compile_with_assets` and the live Sampler
     * gets the sample via `DspInstance::load_asset` — mirroring the native flow.
     */
    private handleLoadSample(msg: LoadSampleMsg): void {
        if (!this.ready) return;
        const assetId = wasm.store_asset(msg.pcm, msg.sampleRate) as number;
        this.port.postMessage({
            type: 'sample-stored',
            node: msg.node,
            assetId,
            rootNote: msg.rootNote,
        });
    }

    /** Finish a capture and post its concatenated mono PCM back to the UI. */
    private handleRecorderStop(node: number): void {
        const chunks = this.captures.get(node);
        this.captures.delete(node);
        if (!chunks || chunks.length === 0) {
            this.port.postMessage({ type: 'recorder-data', node, pcm: new Float32Array(0) });
            return;
        }
        let total = 0;
        for (const c of chunks) total += c.length;
        const pcm = new Float32Array(total);
        let at = 0;
        for (const c of chunks) {
            pcm.set(c, at);
            at += c.length;
        }
        this.port.postMessage({ type: 'recorder-data', node, pcm, sampleRate }, [pcm.buffer]);
    }

    private handleInit(msg: InitMsg): void {
        // Synchronously compile + instantiate the posted wasm BYTES on THIS thread
        // (`initSync` does `new WebAssembly.Module(bytes)` then instantiates). We
        // pass bytes, not a `WebAssembly.Module`, because a Module can't be
        // structured-cloned into the worklet (see {@link InitMsg.bytes}). initSync
        // returns the wasm instance exports (which carry `.memory`; the JS glue
        // namespace does NOT re-export `memory`).
        this.exports = initSync({ module: msg.bytes }) as WasmExports;
        this.blockSize = msg.blockSize || 128;
        // Fault drain cadence: ~10 Hz (≈100 ms), matching the native poll loop, so a
        // persistent fault batches into one coalesced post instead of per-quantum.
        this.eventDrainBlocks = Math.max(1, Math.round(sampleRate / this.blockSize / 10));
        wasm.init(sampleRate, this.blockSize);

        // Cache the cmd-ring base + frozen header offsets so command writes are
        // pointer arithmetic, no per-frame export calls.
        this.ringBase = wasm.cmd_ring_ptr();
        this.offWrite = wasm.ring_write_offset();
        this.offRead = wasm.ring_read_offset();
        this.offData = wasm.ring_data_offset();
        // capacity == data length == cmd_ring_len - data offset.
        this.ringCapacity = wasm.cmd_ring_len() - this.offData;

        // Honour any meter-enable requested before init completed.
        if (this.metersEnabled) wasm.set_metering(true);

        this.ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    private handleGraph(bytes: Uint8Array): void {
        if (!this.ready) return;
        const ok = wasm.load_graph(bytes) as boolean;
        this.port.postMessage({ type: 'graph-ack', ok });
    }

    /**
     * Write one length-prefixed RtCommand JSON frame into the wasm cmd ring,
     * matching `ojcore_midiring::ByteRing::push`: a 4-byte LE length prefix then
     * the payload, both modulo capacity, publishing the new write index last.
     * Single-producer here (this thread), so a plain (non-atomic) store of the
     * write index is sound for the local-ring fallback.
     */
    private pushCommandFrame(payload: Uint8Array): void {
        if (!this.ready || !this.exports) return;
        const mem = new DataView(this.exports.memory.buffer);
        const cap = this.ringCapacity;
        const frame = LEN_PREFIX + payload.length;
        if (frame > cap - LEN_PREFIX) return; // too large for the ring

        const write = mem.getUint32(this.ringBase + this.offWrite, true);
        const read = mem.getUint32(this.ringBase + this.offRead, true);
        const used = (write - read) >>> 0;
        if (frame > cap - used) return; // ring full; drop (control-rate, non-fatal)

        const dataBase = this.ringBase + this.offData;
        const mask = cap - 1;
        // length prefix (LE u32)
        const lenBytes = new Uint8Array(4);
        new DataView(lenBytes.buffer).setUint32(0, payload.length, true);
        let at = write & mask;
        for (let i = 0; i < 4; i++) {
            mem.setUint8(dataBase + ((at + i) & mask), lenBytes[i]);
        }
        at = (write + LEN_PREFIX) & mask;
        for (let i = 0; i < payload.length; i++) {
            mem.setUint8(dataBase + ((at + i) & mask), payload[i]);
        }
        // publish new write index (Release on the Rust side; plain store here).
        mem.setUint32(this.ringBase + this.offWrite, (write + frame) >>> 0, true);
    }

    /**
     * Copy the captured microphone block (input 0, channel 0) into the engine's
     * `MicIn` node output buffer. The wasm `mic_in_ptr`/`mic_in_len` getters point
     * at the live program's MicIn buffer (recomputed each call since the slot
     * layout changes across graph swaps); a null pointer / zero length means there
     * is no MicIn node, so the mic is simply not routed and we do nothing.
     */
    private feedMicInput(inputs: Float32Array[][]): void {
        if (!this.exports) return;
        const micChannel = inputs[0]?.[0];
        if (!micChannel || micChannel.length === 0) return; // no input wired
        const len = wasm.mic_in_len() as number;
        if (len === 0) return; // no MicIn node in the live graph
        const ptr = wasm.mic_in_ptr() as number;
        if (ptr === 0) return;
        const dst = new Float32Array(this.exports.memory.buffer, ptr, len);
        const n = Math.min(micChannel.length, len);
        dst.set(micChannel.subarray(0, n));
        // Zero any tail beyond the captured block so a short input never leaves
        // stale samples from a previous block playing through the engine.
        for (let i = n; i < len; i++) dst[i] = 0;
    }

    /**
     * STAGE-3 finalize-PCM (wasm): given the JSON `events` bytes the looper-edge
     * drain produced, find every COMMIT edge (a looper transition into Playing=3
     * from Recording=2 / Overdubbing=4) and, for each committed node, read the
     * just-committed layer's true PCM via the `looper_take_pcm` export and post it
     * to the UI as `{ type:'looper-take', node, pcm, sampleRate }` (the PCM buffer
     * transferred). The committed layer is read-only on the render path, so this
     * read between `process` calls is sound (like `output_ptr`).
     *
     * Off the hot path: edges arrive at most every ~4 blocks and only when a
     * transition happened, so the JSON parse + copy here is rare. A parse failure
     * is swallowed (the edge still rides the `events` message; only the waveform
     * upgrade is skipped) so a bad frame never silences the engine.
     */
    private postCommittedLooperTakes(eventBytes: Uint8Array): void {
        const PLAYING = 3;
        const RECORDING = 2;
        const OVERDUBBING = 4;
        let events: unknown;
        try {
            events = JSON.parse(new TextDecoder().decode(eventBytes));
        } catch {
            return; // not parseable; the edge still rides the events message
        }
        if (!Array.isArray(events)) return;
        for (const ev of events) {
            const edge = (ev as { kind?: { LooperEdge?: { node: number; from: number; to: number } } })
                ?.kind?.LooperEdge;
            if (!edge) continue;
            if (edge.to !== PLAYING) continue;
            if (edge.from !== RECORDING && edge.from !== OVERDUBBING) continue;
            // A commit: pull the committed take's PCM and ship it to the UI.
            const pcm = wasm.looper_take_pcm(edge.node) as Float32Array;
            if (pcm && pcm.length > 0) {
                this.port.postMessage(
                    { type: 'looper-take', node: edge.node, pcm, sampleRate },
                    [pcm.buffer],
                );
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this.ready || !this.exports) return true;

        const out = outputs[0];
        if (!out || out.length === 0) return true;
        const frames = out[0].length;

        // Mic input: copy this block's captured samples (input 0, channel 0) into
        // the engine's first `MicIn` node output buffer BEFORE rendering, so the
        // mic flows downstream this same quantum. `mic_in_ptr` is null (and
        // `mic_in_len` 0) when the graph has no MicIn node or no input is wired,
        // in which case the copy is skipped.
        this.feedMicInput(inputs);

        // Render one block into the wasm output buffer, then copy mono -> all
        // output channels at UNITY. Speaker volume / mute is already baked into the
        // engine's master mix (SpeakerOut `master_param` -> exec.rs `master_gain`),
        // so a second scale here would DOUBLE-apply gain — the worklet stays a
        // straight copy.
        wasm.process(frames);
        const ptr = wasm.output_ptr();
        const mono = new Float32Array(this.exports.memory.buffer, ptr, Math.min(frames, this.blockSize));
        for (let ch = 0; ch < out.length; ch++) {
            const channel = out[ch];
            const n = Math.min(channel.length, mono.length);
            channel.set(mono.subarray(0, n));
            // zero any tail beyond the rendered block
            for (let i = n; i < channel.length; i++) channel[i] = 0;
        }

        // Recorder: append a COPY of this block's mono master to every active
        // capture (the engine's per-node bus is not separately readable here, so
        // the recorder captures the master mix — the common "record the output"
        // case). Off the SAB ring; a plain copy per active capture.
        if (this.captures.size > 0) {
            const n = Math.min(frames, mono.length);
            for (const chunks of this.captures.values()) {
                chunks.push(mono.slice(0, n));
            }
        }

        // Meters: drain the engine's per-node levels at ~UI rate (every ~4 blocks
        // == ~10 ms @ 48k/128) and post them to the UI. The drain resets each
        // window so the next batch is fresh.
        if (this.metersEnabled) {
            this.meterTick++;
            if (this.meterTick >= 4) {
                this.meterTick = 0;
                const flat = wasm.drain_meters() as Float32Array;
                if (flat && flat.length >= 2) {
                    const levels: Array<{ node: number; peak: number }> = [];
                    for (let i = 0; i + 1 < flat.length; i += 2) {
                        levels.push({ node: flat[i], peak: flat[i + 1] });
                    }
                    this.port.postMessage({ type: 'meters', levels });
                }
            }
        }

        // Looper transport: drain every looper node's snapshot + any commit edge
        // and post them to the UI, UNCONDITIONALLY (outside the `metersEnabled`
        // block) — the looper's row/playhead must surface even when level meters
        // are off (mirrors the native ungated `publish_looper`). Snapshots ride a
        // dedicated `looper` message; an edge (the AUTHORITATIVE row-create signal,
        // never dropped) rides the SAME `events` message the fault pipe uses, so
        // the LooperEdge tag reaches the looper handle through one seam. The drain
        // runs at the meter cadence (~10 ms) — fast enough for a smooth playhead,
        // and the per-block kernel snapshot is coalesced to the latest each tick.
        this.looperTick++;
        if (this.looperTick >= 4) {
            this.looperTick = 0;
            const lframes = wasm.drain_looper() as Float32Array;
            if (lframes && lframes.length >= 5) {
                this.port.postMessage({ type: 'looper', frames: lframes }, [lframes.buffer]);
            }
            const ebytes = wasm.drain_looper_edges() as Uint8Array;
            if (ebytes && ebytes.length > 0) {
                // STAGE-3 finalize-PCM: BEFORE transferring the edge bytes (which
                // detaches the buffer), scan them for COMMIT edges
                // (Recording=2|Overdubbing=4 -> Playing=3). For each committed
                // looper node, read the just-committed layer's TRUE PCM off the
                // (read-only) render buffer via `looper_take_pcm` and postMessage
                // it to the UI so the row gets a real AudioBuffer (true waveform +
                // drag-to-library/export). Read PCM first, THEN transfer `ebytes`.
                this.postCommittedLooperTakes(ebytes);
                this.port.postMessage({ type: 'events', bytes: ebytes }, [ebytes.buffer]);
            }
        }

        // Faults: surface engine node-faults (NaN/garbage) to the UI fault pipe at a
        // FIXED cadence (~10 Hz), NOT every render quantum. A persistent fault latches
        // its NodeBudget flag every block until drained, so draining per-block would
        // post a single-event message ~375×/s and storm the main thread + DevLog ring
        // — `ingestEngineEvents` only coalesces WITHIN one batch. Throttling lets the
        // flags accumulate so one drain coalesces them. UNCONDITIONAL (not gated on
        // `metersEnabled`): a fault must reach the DevLog whether or not a meter UI is
        // mounted (the lesson the native poll loop encodes). `has_pending_events` is a
        // cheap alloc-free bool scan; the allocating `drain_events` runs only at the
        // cadence boundary AND only when a fault is pending, so fault-free blocks cost
        // nothing on the render path.
        this.eventTick++;
        if (this.eventTick >= this.eventDrainBlocks) {
            this.eventTick = 0;
            if (wasm.has_pending_events() as boolean) {
                const bytes = wasm.drain_events() as Uint8Array;
                if (bytes && bytes.length > 0) {
                    this.port.postMessage({ type: 'events', bytes }, [bytes.buffer]);
                }
            }
        }
        return true;
    }
}

registerProcessor('ojcore-processor', OjcoreProcessor);
