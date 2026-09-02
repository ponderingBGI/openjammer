//! UX-1A / D2 regression: a decaying tail is not a fault.
//!
//! The starter "jam" rig is `Sampler -> Delay(feedback 0.34, time 0.3, mix 0.28)
//! -> SpeakerOut`. One key press used to raise a permanent, player-facing
//! "this node is sending noise we can't play" card ~18 seconds later, ~10x/s,
//! forever. Two independent defects stacked:
//!
//! 1. Nothing floored the delay's recirculating feedback write, so at 0.34
//!    feedback the tail needed ~60 laps (~18 s) to decay into the subnormal band
//!    - and then recirculated there for the life of the node.
//! 2. `ojcore::sanitize` returned ONE boolean for NaN/Inf, the denormal flush AND
//!    the +/-4 headroom clamp, and the master-out guard raised
//!    `FaultKind::NonFinite` from it. A denormal flush was indistinguishable from
//!    real garbage.
//!
//! These tests pin the ENGINE half: 30 seconds of silence after an impulse must
//! be fault-free, and a genuine NaN must still be reported.
//!
//! Deliberately NOT asserted here: that the master buffer contains no subnormals.
//! `sanitize` runs on that buffer in the same block, so it has already flushed
//! any — the assertion would be vacuous and would read as proof of something it
//! cannot see. The kernel state that the floor actually protects is inspected
//! directly in `ojcore-dsp`'s
//! `delay_feedback_state_never_parks_in_the_subnormal_band`.

#![cfg(feature = "std")]

use ojcore::effects::delay_param;
use ojcore::{
    compile, register_builtins, BuiltinOpts, Engine, PluginRegistry, DELAY_ID, GAIN_ID,
    SPEAKER_OUT_ID,
};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, PrimitiveKind};

const SR: u32 = 48_000;
const BLOCK: usize = 128;

/// The jam rig's signal chain, minus the instrument: `GraphIn -> Delay ->
/// SpeakerOut`, with the delay on the exact preset values from
/// `src/rigs/presets.ts` (feedback 0.34, time 0.3 s, mix 0.28).
fn jam_delay_engine() -> Engine {
    let mut graph = OjGraph::empty(SR, BLOCK as u32);
    graph.nodes = vec![
        IrNode {
            id: NodeIdx(1),
            manifest_id: GAIN_ID.into(),
            kind: PrimitiveKind::GraphIn,
            params: vec![],
            assets: vec![],
            n_in: 0,
            n_out: 1,
        },
        IrNode {
            id: NodeIdx(2),
            manifest_id: DELAY_ID.into(),
            kind: PrimitiveKind::Delay,
            params: vec![
                Param {
                    id: delay_param::TIME,
                    value: 0.3,
                },
                Param {
                    id: delay_param::FEEDBACK,
                    value: 0.34,
                },
                Param {
                    id: delay_param::MIX,
                    value: 0.28,
                },
            ],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        },
        IrNode {
            id: NodeIdx(3),
            manifest_id: SPEAKER_OUT_ID.into(),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        },
    ];
    graph.edges = vec![
        IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        },
        IrEdge {
            from_node: NodeIdx(2),
            from_port: 0,
            to_node: NodeIdx(3),
            to_port: 0,
            kind: ConnectionType::Audio,
        },
    ];
    let mut registry = PluginRegistry::new();
    register_builtins(&mut registry, BuiltinOpts::default());
    Engine::new(compile(&graph, &registry).unwrap())
}

/// Write `value` into every frame of the `GraphIn` source buffer for one block.
fn feed(engine: &mut Engine, value: f32) {
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        for s in buf.iter_mut() {
            *s = value;
        }
    }
}

#[test]
fn thirty_seconds_of_delay_tail_raises_no_fault() {
    let mut engine = jam_delay_engine();
    let mut out = vec![0.0f32; BLOCK];

    // One impulse block at full scale, then 30 s of silence — a single key press.
    feed(&mut engine, 1.0);
    engine.process_block(&mut out, BLOCK);
    assert!(
        !engine.budget().any_flagged(),
        "the impulse block itself must be clean"
    );

    let blocks = (SR as usize * 30) / BLOCK; // 11_250 blocks == 30 s.
    for i in 0..blocks {
        feed(&mut engine, 0.0);
        engine.process_block(&mut out, BLOCK);
        assert!(
            !engine.budget().any_flagged(),
            "a decaying delay tail raised an engine fault at block {i} (t = {:.2}s). \
             A tail is healthy audio; only NaN/Inf may be reported.",
            (i * BLOCK) as f32 / SR as f32,
        );
    }
}

#[test]
fn a_real_nan_still_faults() {
    let mut engine = jam_delay_engine();
    let mut out = vec![0.0f32; BLOCK];

    feed(&mut engine, f32::NAN);
    engine.process_block(&mut out, BLOCK);

    assert!(
        engine.budget().any_flagged(),
        "genuine garbage must still be reported — the denormal fix must not \
         silence the fault channel it shares"
    );
    assert!(
        engine.budget().non_finite.iter().any(|&b| b),
        "the raised flag must be `non_finite`"
    );
    assert!(
        out.iter().all(|s| s.is_finite()),
        "NaN must still be flushed out of the device buffer"
    );
}

#[test]
fn an_inf_still_faults() {
    let mut engine = jam_delay_engine();
    let mut out = vec![0.0f32; BLOCK];

    feed(&mut engine, f32::INFINITY);
    engine.process_block(&mut out, BLOCK);

    assert!(
        engine.budget().non_finite.iter().any(|&b| b),
        "an infinity is garbage too"
    );
    assert!(out.iter().all(|s| s.is_finite()));
}
