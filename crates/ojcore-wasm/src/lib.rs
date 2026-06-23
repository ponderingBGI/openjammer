//! wasm32 AudioWorklet host for `ojcore`.
//!
//! This crate is the wasm half of OpenJammer's engine: a thin `wasm-bindgen`
//! shell wrapping `ojcore`'s **no_std** compile/exec core. The std-only host
//! plumbing (`rtrb` command queue, `basedrop` deferred drop, `arc-swap` graph
//! swap) is NOT available on `wasm32`, so we depend on `ojcore` with
//! `default-features = false` and bring our own [`ojcore_midiring`]
//! `SharedArrayBuffer` rings for the UI -> engine command path and the
//! worker -> worklet MIDI path.
//!
//! # Built-in node set (PARITY with native)
//! [`init`] registers the FULL common built-in set through the ONE shared path
//! [`ojinstrument::register_all`] — the SAME function the native host calls — so
//! the worklet can play instruments (Osc / Sampler / Karplus) and every effect
//! (gain / biquad / waveshaper / delay / convolution) plus the structural I/O
//! nodes. The ONLY documented gap is SF2 (`builtin.sf2`): its `rustysynth`
//! backend needs `std` and does not build for `wasm32`, so it is native-only for
//! now (no SF2 in-browser yet).
//!
//! # JS surface (wasm-bindgen)
//!   * [`init`] — allocate the host once: registry + an empty [`Engine`] +
//!     the command/MIDI rings. Everything that allocates happens here, off the
//!     render path.
//!   * [`process`] — the AudioWorklet calls this each render quantum. It drains
//!     the command ring into [`ojproto::RtCommand`]s, applies them to the
//!     engine, then renders one block into a wasm-memory output buffer. **No
//!     allocation, no locking, no panicking on this path.**
//!   * [`load_graph`] — push a serialized [`ojproto::OjGraph`] (the same serde
//!     JSON the rest of the protocol uses); it is compiled OFF the render path
//!     and installed at the next block boundary.
//!   * pointer/offset getters ([`output_ptr`], [`cmd_ring_ptr`],
//!     [`midi_ring_ptr`], the `*_offset` family) so JS can build SAB / typed-
//!     array views directly over wasm linear memory without copying.
//!
//! # Single-thread contract
//! An AudioWorklet runs its processor on ONE thread. The whole host lives in a
//! single `static mut` cell touched only from that thread, so no interior-
//! mutability lock is needed. The rings themselves are the SPSC boundary to the
//! *other* threads (UI / MIDI worker) and carry their own wait-free
//! synchronization (see [`ojcore_midiring`]).
#![cfg_attr(not(test), no_std)]

extern crate alloc;

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use ojcore::{
    compile_resilient, compile_with_assets, AssetPcm, AssetResolver, Engine, PluginRegistry,
    SPEAKER_OUT_ID,
};
use ojcore_midiring::{header_offsets, CmdRing, MidiRing};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::{
    AssetId, EngineFrame, Event, EventKind, FaultKind, IrNode, NodeIdx, OjGraph, PrimitiveKind,
    RtCommand, Severity, Source, SCHEMA_VERSION,
};

use wasm_bindgen::prelude::*;

/// Largest RtCommand JSON frame we will ever pop, bytes. `RtCommand` is a tiny
/// flat enum; its longest serde-JSON form (`{"SetParam":{"node":4294967295,
/// "param":65535,"value":-1.0000000}}` ~ 60 B) fits comfortably. Sized with
/// generous headroom so the drain scratch never needs to grow on the RT path.
const CMD_FRAME_MAX: usize = 128;

/// FNV-1a 64-bit offset basis / prime — the same content-address fingerprint the
/// native `ojcore-native::AssetCatalog` uses, ported here so the wasm store
/// deduplicates identical PCM the same way (and so the two hosts agree on ids if
/// they ever share a serialized graph).
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// One decoded, host-owned mono sample. The wasm host owns the PCM here (the
/// `no_std` `ojcore` core never owns asset bytes); the [`WasmAssetStore`]
/// resolver hands back a borrow of `pcm` at compile time so a Sampler node's
/// [`ojproto::AssetRef`] installs through [`ojcore::DspInstance::load_asset`].
struct StoredAsset {
    id: AssetId,
    pcm: Vec<f32>,
    sample_rate: f32,
}

/// The wasm-side content-addressed PCM store — the in-browser analogue of the
/// native `AssetCatalog`. Holds every loaded sample by [`AssetId`]; the engine's
/// [`compile_with_assets`] path resolves a node's [`ojproto::AssetRef`] against
/// it so the live Sampler actually plays the sample in the browser. Small, append
/// + dedup; off the RT thread (only [`store_asset`] / [`load_graph`] touch it).
#[derive(Default)]
struct WasmAssetStore {
    assets: Vec<StoredAsset>,
}

impl WasmAssetStore {
    /// Content-address `pcm`/`sample_rate` (FNV-1a over the spec + sample bytes,
    /// folded to `u32` — identical to the native catalog) and store it, returning
    /// its [`AssetId`]. Deduplicates: re-storing identical PCM keeps one copy.
    fn insert(&mut self, pcm: Vec<f32>, sample_rate: f32) -> AssetId {
        let id = content_address(&pcm, sample_rate);
        if !self.assets.iter().any(|a| a.id == id) {
            self.assets.push(StoredAsset {
                id,
                pcm,
                sample_rate,
            });
        }
        id
    }

    /// Borrow the PCM behind `id`, if present.
    fn get(&self, id: AssetId) -> Option<&StoredAsset> {
        self.assets.iter().find(|a| a.id == id)
    }
}

/// The store IS the engine's compile-time [`AssetResolver`]: `compile_with_assets`
/// calls [`AssetResolver::resolve`] for each node's [`ojproto::AssetRef`] and
/// installs the borrowed PCM via [`ojcore::DspInstance::load_asset`] (Sampler ->
/// `set_sample`) off the RT thread, before the program goes live — the wasm end
/// of the sample-load seam, mirroring `AssetCatalog`.
impl AssetResolver for WasmAssetStore {
    fn resolve(&self, id: AssetId) -> Option<AssetPcm<'_>> {
        let a = self.get(id)?;
        // The wasm store is mono-only (the JS side downmixes before `store_asset`).
        Some(AssetPcm::mono(&a.pcm, a.sample_rate))
    }
}

/// Compute the deterministic content address of mono PCM at `sample_rate`. Mirrors
/// `ojcore-native::store::content_address` for the mono case: hash the spec
/// (channels = 1, the rate) then every sample's IEEE-754 LE bytes, fold the 64-bit
/// FNV-1a to the `u32` [`AssetId`] domain by XORing its halves.
fn content_address(pcm: &[f32], sample_rate: f32) -> AssetId {
    #[inline]
    fn mix(h: u64, byte: u8) -> u64 {
        (h ^ byte as u64).wrapping_mul(FNV_PRIME)
    }
    let mut h = FNV_OFFSET;
    // channels = 1 (the wasm store is mono-only, like the native live path).
    for b in 1u16.to_le_bytes() {
        h = mix(h, b);
    }
    // The native catalog hashes an integer sample rate; round to match.
    for b in (sample_rate.max(1.0) as u32).to_le_bytes() {
        h = mix(h, b);
    }
    for &s in pcm {
        for b in s.to_le_bytes() {
            h = mix(h, b);
        }
    }
    AssetId((h ^ (h >> 32)) as u32)
}

/// The whole engine host, allocated once by [`init`] and owned by the worklet
/// thread. Boxed so its address (and the rings' addresses inside it) are stable
/// for the lifetime of the audio context — JS keeps SAB views over them.
struct Host {
    /// The open plugin registry (built-ins registered at [`init`]).
    registry: PluginRegistry,
    /// The real-time engine. Starts as an empty (zero-node) program and is
    /// re-`install`ed whenever [`load_graph`] compiles a new one.
    engine: Engine,
    /// UI -> engine command ring (JSON [`RtCommand`] frames). Boxed so JS can
    /// view it in the `SharedArrayBuffer` at a stable address.
    cmd_ring: Box<CmdRing>,
    /// Worker -> worklet MIDI byte ring. Boxed for the same reason. Reserved for
    /// the MIDI input path; exposed to JS now so the SAB layout is fixed.
    midi_ring: Box<MidiRing>,
    /// PLANAR stereo master output the worklet copies to its render quantum:
    /// `OUT_CHANNELS` rows of `block_size` (channel `c` at `c*block_size`). Written
    /// in place by [`process`] via `process_block_into`; never reallocated there.
    out_buf: Vec<f32>,
    /// Scratch popped command frame bytes (reused; never grows on the RT path).
    cmd_scratch: Vec<u8>,
    /// Content-addressed PCM store backing the engine's asset resolution. A
    /// Sampler node carrying an [`ojproto::AssetRef`] plays its PCM because
    /// [`load_graph`] compiles through [`compile_with_assets`] over this store.
    assets: WasmAssetStore,
    /// Render quantum the worklet uses (frames per [`process`] call).
    block_size: usize,
    /// Sample rate the engine compiles graphs against.
    sample_rate: u32,
    /// Monotonic sequence stamped on each drained fault [`Event`] (wire parity
    /// with the native backend's `event_seq`). Bumped per surfaced fault.
    event_seq: u32,
}

/// The single host instance. SOUND because an AudioWorklet processor runs on
/// exactly one thread, and every accessor below is reached only from that
/// thread's `process`/control callbacks. Not shared across threads — the rings
/// are the only cross-thread surface and they are internally synchronized.
static mut HOST: Option<Host> = None;

/// Borrow the host mutably. Returns `None` before [`init`] has run.
///
/// # Safety
/// Callers must be on the single worklet thread (the wasm execution model for
/// an AudioWorklet guarantees this for the exported entry points).
#[inline]
#[allow(static_mut_refs)]
fn host_mut() -> Option<&'static mut Host> {
    // SAFETY: single-threaded worklet; no aliasing `&mut` can exist because
    // every entry point takes and drops this borrow within one synchronous call.
    unsafe { HOST.as_mut() }
}

/// Borrow the host immutably (for pointer/offset getters).
#[inline]
#[allow(static_mut_refs)]
fn host_ref() -> Option<&'static Host> {
    // SAFETY: as above; getters do not mutate.
    unsafe { HOST.as_ref() }
}

/// The lone-`SpeakerOut` graph the engine starts on (silence) before any real
/// graph is loaded. Kept tiny: one master sink, no edges.
fn bootstrap_graph(sample_rate: u32, block_size: u32) -> OjGraph {
    OjGraph {
        ir_version: SCHEMA_VERSION,
        sample_rate,
        block_size,
        nodes: vec![IrNode {
            id: NodeIdx(0),
            manifest_id: String::from(SPEAKER_OUT_ID),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        }],
        edges: vec![],
        schedule: vec![],
    }
}

/// Initialize the engine host. Call ONCE from the AudioWorklet constructor,
/// before any [`process`] call.
///
/// Allocates everything up front: the registry (with built-ins), an empty
/// engine, the command/MIDI rings, and the `block_size`-long output buffer. A
/// second call re-initializes from scratch (the previous host is dropped here,
/// off the render path).
///
/// `block_size` must be the worklet's render quantum (typically 128).
#[wasm_bindgen]
pub fn init(sample_rate: u32, block_size: u32) {
    let block_size = block_size as usize;

    // ONE shared registration path: the FULL common built-in set (effects +
    // structural + Osc/Sampler/Karplus), minus SF2 (rustysynth needs std and is
    // unavailable on wasm32 — the documented PWA limitation). This is the exact
    // same `register_all` the native host calls, so the worklet is at PARITY.
    let mut registry = PluginRegistry::new();
    register_all(&mut registry, RegisterOpts::wasm());

    // `compile_with_assets` requires exactly one master-output node, so the
    // bootstrap graph is a LONE host `SpeakerOut` (no sources). It renders as
    // silence until `load_graph` installs a real program — but it makes the
    // engine valid from the very first `process` call. The bootstrap has no
    // assets, so an empty store resolves nothing here.
    let assets = WasmAssetStore::default();
    let boot = bootstrap_graph(sample_rate, block_size as u32);
    let program =
        compile_with_assets(&boot, &registry, &assets).expect("master-only graph always compiles");
    let engine = Engine::new(program);

    let host = Host {
        registry,
        engine,
        cmd_ring: Box::new(CmdRing::new()),
        midi_ring: Box::new(MidiRing::new()),
        out_buf: vec![0.0f32; OUT_CHANNELS * block_size],
        cmd_scratch: vec![0u8; CMD_FRAME_MAX],
        assets,
        block_size,
        sample_rate,
        event_seq: 0,
    };

    // SAFETY: single-threaded worklet init; no other reference is live.
    unsafe {
        HOST = Some(host);
    }
}

/// Compile and install a serialized [`OjGraph`] (serde JSON `bytes`).
///
/// Runs OFF the render path: compilation allocates (instances, routing, scratch
/// buffers), then [`Engine::install`] swaps the new program in. The old program
/// is returned by `install` and dropped here — never on the audio thread.
///
/// Returns `true` on success. On a malformed payload or a compile error it
/// leaves the running program untouched and returns `false`, so a bad graph can
/// never silence or crash a live engine.
#[wasm_bindgen]
pub fn load_graph(bytes: &[u8]) -> bool {
    let Some(host) = host_mut() else { return false };

    let graph: OjGraph = match serde_json::from_slice(bytes) {
        Ok(g) => g,
        Err(_) => return false,
    };
    // Honour the host's configured rate/quantum so buffer sizes match `process`.
    let mut graph = graph;
    graph.sample_rate = host.sample_rate;
    graph.block_size = host.block_size as u32;

    // Compile RESOLVING each node's `AssetRef` through the host's PCM store (the
    // wasm end of the sample-load seam): a Sampler carrying a bound `AssetId`
    // gets its sample installed via `DspInstance::load_asset` here, off the RT
    // thread, before the program goes live — mirroring native `compile_with_assets`.
    // Load-time graceful degrade (invariant #4a): a missing plugin/instrument
    // dependency becomes a labeled passthrough stub so a loaded project ALWAYS opens
    // and stays audible, instead of the whole `load_graph` failing. (The bootstrap +
    // tests stay strict — known-good internal graphs.)
    let program = match compile_resilient(&graph, &host.registry, &host.assets) {
        Ok(p) => p,
        Err(_) => return false,
    };
    // `install` hands back the old program; dropping it here keeps the RT path
    // allocation/free-free.
    let _old = host.engine.install(program);
    true
}

/// Store decoded mono `pcm` (captured at `sample_rate` Hz) in the host's PCM
/// store and return its content-addressed [`AssetId`] (an integer the JS side
/// then binds onto the node's [`ojproto::AssetRef`] and re-pushes the graph with,
/// so the next [`load_graph`] resolves + installs it into the live Sampler).
///
/// Off the RT thread (the worklet calls it from a control message, between
/// `process` calls). Returns `0` if the host is not initialized — `0` is a valid
/// content address only for a degenerate input, so the JS side treats it as "not
/// stored" only when the host is absent (it checks `ready` first).
#[wasm_bindgen]
pub fn store_asset(pcm: &[f32], sample_rate: f32) -> u32 {
    let Some(host) = host_mut() else { return 0 };
    host.assets.insert(pcm.to_vec(), sample_rate).0
}

/// Pointer (byte offset into wasm linear memory) of the FIRST `MicIn` node's
/// output buffer (port 0), or null if the live program has no `MicIn`.
///
/// The worklet writes one block of microphone samples here BEFORE each
/// [`process`] call; the executor leaves external-source output buffers intact
/// (see `Engine::input_mut` / the exec loop's `MicIn` arm), so whatever lands
/// here flows downstream this block. Recomputed each call from the live program
/// because the master/slot layout changes across `load_graph` swaps.
#[wasm_bindgen]
pub fn mic_in_ptr() -> *mut f32 {
    let Some(host) = host_mut() else {
        return core::ptr::null_mut();
    };
    let prog = host.engine.program();
    let Some(slot) = prog
        .kinds
        .iter()
        .position(|k| matches!(k, PrimitiveKind::MicIn))
    else {
        return core::ptr::null_mut();
    };
    let id = prog.ids[slot];
    match host.engine.input_mut(id, 0) {
        Some(buf) => buf.as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// Length (in f32s) of the `MicIn` output buffer the worklet may write — the
/// configured block size — or `0` when the program has no `MicIn` node. Pairs
/// with [`mic_in_ptr`]; the worklet clamps its write to this.
#[wasm_bindgen]
pub fn mic_in_len() -> u32 {
    let Some(host) = host_ref() else { return 0 };
    let has_mic = host
        .engine
        .program()
        .kinds
        .iter()
        .any(|k| matches!(k, PrimitiveKind::MicIn));
    if has_mic {
        host.block_size as u32
    } else {
        0
    }
}

/// Output channel count the wasm tier renders (stereo). The worklet copies each
/// of these planar rows (per-channel stride = `block_size`) into its output.
const OUT_CHANNELS: usize = 2;

/// Render one block. The AudioWorklet calls this every render quantum.
///
/// Steps, all allocation-free:
///   1. drain the command ring, applying each [`RtCommand`] to the engine;
///   2. render `nframes` PLANAR into the output buffer via `process_block_into`.
///
/// `nframes` is clamped to the configured block size. Read the result from
/// [`output_ptr`] + [`output_channels`]: channel `c` is the `block_size`-strided
/// row at `c*block_size` (a mono graph fills every row identically — true stereo
/// only when a Pan/stereo node feeds the master).
#[wasm_bindgen]
pub fn process(nframes: u32) {
    let Some(host) = host_mut() else { return };
    let nframes = (nframes as usize).min(host.block_size);

    drain_commands(host);

    // Render PLANAR: channel `c` occupies out_buf[c*block .. c*block+nframes]. The
    // row-slices are built on the stack (split_at_mut) so the RT path allocates
    // nothing — the same pattern the native host uses.
    let block = host.block_size;
    let mut rows: [&mut [f32]; OUT_CHANNELS] = Default::default();
    let mut rest = &mut host.out_buf[..OUT_CHANNELS * block];
    for row in rows.iter_mut() {
        let (head, tail) = rest.split_at_mut(block);
        *row = &mut head[..nframes];
        rest = tail;
    }
    host.engine.process_block_into(&mut rows, nframes);
}

/// Drain every pending command frame from the ring and apply it. Wait-free and
/// allocation-free: `pop` reads into the reused `cmd_scratch`, and each frame is
/// decoded into a `Copy` [`RtCommand`] applied in place.
#[inline]
fn drain_commands(host: &mut Host) {
    // Split the borrow so the engine and the ring/scratch are disjoint.
    let Host {
        engine,
        cmd_ring,
        cmd_scratch,
        ..
    } = host;
    loop {
        match cmd_ring.pop(cmd_scratch) {
            None => break,
            Some(len) => {
                if len > cmd_scratch.len() {
                    // Oversized frame (should never happen given CMD_FRAME_MAX);
                    // the ring left it queued. Skipping the rest avoids spinning.
                    break;
                }
                if let Ok(cmd) = serde_json::from_slice::<RtCommand>(&cmd_scratch[..len]) {
                    apply_command(engine, cmd);
                }
            }
        }
    }
}

/// Apply one [`RtCommand`] to the engine through `ojcore`'s **no_std**
/// [`Engine::apply_rt`] — the SINGLE shared command-routing implementation the
/// native std host (`ojcore::command`) and this wasm host both delegate to, so
/// there is exactly one per-variant match (zero duplication). Allocation-free,
/// no locks: callable straight from the worklet render path.
///
/// EVERY decoded command routes (full parity with native): `SetParam` /
/// `NoteOn` / `NoteOff` -> the resolved instance, `Bypass` -> the slot flag,
/// `TransportPlay` / `TransportPause` / `Seek` -> the engine's sample clock, and
/// `Looper` -> the instance's looper state machine. Notes and transport now flow
/// in-browser, so keyboard/MIDI-driven instruments play under the wasm engine.
#[inline]
fn apply_command(engine: &mut Engine, cmd: RtCommand) {
    engine.apply_rt(cmd);
}

// --- Memory / layout getters: let JS build SAB + typed-array views directly
// over wasm linear memory, with zero copying across the boundary. ------------

/// Pointer (byte offset into wasm linear memory) of the PLANAR output buffer.
/// JS reads each channel's `block_size`-strided row starting here after each
/// [`process`] (channel `c` at `output_ptr() + c*block_size`).
#[wasm_bindgen]
pub fn output_ptr() -> *const f32 {
    host_ref().map_or(core::ptr::null(), |h| h.out_buf.as_ptr())
}

/// Number of PLANAR output channels [`process`] writes (stereo). Each channel row
/// is `block_size` f32s; channel `c` starts at `output_ptr() + c*block_size`.
#[wasm_bindgen]
pub fn output_channels() -> u32 {
    OUT_CHANNELS as u32
}

/// Configured render quantum (frames per [`process`] call / `output` length).
#[wasm_bindgen]
pub fn block_size() -> u32 {
    host_ref().map_or(0, |h| h.block_size as u32)
}

/// Configured sample rate.
#[wasm_bindgen]
pub fn sample_rate() -> u32 {
    host_ref().map_or(0, |h| h.sample_rate)
}

/// Base pointer of the command ring inside wasm linear memory. JS lays a
/// `SharedArrayBuffer` view over `[cmd_ring_ptr, cmd_ring_ptr + cmd_ring_len)`
/// and uses the `*_offset` getters below to find the header fields and data.
#[wasm_bindgen]
pub fn cmd_ring_ptr() -> *const u8 {
    host_ref().map_or(core::ptr::null(), |h| {
        (h.cmd_ring.as_ref() as *const CmdRing) as *const u8
    })
}

/// Total byte length of the command ring struct (header + data region).
#[wasm_bindgen]
pub fn cmd_ring_len() -> u32 {
    core::mem::size_of::<CmdRing>() as u32
}

/// Base pointer of the MIDI ring inside wasm linear memory (worker -> worklet).
#[wasm_bindgen]
pub fn midi_ring_ptr() -> *const u8 {
    host_ref().map_or(core::ptr::null(), |h| {
        (h.midi_ring.as_ref() as *const MidiRing) as *const u8
    })
}

/// Total byte length of the MIDI ring struct (header + data region).
#[wasm_bindgen]
pub fn midi_ring_len() -> u32 {
    core::mem::size_of::<MidiRing>() as u32
}

// The ring header offsets are identical for every `ByteRing<N>` (the `#[repr(C)]`
// layout is frozen), so one set of getters serves both rings. JS adds these to
// `cmd_ring_ptr()` / `midi_ring_ptr()` to address the atomics and data region.

/// Byte offset of the `write` atomic index within a ring (producer-owned).
#[wasm_bindgen]
pub fn ring_write_offset() -> u32 {
    header_offsets().write as u32
}

/// Byte offset of the `read` atomic index within a ring (consumer-owned).
#[wasm_bindgen]
pub fn ring_read_offset() -> u32 {
    header_offsets().read as u32
}

/// Byte offset of the `capacity` field within a ring.
#[wasm_bindgen]
pub fn ring_capacity_offset() -> u32 {
    header_offsets().capacity as u32
}

/// Byte offset of the first data byte within a ring.
#[wasm_bindgen]
pub fn ring_data_offset() -> u32 {
    header_offsets().data as u32
}

/// Encode an [`RtCommand`] as the JSON frame the command ring expects. Helper
/// for tests / a JS-side mirror; not on the render path. Returns the bytes a
/// producer would `push` into the [`cmd_ring`](Host::cmd_ring).
#[wasm_bindgen]
pub fn encode_command_setparam(node: u32, param: u16, value: f32) -> Vec<u8> {
    let cmd = RtCommand::SetParam {
        node: ojproto::NodeIdx(node),
        param,
        value,
    };
    // Off the RT path: this is a convenience encoder, allocation is fine here.
    serde_json::to_vec(&cmd).unwrap_or_default()
}

/// Number of compiled nodes in the engine's current program, as a coarse
/// liveness probe for JS (`0` == not initialized; `1` == bootstrap silence; `>1`
/// == a real graph is loaded).
#[wasm_bindgen]
pub fn node_count() -> u32 {
    host_ref().map_or(0, |h| h.engine.program().len() as u32)
}

// --- Metering (U-EXEC-PARITY): per-node levels back to the UI -----------------

/// Enable or disable per-node + master level metering on the wasm engine. Cheap
/// (a single bool); when off the render loop skips all `accumulate` calls. The
/// worklet enables this when the UI subscribes to signal levels and drains the
/// levels each block via [`drain_meters`].
#[wasm_bindgen]
pub fn set_metering(on: bool) {
    if let Some(host) = host_mut() {
        host.engine.set_metering(on);
    }
}

/// Drain the current per-node + master meter windows as a FLAT `[node, peak, ...]`
/// `f32` array (node ids are exact integers within `f32`'s safe range for any
/// realistic node count). The master level is appended last under the master
/// node's id. Resets each window (uses `Meter::take`), so calling once per block
/// yields a fresh peak each time. Returns an empty vec when metering is off or
/// the host is not initialized. Off the render path (the worklet calls it between
/// `process` calls), so the `Vec` allocation here is fine.
#[wasm_bindgen]
pub fn drain_meters() -> Vec<f32> {
    let Some(host) = host_mut() else {
        return Vec::new();
    };
    if !host.engine.metering_enabled() {
        return Vec::new();
    }
    // Snapshot ids/master before borrowing meters mutably (disjoint borrows).
    let ids = host.engine.program().ids.clone();
    let master_slot = host.engine.program().master_out;
    let meters = host.engine.meters_mut();
    let mut out = Vec::with_capacity((meters.nodes.len() + 1) * 2);
    for (slot, m) in meters.nodes.iter_mut().enumerate() {
        let (_rms, peak) = m.take();
        let id = ids.get(slot).map_or(0, |n| n.0);
        out.push(id as f32);
        out.push(peak);
    }
    let (_rms, master_peak) = meters.master.take();
    let master_id = ids.get(master_slot).map_or(0, |n| n.0);
    out.push(master_id as f32);
    out.push(master_peak);
    out
}

// --- Looper transport (Stage 2): return path back to the UI -------------------

/// Drain every looper node's transport snapshot as a FLAT
/// `[node, state, pos, loop_len, peak, ...]` `f32` array (one 5-tuple per looper
/// node). The wasm tier has no return-frame ring (those are `std`-only), so this
/// reads each looper instance's [`ojcore::DspInstance::looper_snapshot`] DIRECTLY
/// — exactly how [`drain_meters`] reads `meters_mut` instead of a ring. UNGATED by
/// metering: the looper's row/playhead must surface even when level meters are
/// off (the looper return path is published every block on native, ungated too —
/// see `exec.rs::publish_looper`). Off the render path (the worklet calls it
/// between `process` calls), so the `Vec` allocation is fine; an empty `Vec` when
/// there are no looper nodes / no host costs nothing on the common path.
#[wasm_bindgen]
pub fn drain_looper() -> Vec<f32> {
    let Some(host) = host_mut() else {
        return Vec::new();
    };
    let program = host.engine.program();
    // Snapshot ids + kinds before borrowing instances (disjoint reads).
    let n_slots = program.instances.len();
    let mut out: Vec<f32> = Vec::new();
    for slot in 0..n_slots {
        if program.kinds[slot] != PrimitiveKind::Looper {
            continue;
        }
        let id = program.ids[slot].0;
        if let Some((state, pos, loop_len, peak)) = program.instances[slot].looper_snapshot() {
            out.push(id as f32);
            out.push(state as f32);
            out.push(pos as f32);
            out.push(loop_len as f32);
            out.push(peak);
        }
    }
    out
}

/// Drain any pending looper state-machine EDGE per looper node as a JSON
/// `Vec<Event>` of [`EventKind::LooperEdge`] — the SAME wire shape `drain_events`
/// (faults) returns, so the worklet rides them on the existing `events`
/// postMessage and the one TS fault-pipe seam routes the LooperEdge tag (a commit
/// signal, not a fault) to the looper handle. UNGATED, off the render path: an
/// edge (cycle wrap / STOP commit) is the AUTHORITATIVE row-create signal and must
/// never be dropped, so unlike snapshots it is loss-proof per-node (the kernel
/// coalesces onto one pending slot until drained). Returns an empty `Vec` (no
/// allocation) when no looper edge is pending — the common case.
#[wasm_bindgen]
pub fn drain_looper_edges() -> Vec<u8> {
    let Some(host) = host_mut() else {
        return Vec::new();
    };
    // Disjoint field borrows: `engine` (the program) and `event_seq`.
    let Host {
        engine, event_seq, ..
    } = host;
    let program = engine.program_mut();
    let n_slots = program.instances.len();
    let mut events: Vec<Event> = Vec::new();
    for slot in 0..n_slots {
        if program.kinds[slot] != PrimitiveKind::Looper {
            continue;
        }
        let node = program.ids[slot];
        if let Some((from, to)) = program.instances[slot].take_looper_edge() {
            *event_seq = event_seq.wrapping_add(1);
            events.push(Event {
                v: SCHEMA_VERSION,
                seq: *event_seq,
                severity: Severity::Info,
                kind: EventKind::LooperEdge { node, from, to },
                source: Source::Wasm,
                ts_us: 0,
                corr_id: 0,
            });
        }
    }
    if events.is_empty() {
        return Vec::new();
    }
    serde_json::to_vec(&events).unwrap_or_default()
}

/// Copy the MOST-RECENTLY-COMMITTED layer's loop PCM for looper `node` into a
/// fresh `Float32Array` (`loop_len` mono f32s), or an empty array when the node
/// is not a looper / has no committed layer yet. This is the WASM end of the
/// Stage-3 finalize-PCM seam: when the worklet drains a commit `LooperEdge` for
/// `node` (the Recording|Overdubbing→Playing edge from [`drain_looper_edges`]),
/// it calls this and `postMessage`s the bytes so the UI can build the real
/// `AudioBuffer` for that layer's row (true waveform + drag-to-library/export).
///
/// The committed layer is read-only on the render path (only read back for
/// playback, never written), so reading it off the render path between `process`
/// calls is sound — exactly how [`output_ptr`] exposes the render output buffer.
/// Off the render path (the worklet calls it from a drained-edge handler), so the
/// copy into the returned `Vec` is fine. Returns an empty `Vec` (no allocation)
/// when the host is absent / the id is unknown / nothing is committed.
#[wasm_bindgen]
pub fn looper_take_pcm(node: u32) -> Vec<f32> {
    let Some(host) = host_ref() else {
        return Vec::new();
    };
    let program = host.engine.program();
    let target = NodeIdx(node);
    for slot in 0..program.instances.len() {
        if program.kinds[slot] != PrimitiveKind::Looper {
            continue;
        }
        if program.ids[slot] != target {
            continue;
        }
        let pcm = program.instances[slot].last_committed_layer_pcm();
        if pcm.is_empty() {
            return Vec::new();
        }
        return pcm.to_vec();
    }
    Vec::new()
}

// --- Fault events (Wave 4): node faults back to the UI ------------------------

/// Build a `NodeFault` [`Event`] with the native wire shape. `ts_us` is left `0`
/// (there is no wall clock in the AudioWorklet global scope); the main thread
/// stamps it on receipt. `NodeFault` lifts to `Error` severity, matching the
/// native `lift_event`. The source is `Wasm` so the DevLog scope reads `wasm`.
fn node_fault_event(node: NodeIdx, fault: FaultKind, seq: u32) -> Event {
    Event {
        v: SCHEMA_VERSION,
        seq,
        severity: Severity::Error,
        kind: EventKind::NodeFault { node, fault },
        source: Source::Wasm,
        ts_us: 0,
        corr_id: 0,
    }
}

/// True when the engine has at least one pending node-fault flag. A cheap
/// O(nodes) bool scan with NO allocation — the worklet calls it every block and
/// only invokes [`drain_events`] when it is set, so the (allocating) event
/// serialization never runs on a fault-free block. NOT gated on metering: a fault
/// must surface even when no meter UI is subscribed.
#[wasm_bindgen]
pub fn has_pending_events() -> bool {
    host_ref().is_some_and(|h| h.engine.budget().any_flagged())
}

/// Drain the engine's per-node resilience flags into a JSON `Vec<Event>` — the
/// SAME wire shape the native `poll_events` returns, so the one TS fault pipe
/// ingests both tiers identically.
///
/// The RT event RING and the CPU watchdog are `std`-only, so the wasm tier
/// surfaces faults straight from [`NodeBudget`] (the `no_std` NaN/garbage guard
/// `sanitize` sets `non_finite` from the render path) — exactly how
/// [`drain_meters`] reads `meters_mut`. Consumed flags are CLEARED so each fault
/// surfaces once per drain window; a persistently-bad node re-raises next block
/// and the TS coalescer collapses the storm (parity with native). Returns an
/// empty `Vec` (no allocation) when there is no fault — the common case. Off the
/// critical path: a fault means something is already wrong, so the rare alloc is
/// fine, mirroring `drain_meters`.
#[wasm_bindgen]
pub fn drain_events() -> Vec<u8> {
    let Some(host) = host_mut() else {
        return Vec::new();
    };
    if !host.engine.budget().any_flagged() {
        return Vec::new();
    }
    // Disjoint field borrows: `engine` (the program + flags) and `event_seq`.
    let Host {
        engine, event_seq, ..
    } = host;
    // Snapshot node ids before borrowing the budget (disjoint from the flag read).
    let ids = engine.program().ids.clone();
    let mut events: Vec<Event> = Vec::new();
    {
        let budget = engine.budget();
        for (slot, &flagged) in budget.non_finite.iter().enumerate() {
            if flagged {
                *event_seq = event_seq.wrapping_add(1);
                let node = ids.get(slot).copied().unwrap_or(NodeIdx(0));
                events.push(node_fault_event(node, FaultKind::NonFinite, *event_seq));
            }
        }
        // `over_budget` is only set when a watchdog is armed (std-only, never on
        // wasm today), but we surface it too so a future wasm watchdog is covered
        // with no further wiring.
        for (slot, &flagged) in budget.over_budget.iter().enumerate() {
            if flagged {
                *event_seq = event_seq.wrapping_add(1);
                let node = ids.get(slot).copied().unwrap_or(NodeIdx(0));
                events.push(node_fault_event(node, FaultKind::OverBudget, *event_seq));
            }
        }
    }
    engine.budget_mut().clear();
    if events.is_empty() {
        return Vec::new();
    }
    serde_json::to_vec(&events).unwrap_or_default()
}

/// Encode a `Meter` [`EngineFrame`] to JSON — a convenience mirror for tests /
/// JS so the wasm meter shape matches the native event payload. Not on the
/// render path.
#[wasm_bindgen]
pub fn encode_meter_frame(node: u32, rms: f32, peak: f32) -> Vec<u8> {
    let frame = EngineFrame::Meter {
        node: NodeIdx(node),
        rms,
        peak,
    };
    serde_json::to_vec(&frame).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojcore_midiring::CmdRing;
    use ojproto::{NodeIdx, RtCommand};

    /// The wasm registry built via the shared path holds the FULL common set
    /// (effects + structural + instruments) and excludes SF2 (the documented
    /// PWA limitation). This is the parity contract for the worklet.
    #[test]
    fn wasm_registry_is_at_parity_minus_sf2() {
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());

        for id in [
            ojcore::GAIN_ID,
            ojcore::BIQUAD_ID,
            ojcore::WAVESHAPER_ID,
            ojcore::DELAY_ID,
            ojcore::CONVOLUTION_ID,
            ojcore::SPEAKER_OUT_ID,
            ojcore::GRAPH_IN_ID,
            ojcore::GRAPH_OUT_ID,
            ojcore::MIC_IN_ID,
            ojcore::ADD_ID,
            ojcore::PASSTHROUGH_ID,
            ojinstrument::OSC_ID,
            ojinstrument::SAMPLER_ID,
            ojinstrument::KARPLUS_ID,
        ] {
            assert!(reg.contains(id), "wasm registry missing {id}");
        }
        assert!(
            !reg.contains("builtin.sf2"),
            "SF2 must be excluded on wasm32"
        );
    }

    /// A small graph using a new effect (delay) compiles + runs against the wasm
    /// registry end to end: GraphIn -> Delay -> SpeakerOut.
    #[test]
    fn effect_graph_compiles_and_runs() {
        use ojproto::{ConnectionType, IrEdge};
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());

        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(ojcore::GRAPH_IN_ID),
                    kind: PrimitiveKind::GraphIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(ojcore::DELAY_ID),
                    kind: PrimitiveKind::Delay,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![
                IrEdge {
                    from_node: NodeIdx(0),
                    from_port: 0,
                    to_node: NodeIdx(1),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
                IrEdge {
                    from_node: NodeIdx(1),
                    from_port: 0,
                    to_node: NodeIdx(2),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
            ],
            schedule: vec![],
        };
        let store = WasmAssetStore::default();
        let program = compile_with_assets(&graph, &reg, &store).expect("effect graph compiles");
        let mut engine = Engine::new(program);
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        assert!(out.iter().all(|s| s.is_finite()));
    }

    /// A `SetParam` command round-trips through the exact JSON frame format the
    /// command ring carries, and decodes back to the same `RtCommand`.
    #[test]
    fn setparam_json_frame_roundtrips() {
        let bytes = encode_command_setparam(7, 0, 1.5);
        let cmd: RtCommand = serde_json::from_slice(&bytes).expect("decode");
        assert_eq!(
            cmd,
            RtCommand::SetParam {
                node: NodeIdx(7),
                param: 0,
                value: 1.5
            }
        );
        assert!(
            bytes.len() <= CMD_FRAME_MAX,
            "frame must fit the RT scratch"
        );
    }

    /// Pushing a JSON command frame into a `CmdRing` and popping it back yields
    /// the original command — this is precisely what `drain_commands` does.
    #[test]
    fn cmd_ring_carries_json_frames() {
        let ring = CmdRing::new();
        let frame = encode_command_setparam(3, 2, -0.25);
        assert!(ring.push(&frame), "frame fits the ring");

        let mut scratch = [0u8; CMD_FRAME_MAX];
        let len = ring.pop(&mut scratch).expect("frame present");
        let cmd: RtCommand = serde_json::from_slice(&scratch[..len]).expect("decode");
        assert_eq!(
            cmd,
            RtCommand::SetParam {
                node: NodeIdx(3),
                param: 2,
                value: -0.25
            }
        );
    }

    /// Every variant's JSON frame fits the fixed RT-path scratch, so the drain
    /// loop never has to grow `cmd_scratch` on the audio thread.
    #[test]
    fn all_command_frames_fit_scratch() {
        let cmds = [
            RtCommand::SetParam {
                node: NodeIdx(u32::MAX),
                param: u16::MAX,
                value: f32::MIN,
            },
            RtCommand::NoteOn {
                node: NodeIdx(u32::MAX),
                note: 127,
                vel: 127,
            },
            RtCommand::NoteOff {
                node: NodeIdx(u32::MAX),
                note: 127,
            },
            RtCommand::Bypass {
                node: NodeIdx(u32::MAX),
                on: true,
            },
            RtCommand::TransportPlay,
            RtCommand::TransportPause,
            RtCommand::Seek { samples: u64::MAX },
        ];
        for c in cmds {
            let n = serde_json::to_vec(&c).unwrap().len();
            assert!(
                n <= CMD_FRAME_MAX,
                "{c:?} frame is {n} B, exceeds {CMD_FRAME_MAX}"
            );
        }
    }

    /// The frozen ring header offsets are stable and what the getters report,
    /// so the JS-side SAB views address the right atomics.
    #[test]
    fn ring_offset_getters_match_header() {
        let o = ojcore_midiring::header_offsets();
        assert_eq!(ring_write_offset() as usize, o.write);
        assert_eq!(ring_read_offset() as usize, o.read);
        assert_eq!(ring_capacity_offset() as usize, o.capacity);
        assert_eq!(ring_data_offset() as usize, o.data);
    }

    /// `encode_meter_frame` emits the EXACT serde JSON `EngineFrame::Meter` shape
    /// the native `meters` payload uses, so the wasm + native meter wire forms
    /// match (the UI maps both identically).
    #[test]
    fn meter_frame_json_matches_engineframe() {
        let bytes = encode_meter_frame(5, 0.1, 0.8);
        let decoded: EngineFrame = serde_json::from_slice(&bytes).expect("decode");
        assert_eq!(
            decoded,
            EngineFrame::Meter {
                node: NodeIdx(5),
                rms: 0.1,
                peak: 0.8,
            }
        );
    }

    /// Metering drives a real per-node levels readout: enable it, render a block
    /// of a graph whose source is non-silent, then `drain_meters` reports a flat
    /// `[node, peak, ...]` array including the master, resetting each window.
    #[test]
    fn metering_drains_per_node_levels() {
        use ojproto::{ConnectionType, IrEdge};
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());
        // GraphIn (we inject a constant) -> Gain -> SpeakerOut.
        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(ojcore::GRAPH_IN_ID),
                    kind: PrimitiveKind::GraphIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(ojcore::GAIN_ID),
                    kind: PrimitiveKind::Gain,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![
                IrEdge {
                    from_node: NodeIdx(0),
                    from_port: 0,
                    to_node: NodeIdx(1),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
                IrEdge {
                    from_node: NodeIdx(1),
                    from_port: 0,
                    to_node: NodeIdx(2),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
            ],
            schedule: vec![],
        };
        let store = WasmAssetStore::default();
        let program = compile_with_assets(&graph, &reg, &store).expect("graph compiles");
        let mut engine = Engine::new(program);
        engine.set_metering(true);
        assert!(engine.metering_enabled());

        // Inject a constant 0.5 into the GraphIn source and render a block.
        if let Some(src) = engine.input_mut(NodeIdx(0), 0) {
            for s in src.iter_mut() {
                *s = 0.5;
            }
        }
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);

        // Drain mirrors the wasm export logic: per-node peaks + master, reset.
        let ids = engine.program().ids.clone();
        let master_slot = engine.program().master_out;
        let meters = engine.meters_mut();
        let mut flat = Vec::new();
        for (slot, m) in meters.nodes.iter_mut().enumerate() {
            let (_rms, peak) = m.take();
            flat.push(ids.get(slot).map_or(0, |n| n.0) as f32);
            flat.push(peak);
        }
        let (_rms, master_peak) = meters.master.take();
        flat.push(ids.get(master_slot).map_or(0, |n| n.0) as f32);
        flat.push(master_peak);

        // Flat array is pairs, includes the master, and at least one node metered
        // a non-zero peak from the 0.5 signal.
        assert_eq!(flat.len() % 2, 0);
        assert!(flat.len() >= 2);
        let any_signal = flat.chunks(2).any(|p| p[1] > 0.0);
        assert!(any_signal, "expected a non-zero metered peak");
    }

    /// A round-trip of the bootstrap graph through JSON + `compile_with_assets`
    /// proves `load_graph` will accept the same serde JSON payload `init` builds
    /// and the protocol emits. Mirrors the registry setup `init` performs, without
    /// the wasm `static`.
    #[test]
    fn graph_json_compiles_against_registry() {
        let mut registry = PluginRegistry::new();
        register_all(&mut registry, RegisterOpts::wasm());

        let graph = bootstrap_graph(48_000, 128);
        let json = serde_json::to_vec(&graph).unwrap();
        let decoded: OjGraph = serde_json::from_slice(&json).unwrap();
        let store = WasmAssetStore::default();
        let program =
            compile_with_assets(&decoded, &registry, &store).expect("bootstrap graph compiles");
        let engine = Engine::new(program);
        // One node: the lone master sink.
        assert_eq!(engine.program().len(), 1);
    }

    // --- U-WASM-PARITY: asset store + sampler live-load + mic input ------------

    /// The content address is deterministic and dedups identical PCM: storing the
    /// same samples twice yields one id and one stored copy (the native catalog's
    /// contract, ported for the wasm store).
    #[test]
    fn asset_store_dedups_identical_pcm() {
        let mut store = WasmAssetStore::default();
        let pcm: Vec<f32> = (0..256).map(|i| (i as f32 / 256.0) - 0.5).collect();
        let a = store.insert(pcm.clone(), 48_000.0);
        let b = store.insert(pcm.clone(), 48_000.0);
        assert_eq!(a, b, "identical PCM must content-address the same");
        assert_eq!(store.assets.len(), 1, "identical PCM must not duplicate");
        // A different rate is a distinct asset (spec is part of the address).
        let c = store.insert(pcm, 44_100.0);
        assert_ne!(a, c);
        assert_eq!(store.assets.len(), 2);
    }

    /// The store resolves a stored id back to a borrow of its PCM (the
    /// `AssetResolver` seam `compile_with_assets` calls), and `None` for unknown.
    #[test]
    fn asset_store_resolves_stored_pcm() {
        let mut store = WasmAssetStore::default();
        let pcm = vec![0.25f32; 64];
        let id = store.insert(pcm.clone(), 48_000.0);
        let resolved = store.resolve(id).expect("stored asset resolves");
        assert_eq!(resolved.pcm, &pcm[..]);
        assert_eq!(resolved.sample_rate, 48_000.0);
        assert!(store.resolve(AssetId(id.0 ^ 0xffff_ffff)).is_none());
    }

    /// A Sampler node carrying an `AssetRef` actually receives its PCM when the
    /// graph compiles through `compile_with_assets` over the store — the in-browser
    /// sample-load seam end to end: store PCM, bind the id on the node, compile,
    /// and the live sampler plays (a `note_on` produces non-silent output).
    #[test]
    fn sampler_plays_bound_asset_via_compile_with_assets() {
        use ojproto::{AssetRef, ConnectionType, IrEdge};
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());

        // A loud, finite mono buffer so a played voice meters non-zero.
        let pcm = vec![0.8f32; 512];
        let mut store = WasmAssetStore::default();
        let id = store.insert(pcm, 48_000.0);

        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(ojinstrument::SAMPLER_ID),
                    kind: PrimitiveKind::Sampler,
                    params: vec![],
                    // Bind the stored PCM in slot 0 (the sampler's single buffer).
                    assets: vec![AssetRef { slot: 0, asset: id }],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(0),
                from_port: 0,
                to_node: NodeIdx(1),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        let program = compile_with_assets(&graph, &reg, &store).expect("sampler graph compiles");
        let mut engine = Engine::new(program);

        // With the sample installed, a note produces audible output; without it
        // the sampler is silent (the `set_sample`/`load_asset` seam is what makes
        // the difference, so this proves the asset reached the live instance).
        let slot = engine
            .program()
            .slot_of_id(NodeIdx(0))
            .expect("sampler slot");
        engine.program_mut().instances[slot].note_on(60, 100);
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        assert!(
            out.iter().any(|s| s.abs() > 1e-4),
            "sampler with a bound asset must produce non-silent output"
        );
    }

    /// `compile_with_assets` over an EMPTY store leaves a Sampler with an
    /// unresolvable `AssetRef` silent (the asset is skipped, never an error) — the
    /// before state the live-load transitions out of.
    #[test]
    fn sampler_without_resolved_asset_is_silent() {
        use ojproto::{AssetRef, ConnectionType, IrEdge};
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());
        let store = WasmAssetStore::default(); // empty: nothing resolves

        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(ojinstrument::SAMPLER_ID),
                    kind: PrimitiveKind::Sampler,
                    params: vec![],
                    assets: vec![AssetRef {
                        slot: 0,
                        asset: AssetId(123),
                    }],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(0),
                from_port: 0,
                to_node: NodeIdx(1),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        let program = compile_with_assets(&graph, &reg, &store).expect("compiles");
        let mut engine = Engine::new(program);
        let slot = engine.program().slot_of_id(NodeIdx(0)).expect("slot");
        engine.program_mut().instances[slot].note_on(60, 100);
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        assert!(
            out.iter().all(|s| s.abs() <= 1e-6),
            "an unresolved sampler asset stays silent"
        );
    }

    /// STAGE-3 finalize-PCM (wasm): a Looper that records a known block then
    /// commits exposes that take's TRUE per-sample PCM via the engine instance's
    /// `last_committed_layer_pcm` (what `looper_take_pcm` copies out). Drives the
    /// kernel through a real compiled program: GraphIn -> Looper -> SpeakerOut,
    /// inject a ramp, RECORD one quantized block (auto-commits to Playing), then
    /// read the committed PCM back and assert it equals the injected input.
    #[test]
    fn looper_committed_layer_pcm_round_trips() {
        use ojcore::looper::looper_param;
        use ojcore::{LooperLoader, GAIN_ID, LOOPER_ID};
        use ojproto::{looper_action, ConnectionType, IrEdge, Param, RtCommand};

        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());
        reg.register(Box::new(LooperLoader::new()));

        const SR: u32 = 48_000;
        const BLOCK: usize = 64;
        // One-block quantized loop, wet=1/dry=0 so the take auto-commits in a block.
        let mut looper = IrNode {
            id: NodeIdx(1),
            manifest_id: String::from(LOOPER_ID),
            kind: PrimitiveKind::Looper,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        };
        looper.params.push(Param {
            id: looper_param::LOOP_SECS,
            value: BLOCK as f32 / SR as f32,
        });
        looper.params.push(Param {
            id: looper_param::WET,
            value: 1.0,
        });
        looper.params.push(Param {
            id: looper_param::DRY,
            value: 0.0,
        });
        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: SR,
            block_size: BLOCK as u32,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(GAIN_ID),
                    kind: PrimitiveKind::GraphIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                looper,
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![
                IrEdge {
                    from_node: NodeIdx(0),
                    from_port: 0,
                    to_node: NodeIdx(1),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
                IrEdge {
                    from_node: NodeIdx(1),
                    from_port: 0,
                    to_node: NodeIdx(2),
                    to_port: 0,
                    kind: ConnectionType::Audio,
                },
            ],
            schedule: vec![],
        };
        let store = WasmAssetStore::default();
        let program = compile_with_assets(&graph, &reg, &store).expect("looper graph compiles");
        let mut engine = Engine::new(program);

        // RECORD, inject a known ramp, render one block -> auto-commit to Playing.
        engine.apply_rt(RtCommand::Looper {
            node: NodeIdx(1),
            action: looper_action::RECORD,
            arg: 0,
        });
        let signal: Vec<f32> = (0..BLOCK).map(|i| (i as f32) * 0.013 - 0.4).collect();
        let buf = engine.input_mut(NodeIdx(0), 0).expect("graphin buffer");
        buf[..BLOCK].copy_from_slice(&signal);
        let mut out = vec![0.0f32; BLOCK];
        engine.process_block(&mut out, BLOCK);

        // The committed layer's PCM (what `looper_take_pcm` returns) == the input.
        let slot = engine
            .program()
            .slot_of_id(NodeIdx(1))
            .expect("looper slot");
        let pcm = engine.program().instances[slot].last_committed_layer_pcm();
        assert_eq!(pcm.len(), BLOCK, "committed loop is one block long");
        for (i, (&x, &y)) in signal.iter().zip(pcm.iter()).enumerate() {
            assert!((x - y).abs() < 1e-6, "wasm commit pcm frame {i}: {x} != {y}");
        }
    }

    /// A `MicIn` source node, fed externally via `Engine::input_mut` (the buffer
    /// `mic_in_ptr` exposes to the worklet), flows downstream this block — the
    /// in-browser mic-input seam: the worklet writes the captured block into the
    /// MicIn output buffer, which the exec loop leaves intact, so it reaches the
    /// master.
    #[test]
    fn mic_in_injected_block_flows_to_master() {
        use ojproto::{ConnectionType, IrEdge};
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());
        // MicIn -> SpeakerOut: the simplest "monitor the mic" graph.
        let graph = OjGraph {
            ir_version: SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(ojcore::MIC_IN_ID),
                    kind: PrimitiveKind::MicIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(0),
                from_port: 0,
                to_node: NodeIdx(1),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        let store = WasmAssetStore::default();
        let program = compile_with_assets(&graph, &reg, &store).expect("mic graph compiles");
        let mut engine = Engine::new(program);

        // Inject a constant 0.5 into the MicIn source (what the worklet does each
        // block by writing into the buffer `mic_in_ptr` points at), then render.
        let buf = engine.input_mut(NodeIdx(0), 0).expect("mic-in buffer");
        for s in buf.iter_mut() {
            *s = 0.5;
        }
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        assert!(
            out.iter().take(64).all(|s| (*s - 0.5).abs() < 1e-6),
            "injected mic block must flow to the master output"
        );
    }
}
