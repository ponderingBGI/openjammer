/**
 * Configured render quantum (frames per [`process`] call / `output` length).
 * @returns {number}
 */
export function block_size() {
    const ret = wasm.block_size();
    return ret >>> 0;
}

/**
 * Total byte length of the command ring struct (header + data region).
 * @returns {number}
 */
export function cmd_ring_len() {
    const ret = wasm.cmd_ring_len();
    return ret >>> 0;
}

/**
 * Base pointer of the command ring inside wasm linear memory. JS lays a
 * `SharedArrayBuffer` view over `[cmd_ring_ptr, cmd_ring_ptr + cmd_ring_len)`
 * and uses the `*_offset` getters below to find the header fields and data.
 * @returns {number}
 */
export function cmd_ring_ptr() {
    const ret = wasm.cmd_ring_ptr();
    return ret >>> 0;
}

/**
 * Encode an [`RtCommand`] as the JSON frame the command ring expects. Helper
 * for tests / a JS-side mirror; not on the render path. Returns the bytes a
 * producer would `push` into the [`cmd_ring`](Host::cmd_ring).
 * @param {number} node
 * @param {number} param
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encode_command_setparam(node, param, value) {
    const ret = wasm.encode_command_setparam(node, param, value);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Initialize the engine host. Call ONCE from the AudioWorklet constructor,
 * before any [`process`] call.
 *
 * Allocates everything up front: the registry (with built-ins), an empty
 * engine, the command/MIDI rings, and the `block_size`-long output buffer. A
 * second call re-initializes from scratch (the previous host is dropped here,
 * off the render path).
 *
 * `block_size` must be the worklet's render quantum (typically 128).
 * @param {number} sample_rate
 * @param {number} block_size
 */
export function init(sample_rate, block_size) {
    wasm.init(sample_rate, block_size);
}

/**
 * Compile and install a serialized [`OjGraph`] (serde JSON `bytes`).
 *
 * Runs OFF the render path: compilation allocates (instances, routing, scratch
 * buffers), then [`Engine::install`] swaps the new program in. The old program
 * is returned by `install` and dropped here — never on the audio thread.
 *
 * Returns `true` on success. On a malformed payload or a compile error it
 * leaves the running program untouched and returns `false`, so a bad graph can
 * never silence or crash a live engine.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function load_graph(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.load_graph(ptr0, len0);
    return ret !== 0;
}

/**
 * Total byte length of the MIDI ring struct (header + data region).
 * @returns {number}
 */
export function midi_ring_len() {
    const ret = wasm.midi_ring_len();
    return ret >>> 0;
}

/**
 * Base pointer of the MIDI ring inside wasm linear memory (worker -> worklet).
 * @returns {number}
 */
export function midi_ring_ptr() {
    const ret = wasm.midi_ring_ptr();
    return ret >>> 0;
}

/**
 * Number of compiled nodes in the engine's current program, as a coarse
 * liveness probe for JS (`0` == not initialized; `1` == bootstrap silence; `>1`
 * == a real graph is loaded).
 * @returns {number}
 */
export function node_count() {
    const ret = wasm.node_count();
    return ret >>> 0;
}

/**
 * Pointer (byte offset into wasm linear memory) of the mono output buffer.
 * JS reads `nframes` little-endian f32s starting here after each [`process`].
 * @returns {number}
 */
export function output_ptr() {
    const ret = wasm.output_ptr();
    return ret >>> 0;
}

/**
 * Render one block. The AudioWorklet calls this every render quantum.
 *
 * Steps, all allocation-free:
 *   1. drain the command ring, applying each [`RtCommand`] to the engine;
 *   2. render `nframes` into the pre-sized output buffer.
 *
 * `nframes` is clamped to the configured block size. Read the result from
 * [`output_ptr`] (`nframes` f32s of mono master output).
 * @param {number} nframes
 */
export function process(nframes) {
    wasm.process(nframes);
}

/**
 * Byte offset of the `capacity` field within a ring.
 * @returns {number}
 */
export function ring_capacity_offset() {
    const ret = wasm.ring_capacity_offset();
    return ret >>> 0;
}

/**
 * Byte offset of the first data byte within a ring.
 * @returns {number}
 */
export function ring_data_offset() {
    const ret = wasm.ring_data_offset();
    return ret >>> 0;
}

/**
 * Byte offset of the `read` atomic index within a ring (consumer-owned).
 * @returns {number}
 */
export function ring_read_offset() {
    const ret = wasm.ring_read_offset();
    return ret >>> 0;
}

/**
 * Byte offset of the `write` atomic index within a ring (producer-owned).
 * @returns {number}
 */
export function ring_write_offset() {
    const ret = wasm.ring_write_offset();
    return ret >>> 0;
}

/**
 * Configured sample rate.
 * @returns {number}
 */
export function sample_rate() {
    const ret = wasm.sample_rate();
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_ea4887a5f8f9a9db: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ojcore_wasm_bg.js": import0,
    };
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('ojcore_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
