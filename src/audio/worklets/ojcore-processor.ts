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
type InboundMsg = InitMsg | GraphMsg | CommandMsg;

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
            }
        } catch (err) {
            this.port.postMessage({ type: 'error', message: String(err) });
        }
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
        // output channels.
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
        return true;
    }
}

registerProcessor('ojcore-processor', OjcoreProcessor);
