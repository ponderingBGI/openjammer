//! U4 engine-core integration tests: compile -> exec -> command -> swap, plus
//! the required `assert_no_alloc` hot-loop gate.
//!
//! These exercise the `std` feature (command ring + graph swap) and run on the
//! default feature set. Under `--no-default-features` the file compiles to
//! nothing (the engine core has its own no_std-friendly unit tests elsewhere).
//! The `assert_no_alloc` allocator is installed as the global allocator for
//! THIS test binary only, so the `process_block` no-alloc proof is genuine
//! without affecting the library.
//!
//! Signal model: a `GraphIn` source node carries a host-injected known input
//! (the executor leaves source output buffers intact), so a
//! `GraphIn -> Gain -> SpeakerOut` graph lets us assert `out == input * gain`.
#![cfg(feature = "std")]

use assert_no_alloc::*;
use ojcore::{
    compile, CommandQueue, CompileError, Engine, GainLoader, PluginRegistry, ProgramSwap, GAIN_ID,
    GAIN_PARAM,
};
use ojproto::{
    ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, PrimitiveKind, RtCommand,
};

// In debug builds this allocator aborts on any allocation inside an
// `assert_no_alloc(..)` scope, turning the no-alloc invariant into a hard gate.
#[cfg(debug_assertions)]
#[global_allocator]
static A: AllocDisabler = AllocDisabler;

const SR: u32 = 48_000;
const BLOCK: u32 = 64;
const NB: usize = BLOCK as usize;

/// A registry with just the built-in gain registered.
fn gain_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg
}

fn node(id: u32, manifest: &str, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: manifest.into(),
        kind,
        params: Vec::new(),
        assets: Vec::new(),
        n_in,
        n_out,
    }
}

fn audio_edge(from: u32, fp: u16, to: u32, tp: u16) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: fp,
        to_node: NodeIdx(to),
        to_port: tp,
        kind: ConnectionType::Audio,
    }
}

/// GraphIn(1) -> Gain(2, value=`gain`) -> SpeakerOut(3).
///
/// GraphIn/SpeakerOut reuse the gain manifest only so they resolve in the
/// registry; their `kind` is what the compiler/executor key on (a source and a
/// sink respectively) — neither runs as a gain.
fn graphin_gain_speaker(gain: f32) -> OjGraph {
    let mut g = OjGraph::empty(SR, BLOCK);
    let input = node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1);
    let mut amp = node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1);
    amp.params.push(Param { id: GAIN_PARAM, value: gain });
    let speaker = node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0);
    g.nodes.push(input);
    g.nodes.push(amp);
    g.nodes.push(speaker);
    g.edges.push(audio_edge(1, 0, 2, 0)); // input -> gain
    g.edges.push(audio_edge(2, 0, 3, 0)); // gain  -> speaker
    g
}

/// Write a known signal into the GraphIn source's output buffer.
fn inject(engine: &mut Engine, signal: &[f32]) {
    let buf = engine.input_mut(NodeIdx(1), 0).expect("graphin buffer");
    buf[..signal.len()].copy_from_slice(signal);
}

fn ramp() -> Vec<f32> {
    (0..NB).map(|i| (i as f32) * 0.01 - 0.3).collect()
}

#[test]
fn gain_to_speaker_scales_known_input() {
    let reg = gain_registry();
    const G: f32 = 2.0;
    let prog = compile(&graphin_gain_speaker(G), &reg).expect("compile");
    let mut engine = Engine::new(prog);

    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

    // The gain smoother was snapped to G at compile (params applied + reset),
    // so output == input * G from the first frame within tolerance.
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        let expected = x * G;
        assert!((y - expected).abs() < 1e-3, "frame {i}: got {y}, expected {expected}");
    }
}

#[test]
fn setparam_changes_gain_next_block() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);

    let input = ramp();
    let mut out = vec![0.0f32; NB];

    // Block 1 at unity gain: out == input.
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
    for (&x, &y) in input.iter().zip(out.iter()) {
        assert!((y - x).abs() < 1e-3, "unity expected passthrough");
    }

    // SetParam -> gain = 2.0 via the command ring.
    let (mut tx, mut rx) = CommandQueue::split(8);
    tx.push(RtCommand::SetParam { node: NodeIdx(2), param: GAIN_PARAM, value: 2.0 }).unwrap();
    engine.drain(&mut rx);

    // Let the ~5ms smoother settle over several blocks, then assert out == 2x.
    for _ in 0..16 {
        inject(&mut engine, &input);
        engine.process_block(&mut out, NB);
    }
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        let expected = x * 2.0;
        assert!(
            (y - expected).abs() < 1e-2,
            "frame {i} after SetParam: got {y}, expected ~{expected}"
        );
    }
}

#[test]
fn cycle_is_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0)); // a -> b
    g.edges.push(audio_edge(2, 0, 1, 0)); // b -> a  (feedback cycle!)
    g.edges.push(audio_edge(2, 0, 3, 0)); // b -> speaker
    assert!(matches!(compile(&g, &reg).err(), Some(CompileError::Cycle)));
}

#[test]
fn unknown_manifest_is_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, "does.not.exist", PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(2, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0));
    match compile(&g, &reg).err() {
        Some(CompileError::UnknownManifest(id)) => assert_eq!(id, "does.not.exist"),
        other => panic!("expected UnknownManifest, got {other:?}"),
    }
}

#[test]
fn missing_master_output_is_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    assert!(matches!(compile(&g, &reg).err(), Some(CompileError::NoMasterOutput)));
}

#[test]
fn multiple_master_outputs_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.nodes.push(node(2, GAIN_ID, PrimitiveKind::GraphOut, 1, 0));
    assert!(matches!(compile(&g, &reg).err(), Some(CompileError::MultipleMasterOutputs)));
}

#[test]
fn process_block_is_allocation_free() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.5), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let input = ramp();
    let mut out = vec![0.0f32; NB];

    // Warm up once outside the gate.
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

    // The REQUIRED gate: zero heap allocation on the hot path.
    assert_no_alloc(|| {
        for _ in 0..32 {
            engine.process_block(&mut out, NB);
        }
    });
}

#[test]
fn command_drain_and_process_are_alloc_free() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let (mut tx, mut rx) = CommandQueue::split(16);

    tx.push(RtCommand::SetParam { node: NodeIdx(2), param: GAIN_PARAM, value: 3.0 }).unwrap();
    tx.push(RtCommand::Bypass { node: NodeIdx(2), on: true }).unwrap();
    tx.push(RtCommand::TransportPlay).unwrap();
    tx.push(RtCommand::Seek { samples: 4096 }).unwrap();

    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB); // warm up

    assert_no_alloc(|| {
        engine.drain(&mut rx);
        engine.process_block(&mut out, NB);
    });

    assert!(engine.is_playing());
    assert_eq!(engine.sample_pos(), 4096 + BLOCK as u64);
    let amp_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    assert!(engine.program().bypassed[amp_slot], "bypass flag set by command");
}

#[test]
fn bypass_passes_signal_through() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(10.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    // Bypass the gain: its huge gain should NOT apply; signal passes through 1:1.
    let amp_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    engine.program_mut().bypassed[amp_slot] = true;

    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
    for (&x, &y) in input.iter().zip(out.iter()) {
        assert!((y - x).abs() < 1e-4, "bypassed gain must pass signal unchanged");
    }
}

#[test]
fn swap_publishes_and_engine_reads_new_program() {
    let reg = gain_registry();
    // Start on a 3-node program.
    let prog_a = compile(&graphin_gain_speaker(1.0), &reg).expect("compile a");
    let mut engine = Engine::new(prog_a);
    assert_eq!(engine.program().len(), 3);

    let swap = ProgramSwap::new();
    assert!(!swap.has_pending());

    // Publish a different 4-node program off the "control" thread.
    let mut graph_b = OjGraph::empty(SR, BLOCK);
    graph_b.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    graph_b.nodes.push(node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    graph_b.nodes.push(node(3, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    graph_b.nodes.push(node(4, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    graph_b.edges.push(audio_edge(1, 0, 2, 0));
    graph_b.edges.push(audio_edge(2, 0, 3, 0));
    graph_b.edges.push(audio_edge(3, 0, 4, 0));
    let prog_b = compile(&graph_b, &reg).expect("compile b");
    swap.publish(prog_b);
    assert!(swap.has_pending());

    // The "audio" thread adopts it; the old program is enqueued for deferred
    // (RT-safe) drop, NOT freed inline.
    assert!(swap.install_into(&mut engine));
    assert_eq!(engine.program().len(), 4, "engine reads the published program");
    assert!(!swap.has_pending());
    assert!(swap.alloc_count() >= 1, "old program enqueued for deferred drop");

    // Off-RT cleanup actually runs the displaced program's destructors.
    let mut swap = swap;
    assert!(swap.collect() >= 1, "deferred drop reclaimed the old program");

    // A second install with nothing pending is a no-op.
    assert!(!swap.install_into(&mut engine));

    // Engine still runs after the swap.
    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
}
