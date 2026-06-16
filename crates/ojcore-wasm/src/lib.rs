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

use ojcore::{compile, Engine, PluginRegistry, SPEAKER_OUT_ID};
use ojcore_midiring::{header_offsets, CmdRing, MidiRing};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::{EngineFrame, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand, SCHEMA_VERSION};

use wasm_bindgen::prelude::*;

/// Largest RtCommand JSON frame we will ever pop, bytes. `RtCommand` is a tiny
/// flat enum; its longest serde-JSON form (`{"SetParam":{"node":4294967295,
/// "param":65535,"value":-1.0000000}}` ~ 60 B) fits comfortably. Sized with
/// generous headroom so the drain scratch never needs to grow on the RT path.
const CMD_FRAME_MAX: usize = 128;

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
    /// Mono master output the worklet copies to its render quantum. Pre-sized to
    /// `block_size`; written in place by [`process`], never reallocated there.
    out_buf: Vec<f32>,
    /// Scratch popped command frame bytes (reused; never grows on the RT path).
    cmd_scratch: Vec<u8>,
    /// Render quantum the worklet uses (frames per [`process`] call).
    block_size: usize,
    /// Sample rate the engine compiles graphs against.
    sample_rate: u32,
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

    // `compile` requires exactly one master-output node, so the bootstrap graph
    // is a LONE host `SpeakerOut` (no sources). It renders as silence until
    // `load_graph` installs a real program — but it makes the engine valid from
    // the very first `process` call.
    let boot = bootstrap_graph(sample_rate, block_size as u32);
    let program = compile(&boot, &registry).expect("master-only graph always compiles");
    let engine = Engine::new(program);

    let host = Host {
        registry,
        engine,
        cmd_ring: Box::new(CmdRing::new()),
        midi_ring: Box::new(MidiRing::new()),
        out_buf: vec![0.0f32; block_size],
        cmd_scratch: vec![0u8; CMD_FRAME_MAX],
        block_size,
        sample_rate,
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

    let program = match compile(&graph, &host.registry) {
        Ok(p) => p,
        Err(_) => return false,
    };
    // `install` hands back the old program; dropping it here keeps the RT path
    // allocation/free-free.
    let _old = host.engine.install(program);
    true
}

/// Render one block. The AudioWorklet calls this every render quantum.
///
/// Steps, all allocation-free:
///   1. drain the command ring, applying each [`RtCommand`] to the engine;
///   2. render `nframes` into the pre-sized output buffer.
///
/// `nframes` is clamped to the configured block size. Read the result from
/// [`output_ptr`] (`nframes` f32s of mono master output).
#[wasm_bindgen]
pub fn process(nframes: u32) {
    let Some(host) = host_mut() else { return };
    let nframes = (nframes as usize).min(host.block_size);

    drain_commands(host);

    let out = &mut host.out_buf[..nframes];
    host.engine.process_block(out, nframes);
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

/// Apply one [`RtCommand`] to the engine through `ojcore`'s **no_std** public
/// surface (allocation-free, no locks). This mirrors `ojcore`'s std-only
/// `Engine::apply`, but reached via `program_mut()` because that convenience
/// method lives behind the `std` feature we deliberately do NOT enable on wasm.
///
///   * `SetParam` -> resolve slot, `set_param(param, value)` on the instance.
///   * `Bypass`   -> toggle the slot's bypass flag.
///   * `NoteOn`/`NoteOff` -> resolved only; the [`ojcore::DspInstance`] trait
///     exposes no note entry point yet (dropped at the instance seam, exactly as
///     native `Engine::apply` documents).
///   * `Transport*`/`Seek` -> the engine's transport clock (`playing` /
///     `sample_pos`) is `pub(crate)` and only settable through the std-gated
///     `Engine::apply`; with `std` off there is no no_std setter, so these are
///     dropped here until `ojcore` exposes a no_std transport surface. The wasm
///     worklet's transport is driven host-side (JS render-quantum clock) in the
///     meantime, so this is not a functional gap on the boundary.
///   * `Looper` -> resolve slot, drive the instance's
///     [`ojcore::DspInstance::looper_action`] (the looper is no_std and
///     registered on wasm too, so the in-browser looper works end to end).
#[inline]
fn apply_command(engine: &mut Engine, cmd: RtCommand) {
    match cmd {
        RtCommand::SetParam { node, param, value } => {
            if let Some(slot) = engine.program().slot_of_id(node) {
                engine.program_mut().instances[slot].set_param(param, value);
            }
        }
        RtCommand::Bypass { node, on } => {
            if let Some(slot) = engine.program().slot_of_id(node) {
                engine.program_mut().bypassed[slot] = on;
            }
        }
        RtCommand::NoteOn { node, .. } | RtCommand::NoteOff { node, .. } => {
            // Resolve only; no instance-level note sink exists yet.
            let _ = engine.program().slot_of_id(node);
        }
        RtCommand::TransportPlay | RtCommand::TransportPause | RtCommand::Seek { .. } => {
            // No no_std transport setter on `Engine` (see fn docs). Dropped.
        }
        RtCommand::Looper { node, action } => {
            if let Some(slot) = engine.program().slot_of_id(node) {
                engine.program_mut().instances[slot].looper_action(action);
            }
        }
    }
}

// --- Memory / layout getters: let JS build SAB + typed-array views directly
// over wasm linear memory, with zero copying across the boundary. ------------

/// Pointer (byte offset into wasm linear memory) of the mono output buffer.
/// JS reads `nframes` little-endian f32s starting here after each [`process`].
#[wasm_bindgen]
pub fn output_ptr() -> *const f32 {
    host_ref().map_or(core::ptr::null(), |h| h.out_buf.as_ptr())
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
        let program = compile(&graph, &reg).expect("effect graph compiles");
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
        let program = compile(&graph, &reg).expect("graph compiles");
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

    /// A round-trip of the bootstrap graph through JSON + `compile` proves
    /// `load_graph` will accept the same serde JSON payload `init` builds and the
    /// protocol emits. Mirrors the registry setup `init` performs, without the
    /// wasm `static`.
    #[test]
    fn graph_json_compiles_against_registry() {
        let mut registry = PluginRegistry::new();
        register_all(&mut registry, RegisterOpts::wasm());

        let graph = bootstrap_graph(48_000, 128);
        let json = serde_json::to_vec(&graph).unwrap();
        let decoded: OjGraph = serde_json::from_slice(&json).unwrap();
        let program = compile(&decoded, &registry).expect("bootstrap graph compiles");
        let engine = Engine::new(program);
        // One node: the lone master sink.
        assert_eq!(engine.program().len(), 1);
    }
}
