//! OpenJammer wire protocol + the `OjGraph` intermediate representation.
//!
//! This crate is the SINGLE source of truth for the UI<->engine contract
//! (governing principle #4). It is strictly **control-rate**: no audio sample
//! buffers (`&[f32]` / `Vec<f32>`) ever appear here. [`RtCommand`] is a small,
//! `Copy`, heap-free enum suitable for a wait-free SPSC ring; a compile-time
//! guard below enforces that it stays tiny — which mechanically rejects any
//! future variant that smuggles in a heap field or audio buffer.
#![no_std]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Bumped on any breaking change to the IR / protocol shapes.
pub const SCHEMA_VERSION: u16 = 1;

/// Musical timeline resolution in quarter-note ticks.
pub const PPQ: u32 = 960;

/// Stable index for a node within a compiled [`OjGraph`] (interned from the
/// UI's string node id at `NodeAdd`, so the hot path never touches strings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NodeIdx(pub u32);

/// Handle to an off-RT-thread asset (sample PCM, waveshaper curve, impulse
/// response, Faust factory, ...). Blobs are NEVER inlined in the IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub u32);

/// The unit domain carried by a timeline position or duration.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeDomain {
    /// Absolute audio samples.
    Audio = 0,
    /// Musical quarter-note ticks at [`PPQ`].
    Beat = 1,
}

/// A timeline position that retains the domain of its numeric value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TimePos {
    /// Whether `value` is expressed in samples or quarter-note ticks.
    pub domain: TimeDomain,
    /// Samples for [`TimeDomain::Audio`], or ticks at [`PPQ`] for
    /// [`TimeDomain::Beat`].
    pub value: i64,
}

/// A duration in one time domain; its origin is the owning position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TimeSpan {
    /// Whether `len` is expressed in samples or quarter-note ticks.
    pub domain: TimeDomain,
    /// Duration in the selected domain.
    pub len: i64,
}

/// A synchronized tempo-map point in musical and audio coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TempoPoint {
    /// Musical position in quarter-note ticks at [`PPQ`].
    pub tick: u64,
    /// Corresponding absolute audio-sample position.
    pub sample: u64,
    /// Tempo in beats per minute at the start of this segment.
    pub bpm_start: f32,
    /// Tempo in beats per minute at the end of this segment.
    pub bpm_end: f32,
    /// Whether the segment's ending tempo comes from the next tempo point.
    pub continuing: bool,
}

/// A synchronized meter-map point in musical, audio, and bar coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeterPoint {
    /// Musical position in quarter-note ticks at [`PPQ`].
    pub tick: u64,
    /// Corresponding absolute audio-sample position.
    pub sample: u64,
    /// One-based bar number at this point.
    pub bar: u32,
    /// Number of meter beats in each bar.
    pub divisions_per_bar: u8,
    /// Note value that represents one meter beat.
    pub note_value: u8,
}

/// A complete tempo and meter document published independently of [`OjGraph`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TempoMap {
    /// Musical resolution used by this map; normally [`PPQ`].
    pub ppq: u32,
    /// Audio sample rate used by the synchronized sample coordinates.
    pub sample_rate: u32,
    /// Tempo points in strictly increasing musical order.
    pub tempos: Vec<TempoPoint>,
    /// Meter points in strictly increasing musical order.
    pub meters: Vec<MeterPoint>,
}

/// The CLOSED primitive instruction set the real-time kernel matches on.
///
/// [`IrNode::manifest_id`] is the OPEN registry key; compilation lowers
/// `manifest_id -> PrimitiveKind`, so new manifest-registered nodes
/// (AI / Faust / hosted plugins) appear at runtime without editing this enum
/// (governing principle #2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrimitiveKind {
    // generators / instruments
    Osc,
    Sampler,
    Sf2,
    KarplusString,
    // processors
    Gain,
    Biquad,
    Waveshaper,
    Delay,
    Convolution,
    /// Stereo panner: one mono audio input -> a 2-channel (stereo) audio output.
    /// The first built-in node with `audio_out_channels = 2` (docs/CHANNELS.md).
    Pan,
    /// Stereo width (mid/side): a 2-channel audio input -> a 2-channel output. The
    /// first built-in node with `audio_in_channels = 2` (docs/CHANNELS.md).
    Width,
    // host-bridged / extension
    FaustHost,
    WasmHost,
    PluginHost,
    // routing / io
    Add,
    Subtract,
    Multiply,
    MicIn,
    SpeakerOut,
    GraphIn,
    GraphOut,
    Passthrough,
    // stateful (U-STATEFUL)
    Looper,
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
    /// Undo the most-recently committed layer (LIFO). `arg` is ignored.
    pub const UNDO_LAST: u8 = 6;
    /// Set a layer's mute flag. `arg` is the layer index in its low 31 bits;
    /// the high bit ([`MUTE_FLAG`]) carries the desired muted state (set =
    /// muted, clear = unmuted). One action covers both mute and unmute.
    pub const SET_MUTE: u8 = 7;
    /// Delete a layer by index. `arg` is the layer index.
    pub const DELETE_LAYER: u8 = 8;

    /// High bit of [`RtCommand::Looper`](crate::RtCommand::Looper)'s `arg` for
    /// [`SET_MUTE`]: when set, the addressed layer is muted; when clear, it is
    /// unmuted. The remaining bits are the layer index.
    pub const MUTE_FLAG: u32 = 1 << 31;
}

/// Looper state-machine state codes carried by [`EngineFrame::Looper`] and the
/// `from`/`to` fields of [`RtEvent::LooperEdge`] / [`EventKind::LooperEdge`].
///
/// These MIRROR the `ojcore::LooperState` discriminant order exactly (it has
/// explicit discriminants and an `as_u8` plain-cast), so the engine emits these
/// bytes verbatim and the TS mirror reads them as bare numbers. Kept as `u8`
/// consts (not a serde enum) so the wire frames stay a flat number — the same
/// pattern as [`looper_action`].
pub mod looper_state {
    /// No loop captured / not running.
    pub const IDLE: u8 = 0;
    /// Armed: the next record begins capture.
    pub const ARMED: u8 = 1;
    /// Recording a from-scratch first take (sets the loop length).
    pub const RECORDING: u8 = 2;
    /// Playing back the committed layers.
    pub const PLAYING: u8 = 3;
    /// Recording a new layer on top of existing playing layers.
    pub const OVERDUBBING: u8 = 4;
}

/// Edge signal kind. The UI's `universal` ports are RESOLVED to `Audio` or
/// `Control` at emit time and never reach the IR unresolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionType {
    Audio,
    Control,
}

/// A single numeric parameter on a node, addressed by `(NodeIdx, id)`
/// (the one param-addressing scheme, governing principle #5).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub id: u16,
    pub value: f32,
}

/// Binds an asset to a node input slot (e.g. a sample, an impulse response).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetRef {
    pub slot: u16,
    pub asset: AssetId,
}

/// A node in the compiled graph. Flat and 1:1 with the visual graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IrNode {
    pub id: NodeIdx,
    pub manifest_id: String,
    pub kind: PrimitiveKind,
    pub params: Vec<Param>,
    pub assets: Vec<AssetRef>,
    pub n_in: u8,
    pub n_out: u8,
}

/// A directed connection between two node ports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrEdge {
    pub from_node: NodeIdx,
    pub from_port: u16,
    pub to_node: NodeIdx,
    pub to_port: u16,
    pub kind: ConnectionType,
}

/// The whole compiled program pushed from the control plane to the engine.
/// `schedule` is precomputed topological execution waves (groups of nodes
/// that may run in order); fusion, if any, is a per-backend concern and never
/// appears here (governing principle #1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OjGraph {
    pub ir_version: u16,
    pub sample_rate: u32,
    pub block_size: u32,
    pub nodes: Vec<IrNode>,
    pub edges: Vec<IrEdge>,
    pub schedule: Vec<Vec<NodeIdx>>,
}

/// A compact, sample-addressed event stored in a published [`Timeline`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SchedEvent {
    /// Absolute timeline sample at which the event is applied.
    pub at: u64,
    /// Target node.
    pub node: NodeIdx,
    /// Numeric event kind: note-on, note-off, or parameter change.
    pub kind: u8,
    /// First kind-specific byte payload.
    pub a: u8,
    /// Second kind-specific byte payload.
    pub b: u8,
    /// Kind-specific floating-point payload.
    pub value: f32,
}

/// Event-kind codes carried by [`SchedEvent::kind`].
///
/// The numeric order is also the deterministic same-sample ordering rank:
/// parameter changes, note-offs, then note-ons.
pub mod sched_event_kind {
    /// Change a node parameter; kind-specific fields identify the parameter and
    /// [`SchedEvent::value`](crate::SchedEvent::value) carries its new value.
    pub const SET_PARAM: u8 = 0;
    /// Release a note.
    pub const NOTE_OFF: u8 = 1;
    /// Start a note.
    pub const NOTE_ON: u8 = 2;
}

/// An immutable, authored timeline document published as a whole.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timeline {
    /// Audio sample rate used by all sample positions in this document.
    pub sample_rate: u32,
    /// Events sorted by sample and then by their event-kind rank.
    pub events: Vec<SchedEvent>,
    /// Optional half-open loop range `(start, end)` in timeline samples.
    pub loop_range: Option<(u64, u64)>,
    /// Optional half-open punch range `(start, end)` in timeline samples.
    pub punch_range: Option<(u64, u64)>,
    /// End of the authored timeline in samples.
    pub end: u64,
}

impl OjGraph {
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

/// Boolean transport settings carried by [`RtCommand::TransportSet`].
///
/// These are bare `u8` values rather than a serde enum so the command remains a
/// flat numeric wire object and stays within its fixed-size bound.
pub mod transport_flag {
    /// Enable or disable looping over the timeline's loop range.
    pub const LOOP_ENABLE: u8 = 0;
    /// Enable or disable punching over the timeline's punch range.
    pub const PUNCH_ENABLE: u8 = 1;
    /// Arm or disarm recording.
    pub const RECORD_ARM: u8 = 2;
    /// Enable or disable the metronome click.
    pub const CLICK: u8 = 3;
}

/// Fixed-size, `Copy`, heap-free commands for the wait-free SPSC queue.
/// Transport is flattened (no nested enum) to keep the size tiny.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum RtCommand {
    SetParam {
        node: NodeIdx,
        param: u16,
        value: f32,
    },
    NoteOn {
        node: NodeIdx,
        note: u8,
        vel: u8,
    },
    NoteOff {
        node: NodeIdx,
        note: u8,
    },
    Bypass {
        node: NodeIdx,
        on: bool,
    },
    TransportPlay,
    TransportPause,
    Seek {
        samples: u64,
    },
    /// Set one boolean transport option. `flag` is one of the
    /// [`transport_flag`] constants.
    TransportSet {
        /// Setting identifier from [`transport_flag`].
        flag: u8,
        /// New enabled state.
        on: bool,
    },
    /// Drive a looper node's state machine. `action` is one of the
    /// [`looper_action`] consts (arm / record / play / stop / clear / overdub /
    /// undo_last / set_mute / delete_layer). `arg` addresses a layer for the
    /// indexed actions (set_mute / delete_layer) — see [`looper_action`] for the
    /// per-action encoding (e.g. set_mute packs the muted flag in
    /// [`looper_action::MUTE_FLAG`]) — and is ignored by the transport actions.
    /// `NodeIdx(u32)` + `u8` + `u32` is 9 payload bytes — within the 16-byte cap.
    Looper {
        node: NodeIdx,
        action: u8,
        arg: u32,
    },
}

// `RtCommand` MUST stay small and heap-free so it can live in a fixed-size
// lock-free ring. A `Vec`/`String` field (3 machine words = 24 bytes) or any
// audio payload would push this past the bound and FAIL the build — this is
// the mechanical enforcement of "nothing heap/audio crosses the RT seam".
const _: () = assert!(core::mem::size_of::<RtCommand>() <= 16);

/// A live command scheduled at an absolute timeline sample.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TimedCommand {
    /// Absolute timeline sample at which `cmd` is applied.
    pub at: u64,
    /// Fixed-size command to apply.
    pub cmd: RtCommand,
}

// Timed commands ride their own fixed-size event ring. Keep the timestamped
// wrapper bounded without widening the frozen `RtCommand` shape.
const _: () = assert!(core::mem::size_of::<TimedCommand>() <= 24);

/// Hot parameter patch: a hand-packed 7-byte frame (interned node id + param
/// id + value) for the highest-rate UI->RT path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParamPatch {
    pub node: u16,
    pub param: u8,
    pub value: f32,
}

impl ParamPatch {
    pub const BYTES: usize = 7;

    pub fn to_bytes(&self) -> [u8; Self::BYTES] {
        let n = self.node.to_le_bytes();
        let v = self.value.to_le_bytes();
        [n[0], n[1], self.param, v[0], v[1], v[2], v[3]]
    }

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
    EngineState {
        running: bool,
        sample_rate: u32,
        block_size: u32,
        xruns: u32,
    },
    Meter {
        node: NodeIdx,
        rms: f32,
        peak: f32,
    },
    IrAck {
        ir_version: u16,
        ok: bool,
    },
    Beat {
        bar: u32,
        beat: u32,
        phase: f32,
    },
    /// Authoritative control-rate transport position and state.
    Transport {
        /// Timeline sample position, with any engine preroll removed.
        sample: u64,
        /// Musical position in quarter-note ticks at [`PPQ`].
        tick: u64,
        /// One-based bar number.
        bar: u32,
        /// One-based meter beat within the bar.
        beat: u16,
        /// Fractional progress through the current beat.
        phase: f32,
        /// Numeric transport motion-state code.
        motion: u8,
        /// Whether recording is armed.
        rec: bool,
        /// Whether timeline looping is enabled.
        loop_on: bool,
    },
    /// Control-rate looper telemetry for one looper node, published every block
    /// from the (ungated) looper-publish path. Carries NO audio buffer — only
    /// the playhead/length/state needed to draw the loop row + playhead. `state`
    /// is one of the [`looper_state`] codes; `pos`/`loop_len` are sample frames;
    /// `peak` is the node's last-block output peak for the level meter.
    Looper {
        node: NodeIdx,
        state: u8,
        pos: u32,
        loop_len: u32,
        peak: f32,
    },
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
    /// The node's foreign code (a hosted VST3/CLAP plugin) CRASHED at runtime and
    /// latched to a dry passthrough (the crash-isolation latch). Distinct from
    /// `AutoBypassed` (the watchdog) — this is the per-node fault boundary catching
    /// a real segfault. Surfaces the same "(missing/crashed plugin)" node badge as
    /// the load-degraded path; cleared by a fresh instantiate on the next graph swap.
    Crashed,
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
    /// A looper node's state machine transitioned (e.g. recording -> playing on
    /// commit). `from`/`to` are [`looper_state`] codes. Rides the loss-proof
    /// EVENT ring (not the lossy meter ring) so a transition is never dropped.
    LooperEdge { node: NodeIdx, from: u8, to: u8 },
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
    /// A looper node's state machine transitioned. `from`/`to` are
    /// [`looper_state`] codes. `NodeIdx(u32)` + two `u8` = 6 payload bytes,
    /// well within the 16-byte cap proven below.
    LooperEdge { node: NodeIdx, from: u8, to: u8 },
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
/// interface and pinned by wire-shape tests.
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
