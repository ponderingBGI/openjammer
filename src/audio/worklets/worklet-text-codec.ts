/**
 * `TextDecoder` polyfill for `AudioWorkletGlobalScope` (browser tier keystone).
 *
 * The wasm-bindgen `--target web` glue (`../wasm/pkg/ojcore_wasm.js`) constructs a
 * `TextDecoder` at MODULE TOP LEVEL (`let cachedTextDecoder = new TextDecoder(...)`).
 * But `TextDecoder` is NOT defined in `AudioWorkletGlobalScope` in Chromium, Firefox,
 * or WebKit — so that top-level line throws `ReferenceError: TextDecoder is not
 * defined` while the worklet module is being evaluated. `audioWorklet.addModule()`
 * RESOLVES anyway (module-evaluation errors in a worklet don't reject the promise),
 * but the `registerProcessor('ojcore-processor', …)` call further down NEVER RUNS —
 * so `new AudioWorkletNode(ctx, 'ojcore-processor')` throws `InvalidStateError` in
 * EVERY browser and the entire "play here in your browser" tier produces no sound.
 *
 * This module installs a minimal UTF-8 `TextDecoder` into the worklet global BEFORE
 * the glue is imported (it is imported FIRST in `ojcore-processor.ts`; ES import side
 * effects run in source order, so the polyfill lands before the glue's top-level
 * `new TextDecoder()`). The glue only ever decodes short UTF-8 strings (wasm error /
 * panic messages via `getStringFromWasm0`), so a compact spec-correct UTF-8 decoder
 * is sufficient; we do NOT touch the global if a real `TextDecoder` already exists.
 *
 * Off any render path — this runs once, at module load, before `process()` is ever
 * called. The audio thread allocates nothing here.
 */

// Self-contained UTF-8 decoder. Handles 1–4 byte sequences and the BOM (which the
// glue constructs with `{ ignoreBOM: true }`, i.e. the BOM is kept as U+FEFF — we
// match that by NOT stripping it). `fatal: true` is requested by the glue; on a
// malformed sequence we emit U+FFFD rather than throw, which is safe for the only
// caller (diagnostic error strings) and never corrupts the audio path.
function decodeUtf8(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    const n = bytes.length;
    while (i < n) {
        const b0 = bytes[i++];
        let cp: number;
        if (b0 < 0x80) {
            cp = b0;
        } else if (b0 >= 0xc0 && b0 < 0xe0 && i < n) {
            cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0 && i + 1 < n) {
            cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xf0 && i + 2 < n) {
            cp =
                ((b0 & 0x07) << 18) |
                ((bytes[i++] & 0x3f) << 12) |
                ((bytes[i++] & 0x3f) << 6) |
                (bytes[i++] & 0x3f);
        } else {
            cp = 0xfffd; // malformed lead / truncated tail
        }
        if (cp > 0xffff) {
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
            out += String.fromCharCode(cp);
        }
    }
    return out;
}

class WorkletTextDecoder {
    readonly encoding = 'utf-8';
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    constructor(_label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) {
        this.fatal = options?.fatal ?? false;
        this.ignoreBOM = options?.ignoreBOM ?? false;
    }
    decode(input?: ArrayBufferView | ArrayBuffer): string {
        if (input === undefined) return '';
        const bytes =
            input instanceof Uint8Array
                ? input
                : ArrayBuffer.isView(input)
                  ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
                  : new Uint8Array(input);
        return decodeUtf8(bytes);
    }
}

// Only install if the host worklet scope lacks the real one (future browsers may
// add it). `globalThis` is the AudioWorkletGlobalScope here.
const g = globalThis as unknown as { TextDecoder?: unknown };
if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = WorkletTextDecoder as unknown as typeof TextDecoder;
}

// Touch the export so a side-effect-pruning bundler can never drop this module.
export const WORKLET_TEXT_CODEC_INSTALLED = true;
