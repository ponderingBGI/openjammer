//! UX-1A / D1 — one transport frame, two encodings.
//!
//! The browser tier had no transport return path at all: the worklet probed for
//! a `drain_transport` export that did not exist, so no acknowledgement ever
//! reached the UI and every Play ended in "the audio engine did not acknowledge
//! the transport command" after 1500 ms.
//!
//! The fix deliberately did NOT invent a browser transport frame. Both tiers now
//! read [`ojcore::Engine::transport_frame`] — the single assembler of
//! [`ojproto::EngineFrame::Transport`] — and only the *encoding* differs:
//!
//! * native: `meter::return_frame::encode_transport` onto the `std`-only ring;
//! * wasm:   `serde_json` over the same enum, straight to the worklet port.
//!
//! This test is the thing that keeps that true. If someone adds a field, changes
//! a unit, or re-derives the values on one side only, the two encodings stop
//! agreeing here.

#![cfg(feature = "std")]

use ojcore::meter::return_frame;
use ojcore::{
    compile, register_builtins, BuiltinOpts, Engine, MeterRing, PluginRegistry, SPEAKER_OUT_ID,
};
use ojproto::{EngineFrame, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};
use std::sync::Arc;

fn engine() -> Engine {
    let mut graph = OjGraph::empty(48_000, 128);
    graph.nodes = vec![IrNode {
        id: NodeIdx(1),
        manifest_id: SPEAKER_OUT_ID.into(),
        kind: PrimitiveKind::SpeakerOut,
        params: vec![],
        assets: vec![],
        n_in: 1,
        n_out: 0,
    }];
    let mut registry = PluginRegistry::new();
    register_builtins(&mut registry, BuiltinOpts::default());
    Engine::new(compile(&graph, &registry).unwrap())
}

/// The native byte encoding and the wasm JSON encoding decode to the SAME frame.
#[test]
fn the_native_ring_frame_and_the_wasm_json_frame_are_the_same_frame() {
    let mut engine = engine();
    let mut out = vec![0.0f32; 128];

    // Roll the transport so the frame carries a non-trivial position.
    engine.apply_rt(RtCommand::TransportPlay);
    for _ in 0..40 {
        engine.process_block(&mut out, 128);
    }

    let frame = engine.transport_frame_now();

    // --- the wasm encoding: serde JSON of the enum, externally tagged --------
    let json = serde_json::to_vec(&frame).expect("json encode");
    let via_json: EngineFrame = serde_json::from_slice(&json).expect("json decode");

    // --- the native encoding: the meter ring's fixed-width byte frame --------
    let EngineFrame::Transport {
        sample,
        tick,
        bar,
        beat,
        phase,
        motion,
        rec,
        loop_on,
    } = frame
    else {
        panic!("transport_frame_now must produce EngineFrame::Transport");
    };
    let mut buf = [0u8; return_frame::MAX_LEN];
    let n = return_frame::encode_transport(
        sample, tick, bar, beat, phase, motion, rec, loop_on, &mut buf,
    );
    let via_ring = return_frame::decode(&buf[..n]).expect("ring decode");

    assert_eq!(
        via_json, via_ring,
        "the two tiers must carry ONE transport frame, not two dialects of one"
    );
    assert_eq!(via_json, frame);
}

/// The JSON carries the exact key the worklet checks (`decoded.Transport`).
#[test]
fn the_json_is_externally_tagged_under_the_transport_key() {
    let mut engine = engine();
    let json = serde_json::to_vec(&engine.transport_frame_now()).expect("encode");
    let value: serde_json::Value = serde_json::from_slice(&json).expect("decode");
    assert!(
        value.get("Transport").is_some(),
        "ojcore-processor.ts reads `decoded.Transport`; the tag must be there"
    );
}

/// Playing advances the frame — the property the pill and the playhead need.
#[test]
fn a_rolling_transport_advances_the_frame() {
    let mut engine = engine();
    let mut out = vec![0.0f32; 128];

    let stopped = engine.transport_frame_now();
    engine.apply_rt(RtCommand::TransportPlay);
    for _ in 0..100 {
        engine.process_block(&mut out, 128);
    }
    let rolling = engine.transport_frame_now();

    let pos = |f: &EngineFrame| match *f {
        EngineFrame::Transport { sample, motion, .. } => (sample, motion),
        _ => panic!("expected Transport"),
    };
    let (sample_before, motion_before) = pos(&stopped);
    let (sample_after, motion_after) = pos(&rolling);

    assert_eq!(motion_before, 0, "a fresh engine is Stopped");
    assert_eq!(
        motion_after, 1,
        "after TransportPlay the frame reports Rolling"
    );
    assert!(
        sample_after > sample_before,
        "the playhead must advance: {sample_before} -> {sample_after}"
    );
}

/// The other half of the contract: pin the native PRODUCER, not just the codec.
///
/// The two tests above take one frame and encode it two ways, which proves the
/// encoders agree — but it would still pass if someone re-derived the position
/// inside `publish_levels` by hand instead of calling the shared assembler
/// (exactly the drift this work removed). So: attach a REAL meter ring, run a
/// real `process_block`, pop what the engine actually published, and require it
/// to be the frame `transport_frame_now()` reports.
#[test]
fn the_frame_the_native_ring_publishes_is_the_shared_assembler_s_frame() {
    let mut engine = engine();
    engine.set_metering(true);
    let ring: Arc<MeterRing> = Arc::new(MeterRing::new());
    engine.attach_meter_ring(Some(Arc::clone(&ring)));

    let mut out = vec![0.0f32; 128];
    engine.apply_rt(RtCommand::TransportPlay);
    for _ in 0..12 {
        engine.process_block(&mut out, 128);
    }

    // The LAST transport frame the engine pushed during those blocks.
    let mut buf = [0u8; return_frame::MAX_LEN];
    let mut published: Option<EngineFrame> = None;
    let mut beats = 0usize;
    while let Some(n) = ring.pop(&mut buf) {
        match return_frame::decode(&buf[..n]) {
            Some(frame @ EngineFrame::Transport { .. }) => published = Some(frame),
            Some(EngineFrame::Beat { .. }) => beats += 1,
            _ => {}
        }
    }
    let published = published.expect("metering publishes a Transport frame every block");
    assert!(beats > 0, "and a Beat frame beside it");

    // `transport_frame_now` reads the clock again, so the sample has not moved
    // (no block ran in between) and the two must be identical, field for field.
    let asked = engine.transport_frame_now();
    assert_eq!(
        published, asked,
        "publish_levels must publish the SHARED assembler's frame, not one it \
         re-derived: a divergence here is the drift the single-assembler \
         refactor exists to prevent"
    );

    match published {
        EngineFrame::Transport { motion, sample, .. } => {
            assert_eq!(motion, 1, "the engine was rolling");
            assert!(sample > 0, "and the playhead had advanced");
        }
        other => panic!("expected Transport, got {other:?}"),
    }
}

/// F1: a transport command that changes NOTHING is still acknowledged.
///
/// Seeking to the sample we are already parked at produces a byte-identical
/// frame. A return path that speaks only on change stays silent, and the UI's
/// 1500 ms acknowledgement timeout fires: "the audio engine did not acknowledge
/// the transport command" — one keystroke away, via Home at bar 1. The engine
/// therefore counts commands as well as describing state.
#[test]
fn a_repeated_identical_seek_advances_the_epoch_every_time() {
    let mut engine = engine();

    let before = engine.transport_epoch();
    let frame_before = engine.transport_frame_now();

    engine.apply_rt(RtCommand::Seek { samples: 0 });
    let after_first = engine.transport_epoch();
    engine.apply_rt(RtCommand::Seek { samples: 0 });
    let after_second = engine.transport_epoch();

    assert_eq!(after_first, before + 1, "the first seek is heard");
    assert_eq!(
        after_second,
        before + 2,
        "and so is a second, identical one — 'nothing to do' is still an answer"
    );
    assert_eq!(
        engine.transport_frame_now(),
        frame_before,
        "while the FRAME is deliberately unchanged, which is exactly why the \
         frame alone could never have acknowledged this"
    );
}

/// Every transport verb counts; nothing else does.
#[test]
fn the_epoch_tracks_transport_verbs_only() {
    let mut engine = engine();
    let start = engine.transport_epoch();

    engine.apply_rt(RtCommand::TransportPlay);
    engine.apply_rt(RtCommand::TransportPause);
    engine.apply_rt(RtCommand::Seek { samples: 4_800 });
    engine.apply_rt(RtCommand::TransportSet { flag: 0, on: true });
    assert_eq!(engine.transport_epoch(), start + 4);

    // A param write is not a transport verb.
    engine.apply_rt(RtCommand::SetParam {
        node: NodeIdx(1),
        param: 0,
        value: 0.5,
    });
    assert_eq!(
        engine.transport_epoch(),
        start + 4,
        "only transport commands advance the epoch"
    );
}
