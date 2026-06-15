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
    // host-bridged / extension
    FaustHost,
    WasmHost,
    PluginHost,
    // routing / io
    Add,
    MicIn,
    SpeakerOut,
    GraphIn,
    GraphOut,
    Passthrough,
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

/// Fixed-size, `Copy`, heap-free commands for the wait-free SPSC queue.
/// Transport is flattened (no nested enum) to keep the size tiny.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum RtCommand {
    SetParam { node: NodeIdx, param: u16, value: f32 },
    NoteOn { node: NodeIdx, note: u8, vel: u8 },
    NoteOff { node: NodeIdx, note: u8 },
    Bypass { node: NodeIdx, on: bool },
    TransportPlay,
    TransportPause,
    Seek { samples: u64 },
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
    Error {
        code: u16,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;
    use alloc::vec;

    #[test]
    fn param_patch_roundtrips() {
        let p = ParamPatch { node: 4321, param: 7, value: -0.5 };
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
            params: vec![Param { id: 0, value: 1000.0 }],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        };
        assert_eq!(n.kind, PrimitiveKind::Biquad);
        assert_eq!(n.params[0].value, 1000.0);
    }
}
