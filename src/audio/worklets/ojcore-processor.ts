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
 * Worklet -> UI:
 *   { type: 'ready' } | { type: 'graph-ack', ok: boolean } | { type: 'error', message }
 */

// The wasm-bindgen `--target web` glue (committed under ../wasm/pkg). Imported
// for its `initSync` (synchronous instantiate from a posted Module) + exports.
// @ts-expect-error - generated JS module has no .d.ts (built by build-wasm.sh).
import initSync, * as wasm from '../wasm/pkg/ojcore_wasm.js';

interface InitMsg {
    type: 'init';
    module: WebAssembly.Module;
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
/** Scale the master output (speaker volume). */
interface MasterGainMsg {
    type: 'master-gain';
    gain: number;
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
    | MasterGainMsg
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
    /** Master output scale (speaker volume). */
    private masterGain = 1;
    /** Per-node recorder captures: node id -> accumulated mono PCM chunks. */
    private captures = new Map<number, Float32Array[]>();

    constructor() {
        super();
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
                case 'master-gain':
                    this.masterGain = Math.max(0, msg.gain);
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
     * Install mono PCM as a node's sampler buffer.
     *
     * TODO(wasm-parity): the wasm engine's `DspInstance` trait has no sample-load
     * hook reachable from here (adding one is an `ojcore`/`ojinstrument` change
     * outside this lane). Until that lands, the worklet records that the PCM
     * arrived (so the UI's load flow completes) but cannot yet install it into the
     * live engine sampler instance. The audible sampler still plays whatever the
     * graph compiled; the buffer-install is the documented gap.
     */
    private handleLoadSample(_msg: LoadSampleMsg): void {
        // Intentionally a no-op against the engine for now (see TODO above).
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
        // Synchronously instantiate the posted compiled module on THIS thread.
        // initSync returns the wasm instance exports (which carry `.memory`; the
        // JS glue namespace does NOT re-export `memory`).
        this.exports = initSync({ module: msg.module }) as WasmExports;
        this.blockSize = msg.blockSize || 128;
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

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this.ready || !this.exports) return true;

        const out = outputs[0];
        if (!out || out.length === 0) return true;
        const frames = out[0].length;

        // Render one block into the wasm output buffer, then copy mono -> all
        // output channels (scaled by the master gain / speaker volume).
        wasm.process(frames);
        const ptr = wasm.output_ptr();
        const mono = new Float32Array(this.exports.memory.buffer, ptr, Math.min(frames, this.blockSize));
        const gain = this.masterGain;
        for (let ch = 0; ch < out.length; ch++) {
            const channel = out[ch];
            const n = Math.min(channel.length, mono.length);
            if (gain === 1) {
                channel.set(mono.subarray(0, n));
            } else {
                for (let i = 0; i < n; i++) channel[i] = mono[i] * gain;
            }
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
        return true;
    }
}

registerProcessor('ojcore-processor', OjcoreProcessor);
