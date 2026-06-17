//! OpenJammer wire protocol + the `OjGraph` intermediate representation.
//!
//! This crate is the SINGLE source of truth for the UI<->engine contract
//! (governing principle #4). It is strictly **control-rate**: no audio sample
//! buffers (`&[f32]` / `Vec<f32>`) ever appear here. [`RtCommand`] is a small,
//! `Copy`, heap-free enum suitable for a wait-free SPSC ring; a compile-time
//! guard below enforces that it stays tiny — which mechanically rejects any
//! future variant that smuggles in a heap field or audio buffer.
#![no_std]
// Docs-as-requirement (plan §4.4): the wire contract is the public API, so every
// public item here must be documented. Enforced by the engine job's
// `cargo clippy -- -D warnings` and the `cargo doc -D warnings` gate (which
// promotes this lint to an error). The negative fixture in crates-doc-fixture/
// proves the gate actually fails on a missing doc.
#![warn(missing_docs)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Bumped on any breaking change to the IR / protocol shapes.
pub const SCHEMA_VERSION: u16 = 1;

/// Stable index for a node within a compiled [`OjGraph`] (interned from the
/// UI's string node id at `NodeAdd`, so the hot path never touches strings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NodeIdx(pub u32);

/// Handle to an off-RT-thread asset (sample PCM, waveshaper curve, impulse
/// response, Faust factory, ...). Blobs are NEVER inlined in the IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub u32);

/// The CLOSED primitive instruction set the real-time kernel matches on.
///
/// [`IrNode::manifest_id`] is the OPEN registry key; compilation lowers
/// `manifest_id -> PrimitiveKind`, so new manifest-registered nodes
/// (AI / Faust / hosted plugins) appear at runtime without editing this enum
/// (governing principle #2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrimitiveKind {
    // generators / instruments
    /// Oscillator generator (sine/saw/square/…).
    Osc,
    /// Sample player (PCM asset playback).
    Sampler,
    /// SoundFont (SF2) instrument.
    Sf2,
    /// Karplus–Strong plucked-string synth.
    KarplusString,
    // processors
    /// Linear gain / volume.
    Gain,
    /// Biquad filter (lowpass/highpass/peaking/…).
    Biquad,
    /// Waveshaper / distortion via a transfer curve.
    Waveshaper,
    /// Delay line.
    Delay,
    /// Convolution (impulse-response) processor.
    Convolution,
    // host-bridged / extension
    /// Faust-compiled DSP factory, host-bridged.
    FaustHost,
    /// wasm-hosted DSP node.
    WasmHost,
    /// CLAP/VST3/AU plugin host node.
    PluginHost,
    // routing / io
    /// Sums its inputs into one output.
    Add,
    /// Microphone / hardware input source.
    MicIn,
    /// Speaker / hardware output sink.
    SpeakerOut,
    /// Subgraph input boundary.
    GraphIn,
    /// Subgraph output boundary.
    GraphOut,
    /// Pass-through (identity) node.
    Passthrough,
    // stateful (U-STATEFUL)
    /// Looper (record/overdub/playback) node.
    Looper,
    /// Recorder capture node.
    Recorder,
}

/// Looper transport actions carried by [`RtCommand::Looper`], encoded as a
/// single `u8` so the command stays tiny and `Copy`. These drive a looper
/// node's state machine (idle -> armed -> recording -> playing -> overdubbing).
///
/// Kept as `u8` consts (not a serde enum) so the wire form of
/// [`RtCommand::Looper`] is a plain `{ "node": n, "action": k }` object — the TS
/// mirror reads `action` as a bare number, matching these values.
pub mod looper_action {
    /// Arm the looper: the next record begins capture from a clean (silent)
    /// loop buffer.
    pub const ARM: u8 = 0;
    /// Begin (or resume) recording the input into the loop buffer.
    pub const RECORD: u8 = 1;
    /// Play the recorded loop back (no new capture).
    pub const PLAY: u8 = 2;
    /// Stop playback/recording (loop contents retained).
    pub const STOP: u8 = 3;
    /// Clear the loop buffer back to silence and return to idle.
    pub const CLEAR: u8 = 4;
    /// Overdub: sum the input into the existing loop while playing it back.
    pub const OVERDUB: u8 = 5;
}

/// Edge signal kind. The UI's `universal` ports are RESOLVED to `Audio` or
/// `Control` at emit time and never reach the IR unresolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionType {
    /// An audio-rate signal edge (sample buffers).
    Audio,
    /// A control-rate signal edge (parameter modulation).
    Control,
}

/// A single numeric parameter on a node, addressed by `(NodeIdx, id)`
/// (the one param-addressing scheme, governing principle #5).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Param {
    /// Parameter id (stable within a node's manifest).
    pub id: u16,
    /// Parameter value.
    pub value: f32,
}

/// Binds an asset to a node input slot (e.g. a sample, an impulse response).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetRef {
    /// Which node input slot the asset binds to.
    pub slot: u16,
    /// The bound asset handle.
    pub asset: AssetId,
}

/// A node in the compiled graph. Flat and 1:1 with the visual graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IrNode {
    /// Stable interned node index.
    pub id: NodeIdx,
    /// Open registry key the node was registered under (lowered to [`kind`](Self::kind)).
    pub manifest_id: String,
    /// The closed primitive this node lowers to.
    pub kind: PrimitiveKind,
    /// Numeric parameters.
    pub params: Vec<Param>,
    /// Bound off-RT assets.
    pub assets: Vec<AssetRef>,
    /// Number of input ports.
    pub n_in: u8,
    /// Number of output ports.
    pub n_out: u8,
}

/// A directed connection between two node ports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrEdge {
    /// Source node.
    pub from_node: NodeIdx,
    /// Source output port index.
    pub from_port: u16,
    /// Destination node.
    pub to_node: NodeIdx,
    /// Destination input port index.
    pub to_port: u16,
    /// Whether the edge carries audio or control.
    pub kind: ConnectionType,
}

/// The whole compiled program pushed from the control plane to the engine.
/// `schedule` is precomputed topological execution waves (groups of nodes
/// that may run in order); fusion, if any, is a per-backend concern and never
/// appears here (governing principle #1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OjGraph {
    /// IR schema version (mirrors [`SCHEMA_VERSION`]).
    pub ir_version: u16,
    /// Engine sample rate this program was compiled for.
    pub sample_rate: u32,
    /// Engine processing block size (frames).
    pub block_size: u32,
    /// The graph nodes.
    pub nodes: Vec<IrNode>,
    /// The directed edges between node ports.
    pub edges: Vec<IrEdge>,
    /// Precomputed topological execution waves.
    pub schedule: Vec<Vec<NodeIdx>>,
}

impl OjGraph {
    /// An empty program for the given sample rate and block size.
    pub fn empty(sample_rate: u32, block_size: u32) -> Self {
        Self {
            ir_version: SCHEMA_VERSION,
            sample_rate,
            block_size,
            nodes: Vec::new(),
            edges: Vec::new(),
            schedule: Vec::new(),
        }
    }
}

/// Fixed-size, `Copy`, heap-free commands for the wait-free SPSC queue.
/// Transport is flattened (no nested enum) to keep the size tiny.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum RtCommand {
    /// Set a node parameter to a value.
    SetParam {
        node: NodeIdx,
        param: u16,
        value: f32,
    },
    /// Note-on for an instrument node.
    NoteOn {
        node: NodeIdx,
        note: u8,
        vel: u8,
    },
    /// Note-off for an instrument node.
    NoteOff {
        node: NodeIdx,
        note: u8,
    },
    /// Bypass (or un-bypass) a node.
    Bypass {
        node: NodeIdx,
        on: bool,
    },
    /// Start the transport.
    TransportPlay,
    /// Pause the transport.
    TransportPause,
    /// Seek the transport to an absolute sample position.
    Seek {
        samples: u64,
    },
    /// Drive a looper node's state machine. `action` is one of the
    /// [`looper_action`] consts (arm / record / play / stop / clear / overdub).
    /// `NodeIdx(u32)` + `u8` is 5 payload bytes — well within the 16-byte cap.
    Looper {
        node: NodeIdx,
        action: u8,
    },
}

// `RtCommand` MUST stay small and heap-free so it can live in a fixed-size
// lock-free ring. A `Vec`/`String` field (3 machine words = 24 bytes) or any
// audio payload would push this past the bound and FAIL the build — this is
// the mechanical enforcement of "nothing heap/audio crosses the RT seam".
const _: () = assert!(core::mem::size_of::<RtCommand>() <= 16);

/// Hot parameter patch: a hand-packed 7-byte frame (interned node id + param
/// id + value) for the highest-rate UI->RT path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParamPatch {
    /// Interned node id.
    pub node: u16,
    /// Parameter id.
    pub param: u8,
    /// Parameter value.
    pub value: f32,
}

impl ParamPatch {
    /// Wire size of a packed patch, in bytes.
    pub const BYTES: usize = 7;

    /// Pack the patch into its fixed 7-byte little-endian wire frame.
    pub fn to_bytes(&self) -> [u8; Self::BYTES] {
        let n = self.node.to_le_bytes();
        let v = self.value.to_le_bytes();
        [n[0], n[1], self.param, v[0], v[1], v[2], v[3]]
    }

    /// Unpack a patch from its fixed 7-byte little-endian wire frame.
    pub fn from_bytes(b: [u8; Self::BYTES]) -> Self {
        Self {
            node: u16::from_le_bytes([b[0], b[1]]),
            param: b[2],
            value: f32::from_le_bytes([b[3], b[4], b[5], b[6]]),
        }
    }
}

/// Engine -> UI frames. Control-rate only (serialized as JSON). There is
/// deliberately NO variant carrying audio samples.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EngineFrame {
    /// Periodic engine status snapshot.
    EngineState {
        running: bool,
        sample_rate: u32,
        block_size: u32,
        xruns: u32,
    },
    /// Per-node metering (RMS + peak).
    Meter {
        node: NodeIdx,
        rms: f32,
        peak: f32,
    },
    /// Acknowledgement that a pushed IR version was applied.
    IrAck {
        ir_version: u16,
        ok: bool,
    },
    /// Transport beat tick (bar/beat/phase).
    Beat {
        bar: u32,
        beat: u32,
        phase: f32,
    },
    /// A coded error frame with a human-readable message.
    Error {
        code: u16,
        message: String,
    },
}

/// Log severity, lowest to highest. Bare-variant-string serde (no `rename_all`),
/// mirrored on the TS side exactly like [`PrimitiveKind`] / [`ConnectionType`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity {
    /// Finest-grained tracing.
    Trace,
    /// Debug-level detail.
    Debug,
    /// Informational.
    Info,
    /// A warning.
    Warn,
    /// An error.
    Error,
}

/// Which side of the dual-target seam emitted the event. Bare-variant-string
/// serde, mirrored on the TS side exactly like [`PrimitiveKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Source {
    /// The native engine core.
    Engine,
    /// The browser wasm worklet.
    Wasm,
    /// The UI / control plane.
    Ui,
    /// The native desktop host (cpal / Tauri).
    Native,
}

/// The RT-emittable fault taxonomy. Each maps 1:1 onto an engine resilience
/// flag (`non_finite` / `over_budget` / `auto_bypass`). Bare-variant-string
/// serde, like [`PrimitiveKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FaultKind {
    /// A non-finite sample (NaN/Inf) was produced.
    NonFinite,
    /// The node exceeded its per-block time budget.
    OverBudget,
    /// The node was auto-bypassed after repeated faults.
    AutoBypassed,
}

/// The CLOSED, versioned, control-rate event taxonomy. EXTERNALLY tagged by
/// serde (matching [`RtCommand`] / [`EngineFrame`]): unit variants serialize as
/// a bare string, data variants as `{ "<Variant>": { ..fields.. } }`. `Message`
/// is the ONLY `String`-carrying variant. Versioned by the existing
/// [`SCHEMA_VERSION`] — there is NO second version axis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EventKind {
    /// Process/stream lifecycle (start, stop, device change).
    Lifecycle,
    /// A hot-swap of the running program landed.
    GraphSwap,
    /// Buffer underrun(s) since the last event; `dropped` is a coalesced count.
    Xrun { dropped: u32 },
    /// A per-node DSP fault (NaN / over-budget / auto-bypass).
    NodeFault { node: NodeIdx, fault: FaultKind },
    /// The event ring overflowed and dropped frames (drop-and-count).
    RingFull,
    /// Asset (sample / IR / SF2) load or decode event.
    Asset,
    /// CLAP / host-plugin lifecycle event.
    Plugin,
    /// MIDI in/out event.
    Midi,
    /// Collaboration / LAN-peer event.
    Collab,
    /// Free-form coded message — the single `String`-carrying variant.
    Message { code: u16, text: String },
}

/// The RT-safe `Copy` subset of [`EventKind`] that rides the `ByteRing`. NO heap
/// field is permitted: a `String`/`Vec` would push this past 16 bytes and FAIL
/// the build below — the same mechanical guard that protects [`RtCommand`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RtEvent {
    /// Buffer underrun(s); `dropped` is a coalesced count.
    Xrun { dropped: u32 },
    /// A per-node DSP fault.
    NodeFault { node: NodeIdx, fault: FaultKind },
    /// The event ring overflowed (drop-and-count).
    RingFull,
}

// Mirrors the proven `RtCommand` cap above. A heap field smuggled into
// `RtEvent` becomes a COMPILE error, not a runtime surprise.
const _: () = assert!(core::mem::size_of::<RtEvent>() <= 16);

/// The off-RT, control-rate event ENVELOPE every L1/L3/L4 consumer reads: the
/// decoded [`EventKind`] plus severity/source/timestamp/correlation metadata.
/// A plain struct, so serde serializes it as an object with these field names in
/// declaration order — mirrored byte-for-byte by the `oj-protocol-ts` `Event`
/// interface and pinned by `event_struct_shape` in `wire_shapes.rs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// Schema version (mirrors [`SCHEMA_VERSION`]).
    pub v: u16,
    /// Monotonic per-source sequence number.
    pub seq: u32,
    /// Severity.
    pub severity: Severity,
    /// The event taxonomy payload.
    pub kind: EventKind,
    /// Which side emitted it.
    pub source: Source,
    /// Engine-stamped timestamp, microseconds.
    pub ts_us: u64,
    /// Correlation id for click-to-correlate; `0` = none.
    pub corr_id: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;
    use alloc::vec;

    #[test]
    fn param_patch_roundtrips() {
        let p = ParamPatch {
            node: 4321,
            param: 7,
            value: -0.5,
        };
        assert_eq!(p.to_bytes().len(), ParamPatch::BYTES);
        assert_eq!(ParamPatch::from_bytes(p.to_bytes()), p);
    }

    #[test]
    fn rtcommand_is_copy_and_small() {
        fn assert_copy<T: Copy>() {}
        assert_copy::<RtCommand>();
        assert!(core::mem::size_of::<RtCommand>() <= 16);
    }

    #[test]
    fn empty_graph_has_current_schema() {
        let g = OjGraph::empty(48_000, 128);
        assert_eq!(g.ir_version, SCHEMA_VERSION);
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }

    #[test]
    fn ir_node_builds() {
        let n = IrNode {
            id: NodeIdx(1),
            manifest_id: String::from("builtin.biquad"),
            kind: PrimitiveKind::Biquad,
            params: vec![Param {
                id: 0,
                value: 1000.0,
            }],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        };
        assert_eq!(n.kind, PrimitiveKind::Biquad);
        assert_eq!(n.params[0].value, 1000.0);
    }
}
