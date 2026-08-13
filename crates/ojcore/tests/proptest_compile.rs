//! Property tests for `compile()` (Track A P0a — the proptest on-ramp, applied to
//! the graph compiler).
//!
//! `compile` is the off-RT step that PROVES the acyclic-schedule invariant the
//! hot loop then assumes. A single example test can't cover the space of graphs a
//! user (or the AI) can author, so these assert the invariant over generated
//! input: an acyclic chain always compiles, ANY back-edge is rejected as a cycle
//! (never silently patched), and a random forward-edge DAG never makes the
//! compiler PANIC — the compile-time analogue of the nightly wav-decode fuzz.
//!
//! Only compiled with `std` (the compiler's `Vec`/registry path); under
//! `--no-default-features` this file is empty.
#![cfg(feature = "std")]

use ojcore::{compile, CompileError, GainLoader, PluginRegistry, GAIN_ID};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};
use proptest::prelude::*;

fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg
}

fn node(id: u32, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: GAIN_ID.into(),
        kind,
        params: Vec::new(),
        assets: Vec::new(),
        n_in,
        n_out,
    }
}

fn edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

/// A valid spine: `GraphIn(0) -> Gain(1) -> .. -> Gain(n) -> SpeakerOut(n+1)`.
/// `GraphIn`/`SpeakerOut` reuse the gain manifest only so they resolve; their
/// `kind` is what the compiler keys on.
fn chain(n: u32, block: u32) -> OjGraph {
    let mut g = OjGraph::empty(48_000, block);
    g.nodes.push(node(0, PrimitiveKind::GraphIn, 0, 1));
    for i in 1..=n {
        g.nodes.push(node(i, PrimitiveKind::Gain, 1, 1));
    }
    let spk = n + 1;
    g.nodes.push(node(spk, PrimitiveKind::SpeakerOut, 1, 0));
    // Wire the spine: 0 -> 1 -> .. -> n -> spk (or 0 -> spk when there are no gains).
    g.edges.push(edge(0, if n >= 1 { 1 } else { spk }));
    for i in 1..n {
        g.edges.push(edge(i, i + 1));
    }
    if n >= 1 {
        g.edges.push(edge(n, spk));
    }
    g
}

proptest! {
    /// An acyclic chain always compiles, at any length and any supported block size.
    #[test]
    fn acyclic_chain_compiles(
        n in 0u32..6,
        block in prop::sample::select(vec![32u32, 64, 128, 256]),
    ) {
        let g = chain(n, block);
        prop_assert!(compile(&g, &registry()).is_ok());
    }

    /// ANY back-edge (a strictly-later node feeding an earlier one) is rejected as
    /// a cycle — the hard rejection the RT path's safety rests on, never a panic.
    #[test]
    fn back_edge_is_rejected_as_cycle(n in 2u32..6, pick in 0u32..1000) {
        // Both endpoints are GAIN nodes (ids 1..=n), which have an input AND an
        // output port — so the back-edge is well-wired and the ONLY defect is the
        // cycle (avoids GraphIn, which has no input port, and SpeakerOut, no output).
        let lo = 1 + (pick % (n - 1)); // gain id in [1, n-1]
        let hi = lo + 1;               // gain id in [2, n]
        let mut g = chain(n, 64);
        g.edges.push(edge(hi, lo)); // hi -> lo closes a cycle (lo -> .. -> hi -> lo)
        prop_assert!(matches!(
            compile(&g, &registry()),
            Err(CompileError::Cycle)
        ));
    }

    /// A random FORWARD-edge DAG laid over the valid spine never makes the compiler
    /// PANIC: it returns `Ok` or a typed `CompileError`, but never crashes. (The
    /// acyclic invariant is proven, not assumed.)
    #[test]
    fn random_forward_dag_never_panics(
        n in 1u32..6,
        raw in prop::collection::vec((0u32..8, 0u32..8), 0..16),
    ) {
        let mut g = chain(n, 64);
        let max_id = n + 1; // SpeakerOut id
        for (a, b) in raw {
            let a = a % (max_id + 1);
            let b = b % (max_id + 1);
            if a < b {
                g.edges.push(edge(a, b)); // forward-only keeps it acyclic
            }
        }
        // The contract under test is "no panic"; Ok and Err are both acceptable.
        let _ = compile(&g, &registry());
    }
}
