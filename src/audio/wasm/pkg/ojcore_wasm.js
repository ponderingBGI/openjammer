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
 * Drain the current per-node + master meter windows as a FLAT `[node, peak, ...]`
 * `f32` array (node ids are exact integers within `f32`'s safe range for any
 * realistic node count). The master level is appended last under the master
 * node's id. Resets each window (uses `Meter::take`), so calling once per block
 * yields a fresh peak each time. Returns an empty vec when metering is off or
 * the host is not initialized. Off the render path (the worklet calls it between
 * `process` calls), so the `Vec` allocation here is fine.
 * @returns {Float32Array}
 */
export function drain_meters() {
    const ret = wasm.drain_meters();
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
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
 * Encode a `Meter` [`EngineFrame`] to JSON — a convenience mirror for tests /
 * JS so the wasm meter shape matches the native event payload. Not on the
 * render path.
 * @param {number} node
 * @param {number} rms
 * @param {number} peak
 * @returns {Uint8Array}
 */
export function encode_meter_frame(node, rms, peak) {
    const ret = wasm.encode_meter_frame(node, rms, peak);
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
 * Length (in f32s) of the `MicIn` output buffer the worklet may write — the
 * configured block size — or `0` when the program has no `MicIn` node. Pairs
 * with [`mic_in_ptr`]; the worklet clamps its write to this.
 * @returns {number}
 */
export function mic_in_len() {
    const ret = wasm.mic_in_len();
    return ret >>> 0;
}

/**
 * Pointer (byte offset into wasm linear memory) of the FIRST `MicIn` node's
 * output buffer (port 0), or null if the live program has no `MicIn`.
 *
 * The worklet writes one block of microphone samples here BEFORE each
 * [`process`] call; the executor leaves external-source output buffers intact
 * (see `Engine::input_mut` / the exec loop's `MicIn` arm), so whatever lands
 * here flows downstream this block. Recomputed each call from the live program
 * because the master/slot layout changes across `load_graph` swaps.
 * @returns {number}
 */
export function mic_in_ptr() {
    const ret = wasm.mic_in_ptr();
    return ret >>> 0;
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

/**
 * Enable or disable per-node + master level metering on the wasm engine. Cheap
 * (a single bool); when off the render loop skips all `accumulate` calls. The
 * worklet enables this when the UI subscribes to signal levels and drains the
 * levels each block via [`drain_meters`].
 * @param {boolean} on
 */
export function set_metering(on) {
    wasm.set_metering(on);
}

/**
 * Store decoded mono `pcm` (captured at `sample_rate` Hz) in the host's PCM
 * store and return its content-addressed [`AssetId`] (an integer the JS side
 * then binds onto the node's [`ojproto::AssetRef`] and re-pushes the graph with,
 * so the next [`load_graph`] resolves + installs it into the live Sampler).
 *
 * Off the RT thread (the worklet calls it from a control message, between
 * `process` calls). Returns `0` if the host is not initialized — `0` is a valid
 * content address only for a degenerate input, so the JS side treats it as "not
 * stored" only when the host is absent (it checks `ready` first).
 * @param {Float32Array} pcm
 * @param {number} sample_rate
 * @returns {number}
 */
export function store_asset(pcm, sample_rate) {
    const ptr0 = passArrayF32ToWasm0(pcm, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.store_asset(ptr0, len0, sample_rate);
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

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
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

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
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
    cachedFloat32ArrayMemory0 = null;
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
