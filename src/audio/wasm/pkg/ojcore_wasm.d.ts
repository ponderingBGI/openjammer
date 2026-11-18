/* tslint:disable */

/**
 * Configured render quantum (frames per [`process`] call / `output` length).
 */
export function block_size(): number;

/**
 * Total byte length of the command ring struct (header + data region).
 */
export function cmd_ring_len(): number;

/**
 * Base pointer of the command ring inside wasm linear memory. JS lays a
 * `SharedArrayBuffer` view over `[cmd_ring_ptr, cmd_ring_ptr + cmd_ring_len)`
 * and uses the `*_offset` getters below to find the header fields and data.
 */
export function cmd_ring_ptr(): number;

/**
 * Drain the engine's per-node resilience flags into a JSON `Vec<Event>` — the
 * SAME wire shape the native `poll_events` returns, so the one TS fault pipe
 * ingests both tiers identically.
 *
 * The RT event RING and the CPU watchdog are `std`-only, so the wasm tier
 * surfaces faults straight from `ojcore::NodeBudget` (the `no_std` NaN/garbage guard
 * `sanitize` sets `non_finite` from the render path) — exactly how
 * [`drain_meters`] reads `meters_mut`. Consumed flags are CLEARED so each fault
 * surfaces once per drain window; a persistently-bad node re-raises next block
 * and the TS coalescer collapses the storm (parity with native). Returns an
 * empty `Vec` (no allocation) when there is no fault — the common case. Off the
 * critical path: a fault means something is already wrong, so the rare alloc is
 * fine, mirroring `drain_meters`.
 */
export function drain_events(): Uint8Array;

/**
 * Drain every looper node's transport snapshot as a FLAT
 * `[node, state, pos, loop_len, peak, ...]` `f32` array (one 5-tuple per looper
 * node). The wasm tier has no return-frame ring (those are `std`-only), so this
 * reads each looper instance's [`ojcore::DspInstance::looper_snapshot`] DIRECTLY
 * — exactly how [`drain_meters`] reads `meters_mut` instead of a ring. UNGATED by
 * metering: the looper's row/playhead must surface even when level meters are
 * off (the looper return path is published every block on native, ungated too —
 * see `exec.rs::publish_looper`). Off the render path (the worklet calls it
 * between `process` calls), so the `Vec` allocation is fine; an empty `Vec` when
 * there are no looper nodes / no host costs nothing on the common path.
 */
export function drain_looper(): Float32Array;

/**
 * Drain any pending looper state-machine EDGE per looper node as a JSON
 * `Vec<Event>` of [`EventKind::LooperEdge`] — the SAME wire shape `drain_events`
 * (faults) returns, so the worklet rides them on the existing `events`
 * postMessage and the one TS fault-pipe seam routes the LooperEdge tag (a commit
 * signal, not a fault) to the looper handle. UNGATED, off the render path: an
 * edge (cycle wrap / STOP commit) is the AUTHORITATIVE row-create signal and must
 * never be dropped, so unlike snapshots it is loss-proof per-node (the kernel
 * coalesces onto one pending slot until drained). Returns an empty `Vec` (no
 * allocation) when no looper edge is pending — the common case.
 */
export function drain_looper_edges(): Uint8Array;

/**
 * Drain the current per-node + master meter windows as a FLAT `[node, peak, ...]`
 * `f32` array (node ids are exact integers within `f32`'s safe range for any
 * realistic node count). The master level is appended last under the master
 * node's id. Resets each window (uses `Meter::take`), so calling once per block
 * yields a fresh peak each time. Returns an empty vec when metering is off or
 * the host is not initialized. Off the render path (the worklet calls it between
 * `process` calls), so the `Vec` allocation here is fine.
 */
export function drain_meters(): Float32Array;

/**
 * Drain the engine's authoritative transport snapshot as the JSON
 * [`ojproto::EngineFrame::Transport`] — **the same frame** the native tier
 * pushes onto its `std`-only meter ring, produced by the **same** single
 * assembler (`ojcore::Engine::transport_frame`). Two encodings of one contract,
 * not a second transport protocol: native encodes it into
 * `meter::return_frame::encode_transport`, the worklet ships this JSON straight
 * through the `transport` postMessage the executor already parses.
 *
 * **This is the browser tier's only way to ACKNOWLEDGE a transport command.**
 * Without it `arrangementStore`'s 1500 ms `armPendingTransportTimeout` fires on
 * every Play and the player is told "the audio engine did not acknowledge the
 * transport command" — while the engine was in fact rolling perfectly. It is
 * therefore UNGATED by metering (a meter toggle must never be able to silence
 * the transport), exactly like the looper return path.
 *
 * The wasm tier has no return-frame ring (those are `std`-only), so this reads
 * the engine directly — exactly how [`drain_meters`] reads `meters_mut`. Called
 * by the worklet every 4 render quanta — every ~10 ms, i.e. **~94x/s** at
 * 48 kHz / 128 — not per block.
 */
export function drain_transport(): Uint8Array;

/**
 * Encode an [`RtCommand`] as the JSON frame the command ring expects. Helper
 * for tests / a JS-side mirror; not on the render path. Returns the bytes a
 * producer would `push` into the host's command ring.
 */
export function encode_command_setparam(node: number, param: number, value: number): Uint8Array;

/**
 * Encode a `Meter` [`EngineFrame`] to JSON — a convenience mirror for tests /
 * JS so the wasm meter shape matches the native event payload. Not on the
 * render path.
 */
export function encode_meter_frame(node: number, rms: number, peak: number): Uint8Array;

/**
 * True when the engine has at least one pending node-fault flag. A cheap
 * O(nodes) bool scan with NO allocation — the worklet calls it every block and
 * only invokes [`drain_events`] when it is set, so the (allocating) event
 * serialization never runs on a fault-free block. NOT gated on metering: a fault
 * must surface even when no meter UI is subscribed.
 */
export function has_pending_events(): boolean;

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
 */
export function init(sample_rate: number, block_size: number): void;

/**
 * The IR node ids (`NodeIdx.0`) that degraded to a passthrough stub in the last
 * [`load_graph`] — returned to JS as a `Uint32Array` so the worklet can badge the
 * exact nodes (the browser analogue of the native `push_graph` degraded-id
 * return). Empty on a clean load.
 */
export function last_degraded_node_ids(): Uint32Array;

/**
 * Number of nodes that degraded to a passthrough stub in the last [`load_graph`]
 * (a missing or incompatible plugin dependency). The worklet reads this after a
 * load to warn — the browser analogue of the native host's degraded-stub log (#4a).
 */
export function last_load_degraded(): number;

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
 */
export function load_graph(bytes: Uint8Array): boolean;

/**
 * Install a serialized [`TempoMap`] beside [`load_graph`].
 */
export function load_tempo_map(bytes: Uint8Array): boolean;

/**
 * Install a serialized authored [`Timeline`] beside [`load_graph`].
 */
export function load_timeline(bytes: Uint8Array): boolean;

/**
 * Copy the MOST-RECENTLY-COMMITTED layer's loop PCM for looper `node` into a
 * fresh `Float32Array` (`loop_len` mono f32s), or an empty array when the node
 * is not a looper / has no committed layer yet. This is the WASM end of the
 * Stage-3 finalize-PCM seam: when the worklet drains a commit `LooperEdge` for
 * `node` (the Recording|Overdubbing→Playing edge from [`drain_looper_edges`]),
 * it calls this and `postMessage`s the bytes so the UI can build the real
 * `AudioBuffer` for that layer's row (true waveform + drag-to-library/export).
 *
 * The committed layer is read-only on the render path (only read back for
 * playback, never written), so reading it off the render path between `process`
 * calls is sound — exactly how [`output_ptr`] exposes the render output buffer.
 * Off the render path (the worklet calls it from a drained-edge handler), so the
 * copy into the returned `Vec` is fine. Returns an empty `Vec` (no allocation)
 * when the host is absent / the id is unknown / nothing is committed.
 */
export function looper_take_pcm(node: number): Float32Array;

/**
 * Length (in f32s) of the `MicIn` output buffer the worklet may write — the
 * configured block size — or `0` when the program has no `MicIn` node. Pairs
 * with [`mic_in_ptr`]; the worklet clamps its write to this.
 */
export function mic_in_len(): number;

/**
 * Pointer (byte offset into wasm linear memory) of the FIRST `MicIn` node's
 * output buffer (port 0), or null if the live program has no `MicIn`.
 *
 * The worklet writes one block of microphone samples here BEFORE each
 * [`process`] call; the executor leaves external-source output buffers intact
 * (see `Engine::input_mut` / the exec loop's `MicIn` arm), so whatever lands
 * here flows downstream this block. Recomputed each call from the live program
 * because the master/slot layout changes across `load_graph` swaps.
 */
export function mic_in_ptr(): number;

/**
 * Total byte length of the MIDI ring struct (header + data region).
 */
export function midi_ring_len(): number;

/**
 * Base pointer of the MIDI ring inside wasm linear memory (worker -> worklet).
 */
export function midi_ring_ptr(): number;

/**
 * Number of compiled nodes in the engine's current program, as a coarse
 * liveness probe for JS (`0` == not initialized; `1` == bootstrap silence; `>1`
 * == a real graph is loaded).
 */
export function node_count(): number;

/**
 * Number of PLANAR output channels [`process`] writes (stereo). Each channel row
 * is `block_size` f32s; channel `c` starts at `output_ptr() + c*block_size`.
 */
export function output_channels(): number;

/**
 * Pointer (byte offset into wasm linear memory) of the PLANAR output buffer.
 * JS reads each channel's `block_size`-strided row starting here after each
 * [`process`] (channel `c` at `output_ptr() + c*block_size`).
 */
export function output_ptr(): number;

/**
 * Render one block. The AudioWorklet calls this every render quantum.
 *
 * Steps, all allocation-free:
 *   1. drain the command ring, applying each [`RtCommand`] to the engine;
 *   2. render `nframes` PLANAR into the output buffer via `process_block_into`.
 *
 * `nframes` is clamped to the configured block size. Read the result from
 * [`output_ptr`] + [`output_channels`]: channel `c` is the `block_size`-strided
 * row at `c*block_size` (a mono graph fills every row identically — true stereo
 * only when a Pan/stereo node feeds the master).
 */
export function process(nframes: number): void;

/**
 * Byte offset of the `capacity` field within a ring.
 */
export function ring_capacity_offset(): number;

/**
 * Byte offset of the first data byte within a ring.
 */
export function ring_data_offset(): number;

/**
 * Byte offset of the `read` atomic index within a ring (consumer-owned).
 */
export function ring_read_offset(): number;

/**
 * Byte offset of the `write` atomic index within a ring (producer-owned).
 */
export function ring_write_offset(): number;

/**
 * Configured sample rate.
 */
export function sample_rate(): number;

/**
 * Enable or disable per-node + master level metering on the wasm engine. Cheap
 * (a single bool); when off the render loop skips all `accumulate` calls. The
 * worklet enables this when the UI subscribes to signal levels and drains the
 * levels each block via [`drain_meters`].
 */
export function set_metering(on: boolean): void;

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
 */
export function store_asset(pcm: Float32Array, channels: number, sample_rate: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly block_size: () => number;
    readonly cmd_ring_len: () => number;
    readonly cmd_ring_ptr: () => number;
    readonly drain_events: () => [number, number];
    readonly drain_looper: () => [number, number];
    readonly drain_looper_edges: () => [number, number];
    readonly drain_meters: () => [number, number];
    readonly drain_transport: () => [number, number];
    readonly encode_command_setparam: (a: number, b: number, c: number) => [number, number];
    readonly encode_meter_frame: (a: number, b: number, c: number) => [number, number];
    readonly has_pending_events: () => number;
    readonly init: (a: number, b: number) => void;
    readonly last_degraded_node_ids: () => [number, number];
    readonly last_load_degraded: () => number;
    readonly load_graph: (a: number, b: number) => number;
    readonly load_tempo_map: (a: number, b: number) => number;
    readonly load_timeline: (a: number, b: number) => number;
    readonly looper_take_pcm: (a: number) => [number, number];
    readonly mic_in_len: () => number;
    readonly mic_in_ptr: () => number;
    readonly midi_ring_len: () => number;
    readonly midi_ring_ptr: () => number;
    readonly node_count: () => number;
    readonly output_channels: () => number;
    readonly output_ptr: () => number;
    readonly process: (a: number) => void;
    readonly ring_capacity_offset: () => number;
    readonly ring_data_offset: () => number;
    readonly ring_read_offset: () => number;
    readonly ring_write_offset: () => number;
    readonly sample_rate: () => number;
    readonly set_metering: (a: number) => void;
    readonly store_asset: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
