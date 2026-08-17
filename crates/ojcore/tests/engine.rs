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
    compile, CommandQueue, CompileError, Engine, GainLoader, PanLoader, PluginRegistry,
    ProgramSwap, WidthLoader, GAIN_ID, GAIN_PARAM, PAN_ID, WIDTH_ID,
};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, PrimitiveKind, RtCommand};

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
    amp.params.push(Param {
        id: GAIN_PARAM,
        value: gain,
    });
    let speaker = node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0);
    g.nodes.push(input);
    g.nodes.push(amp);
    g.nodes.push(speaker);
    g.edges.push(audio_edge(1, 0, 2, 0)); // input -> gain
    g.edges.push(audio_edge(2, 0, 3, 0)); // gain  -> speaker
    g
}

/// A registry with gain + the stereo Pan and Width built-ins.
fn stereo_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg.register(Box::new(PanLoader::new()));
    reg.register(Box::new(WidthLoader::new()));
    reg
}

/// GraphIn(1) -> Pan(2) -> Width(3) -> SpeakerOut(4): the new stereo lane path.
/// Pan widens the mono source into a stereo lane pair and Width processes both
/// lanes; the mono master then folds them down. One audio PORT per side carries
/// the lanes (docs/CHANNELS.md model), so n_in/n_out mirror the mono nodes.
fn graphin_pan_width_speaker() -> OjGraph {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(2, PAN_ID, PrimitiveKind::Pan, 1, 1));
    g.nodes.push(node(3, WIDTH_ID, PrimitiveKind::Width, 1, 1));
    g.nodes
        .push(node(4, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0)); // input -> pan
    g.edges.push(audio_edge(2, 0, 3, 0)); // pan   -> width
    g.edges.push(audio_edge(3, 0, 4, 0)); // width -> speaker
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

    // The gain smoother was snapped to G at compile (params applied + reset), so
    // output == input * G — THROUGH the master brickwall limiter (decision #1):
    // samples past the +/-0.4995 knee are softly compressed, so we compare against
    // the limited expectation, not the raw product. (Quiet frames are unaffected.)
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        let expected = ojcore_dsp::guards::soft_limit(x * G);
        assert!(
            (y - expected).abs() < 1e-3,
            "frame {i}: got {y}, expected {expected}"
        );
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
    tx.push(RtCommand::SetParam {
        node: NodeIdx(2),
        param: GAIN_PARAM,
        value: 2.0,
    })
    .unwrap();
    engine.drain(&mut rx);

    // Let the ~5ms smoother settle over several blocks, then assert out == 2x.
    for _ in 0..16 {
        inject(&mut engine, &input);
        engine.process_block(&mut out, NB);
    }
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        // input * 2.0 through the master brickwall (see gain_to_speaker above).
        let expected = ojcore_dsp::guards::soft_limit(x * 2.0);
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
    g.nodes
        .push(node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0)); // a -> b
    g.edges.push(audio_edge(2, 0, 1, 0)); // b -> a  (feedback cycle!)
    g.edges.push(audio_edge(2, 0, 3, 0)); // b -> speaker
    assert!(matches!(compile(&g, &reg).err(), Some(CompileError::Cycle)));
}

#[test]
fn unknown_manifest_is_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, "does.not.exist", PrimitiveKind::Gain, 1, 1));
    g.nodes
        .push(node(2, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0));
    match compile(&g, &reg).err() {
        Some(CompileError::UnknownManifest(id)) => assert_eq!(id, "does.not.exist"),
        other => panic!("expected UnknownManifest, got {other:?}"),
    }
}

#[test]
fn out_of_range_source_port_is_rejected() {
    // A from_port beyond the source node's declared outputs must be rejected at
    // compile time (else it would index-panic on the audio thread).
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1)); // one output port
    g.nodes
        .push(node(2, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 5, 2, 0)); // from_port 5 exceeds the single output
    assert!(matches!(
        compile(&g, &reg).err(),
        Some(CompileError::PortOutOfRange)
    ));
}

#[test]
fn missing_master_output_is_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    assert!(matches!(
        compile(&g, &reg).err(),
        Some(CompileError::NoMasterOutput)
    ));
}

#[test]
fn multiple_master_outputs_rejected() {
    let reg = gain_registry();
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.nodes
        .push(node(2, GAIN_ID, PrimitiveKind::GraphOut, 1, 0));
    assert!(matches!(
        compile(&g, &reg).err(),
        Some(CompileError::MultipleMasterOutputs)
    ));
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
fn stereo_pan_width_process_is_allocation_free() {
    // Gate the NEW stereo lane-mix hot path the same way as the mono path: Pan
    // widens the mono source into a stereo lane pair and Width processes both
    // lanes every block. A per-sample allocation slipping into that path would be
    // a dropout on a live stereo patch, so prove zero heap traffic here too.
    let reg = stereo_registry();
    let prog = compile(&graphin_pan_width_speaker(), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let input = ramp();
    let mut out = vec![0.0f32; NB];

    // Warm up once outside the gate.
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

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

    tx.push(RtCommand::SetParam {
        node: NodeIdx(2),
        param: GAIN_PARAM,
        value: 3.0,
    })
    .unwrap();
    tx.push(RtCommand::Bypass {
        node: NodeIdx(2),
        on: true,
    })
    .unwrap();
    tx.push(RtCommand::TransportPlay).unwrap();
    tx.push(RtCommand::Seek { samples: 4096 }).unwrap();

    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB); // warm up

    assert_no_alloc(|| {
        engine.drain(&mut rx);
        engine.process_block(&mut out, NB);
    });

    assert!(engine.is_playing());
    // Seek while rolling is a deferred locate: this block advances through the
    // declick and must not jump directly to the target.
    assert_eq!(engine.sample_pos(), BLOCK as u64);
    assert_eq!(engine.transport().motion(), ojcore::Motion::DeclickToLocate);
    let amp_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    assert!(
        engine.program().bypassed[amp_slot],
        "bypass flag set by command"
    );
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
        assert!(
            (y - x).abs() < 1e-4,
            "bypassed gain must pass signal unchanged"
        );
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
    graph_b
        .nodes
        .push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    graph_b
        .nodes
        .push(node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    graph_b
        .nodes
        .push(node(3, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    graph_b
        .nodes
        .push(node(4, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    graph_b.edges.push(audio_edge(1, 0, 2, 0));
    graph_b.edges.push(audio_edge(2, 0, 3, 0));
    graph_b.edges.push(audio_edge(3, 0, 4, 0));
    let prog_b = compile(&graph_b, &reg).expect("compile b");
    swap.publish(prog_b);
    assert!(swap.has_pending());

    // The "audio" thread adopts it; the old program is enqueued for deferred
    // (RT-safe) drop, NOT freed inline.
    assert!(swap.install_into(&mut engine));
    assert_eq!(
        engine.program().len(),
        4,
        "engine reads the published program"
    );
    assert!(!swap.has_pending());
    assert!(
        swap.alloc_count() >= 1,
        "old program enqueued for deferred drop"
    );

    // Off-RT cleanup actually runs the displaced program's destructors.
    let mut swap = swap;
    assert!(
        swap.collect() >= 1,
        "deferred drop reclaimed the old program"
    );

    // A second install with nothing pending is a no-op.
    assert!(!swap.install_into(&mut engine));

    // Engine still runs after the swap.
    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
}

// ===========================================================================
// U12 transport + U15 metering + U16 resilience integration tests.
// ===========================================================================

use ojcore::manifest::{DspKind, PluginManifest, PortDecl, UiKind};
use ojcore::{DspInstance, PluginLoader, ProcessCtx};
use ojcore::{Meter, MeterRing, Watchdog};
use std::sync::Arc;

/// U12: tempo + time signature drive bar/beat correctly through the engine.
///
/// At 120 BPM / 4/4 / 48 kHz a beat is 24 000 samples and a bar is 96 000.
/// We Seek the playhead and read the engine's musical position.
#[test]
fn engine_transport_advances_bar_and_beat() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    engine.set_sample_rate(SR as f32);
    engine.set_tempo(120.0);
    engine.set_time_signature(4, 4);

    // Locate while stopped is immediate.
    let (mut tx2, mut rx2) = CommandQueue::split(4);
    tx2.push(RtCommand::Seek { samples: 120_000 }).unwrap();
    engine.drain(&mut rx2);

    let (mut tx, mut rx) = CommandQueue::split(4);
    tx.push(RtCommand::TransportPlay).unwrap();
    engine.drain(&mut rx);

    let pos = engine.transport_pos();
    assert_eq!(pos.bar, 2, "after 120000 samples => one-based bar 2");
    assert_eq!(pos.beat, 2, "=> one-based beat 2 of bar 2");
    assert!(
        pos.phase < 1e-3,
        "on the beat boundary, phase ~0 (got {})",
        pos.phase
    );

    // Half a beat further: phase advances to ~0.5 within the same beat.
    let mut out = vec![0.0f32; NB];
    let input = ramp();
    let half_beat = 12_000u64;
    let mut produced = 0u64;
    while produced < half_beat {
        inject(&mut engine, &input);
        engine.process_block(&mut out, NB);
        produced += BLOCK as u64;
    }
    let pos = engine.transport_pos();
    assert_eq!(pos.bar, 2);
    assert_eq!(pos.beat, 2);
    assert!(
        pos.phase > 0.3 && pos.phase < 0.7,
        "mid-beat phase (got {})",
        pos.phase
    );
}

/// U15: master + per-node RMS matches a known constant signal.
///
/// A constant 0.5 signal through unity gain has RMS 0.5 and peak 0.5 at both the
/// gain node's output and the master.
#[test]
fn engine_meter_rms_matches_known_signal() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    engine.set_metering(true);
    assert!(engine.metering_enabled());

    let signal = vec![0.5f32; NB];
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &signal);
    engine.process_block(&mut out, NB);

    // Master meter.
    let master_slot = engine.program().slot_of_id(NodeIdx(3)).unwrap();
    let master: &Meter = &engine.meters().master;
    assert!(
        (master.rms() - 0.5).abs() < 1e-3,
        "master rms {}",
        master.rms()
    );
    assert!(
        (master.peak() - 0.5).abs() < 1e-3,
        "master peak {}",
        master.peak()
    );

    // Gain node (slot for NodeIdx 2) meter.
    let gain_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    let gm: &Meter = &engine.meters().nodes[gain_slot];
    assert!((gm.rms() - 0.5).abs() < 1e-3, "gain rms {}", gm.rms());

    // Sanity: the master slot is a real slot index.
    assert!(master_slot < engine.program().len());
}

/// U15: with a return ring attached, the engine publishes Meter + Beat frames at
/// block end, decodable on the "control" thread.
#[test]
fn engine_publishes_meter_and_beat_frames() {
    use ojcore::meter::return_frame;
    use ojproto::EngineFrame;

    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    engine.set_sample_rate(SR as f32);
    engine.set_metering(true);

    let ring: Arc<MeterRing> = Arc::new(MeterRing::new());
    engine.attach_meter_ring(Some(Arc::clone(&ring)));

    let signal = vec![0.5f32; NB];
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &signal);
    engine.process_block(&mut out, NB);

    // Drain the ring on the "control" thread: expect at least one Meter (master)
    // and exactly one Beat.
    let mut buf = [0u8; return_frame::MAX_LEN];
    let mut meters = 0;
    let mut beats = 0;
    let mut transports = 0;
    let mut saw_master_level = false;
    while let Some(n) = ring.pop(&mut buf) {
        match return_frame::decode(&buf[..n]) {
            Some(EngineFrame::Meter { rms, .. }) => {
                meters += 1;
                if (rms - 0.5).abs() < 1e-3 {
                    saw_master_level = true;
                }
            }
            Some(EngineFrame::Beat { .. }) => beats += 1,
            Some(EngineFrame::Transport { sample, motion, .. }) => {
                transports += 1;
                assert_eq!(sample, 0);
                assert_eq!(motion, ojcore::Motion::Stopped as u8);
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }
    assert!(meters >= 1, "expected meter frames, got {meters}");
    assert_eq!(beats, 1, "exactly one beat frame per block");
    assert_eq!(transports, 1, "exactly one transport frame per publish");
    assert!(
        saw_master_level,
        "a meter frame carried the 0.5 RMS master level"
    );
}

// --- A node that emits NaN, to prove the U16 guard silences + flags it. ----

const NAN_ID: &str = "test.nan";

struct NanLoader {
    manifest: PluginManifest,
}

impl NanLoader {
    fn new() -> Self {
        Self {
            manifest: PluginManifest {
                abi: None,
                id: NAN_ID.into(),
                name: "NaN".into(),
                kind: PrimitiveKind::Gain, // any processor kind works here
                dsp: DspKind::Builtin,
                ui: UiKind::Auto,
                params: Vec::new(),
                ports: PortDecl {
                    audio_in: 1,
                    audio_out: 1,
                    control_in: 0,
                    control_out: 0,
                    audio_in_channels: 1,
                    audio_out_channels: 1,
                },
            },
        }
    }
}

impl PluginLoader for NanLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }
    fn instantiate(&self, _sr: f32, _mb: usize) -> Box<dyn DspInstance> {
        Box::new(NanNode)
    }
}

struct NanNode;

impl DspInstance for NanNode {
    fn activate(&mut self, _sr: f32, _mb: usize) {}
    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if let Some(out) = ctx.outputs.first_mut() {
            for s in out.iter_mut().take(ctx.nframes) {
                *s = f32::NAN; // deliberately emit garbage.
            }
        }
    }
    fn set_param(&mut self, _id: u16, _v: f32) {}
}

/// U16: a NaN-emitting node has its output flushed to silence AND raises the
/// per-node non-finite flag; the garbage never reaches the master output.
#[test]
fn engine_silences_and_flags_nan_node() {
    let mut reg = gain_registry();
    reg.register(Box::new(NanLoader::new()));

    // GraphIn(1) -> NaN(2) -> SpeakerOut(3).
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(2, NAN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes
        .push(node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0));
    g.edges.push(audio_edge(2, 0, 3, 0));

    let prog = compile(&g, &reg).expect("compile");
    let mut engine = Engine::new(prog);

    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

    // The master output is clean silence (the NaN was flushed at the node).
    for (i, &y) in out.iter().enumerate() {
        assert!(y.is_finite(), "frame {i} non-finite: {y}");
        assert_eq!(y, 0.0, "frame {i} should be silenced, got {y}");
    }
    // The offending node is flagged.
    let nan_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    assert!(
        engine.budget().non_finite[nan_slot],
        "NaN node flagged non_finite"
    );
    assert!(engine.budget().any_flagged());
}

/// U16: the per-block CPU watchdog flags + auto-bypasses an over-budget node.
#[test]
fn engine_watchdog_auto_bypasses_over_budget_node() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(2.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);

    // Zero-ns budget: every node "overruns"; auto-bypass on.
    engine.set_watchdog(Some(Watchdog::new(0, true)));

    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

    // The gain node was flagged over-budget and auto-bypassed.
    let gain_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    assert!(
        engine.budget().over_budget[gain_slot],
        "gain flagged over budget"
    );
    assert!(engine.is_auto_bypassed(NodeIdx(2)), "gain auto-bypassed");
}

#[test]
fn watchdog_requires_configured_consecutive_overruns() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(2.0), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    engine.set_watchdog(Some(Watchdog::new(0, true).with_consecutive(2)));
    let input = ramp();
    let mut out = vec![0.0f32; NB];
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
    assert!(!engine.is_auto_bypassed(NodeIdx(2)));
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);
    assert!(engine.is_auto_bypassed(NodeIdx(2)));
}

/// REQUIRED gate: `process_block` STILL allocates zero bytes with metering
/// enabled (and the return ring attached + published every block).
#[test]
fn process_block_alloc_free_with_metering_enabled() {
    let reg = gain_registry();
    let prog = compile(&graphin_gain_speaker(1.5), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    engine.set_metering(true);
    engine.set_sample_rate(SR as f32);

    let ring: Arc<MeterRing> = Arc::new(MeterRing::new());
    engine.attach_meter_ring(Some(Arc::clone(&ring)));

    // Also arm the watchdog so its per-node timing is inside the gate too.
    engine.set_watchdog(Some(Watchdog::from_block(SR as f32, NB, 0.5)));

    let input = ramp();
    let mut out = vec![0.0f32; NB];

    // Warm up once outside the gate.
    inject(&mut engine, &input);
    engine.process_block(&mut out, NB);

    assert_no_alloc(|| {
        for _ in 0..32 {
            engine.process_block(&mut out, NB);
            // Drain the ring inside the gate too (pop is alloc-free); otherwise
            // it would fill and stop accepting — draining keeps the proof honest.
            let mut buf = [0u8; ojcore::meter::return_frame::MAX_LEN];
            while ring.pop(&mut buf).is_some() {}
        }
    });
}

// ===========================================================================
// U-STATEFUL: the built-in looper, driven end-to-end through the engine.
// ===========================================================================

/// A registry with gain (for the GraphIn/SpeakerOut manifests) + the looper.
fn looper_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg.register(Box::new(ojcore::LooperLoader::new()));
    reg
}

/// GraphIn(1) -> Looper(2) -> SpeakerOut(3), with the looper's wet=1/dry=0 and a
/// one-block quantized loop length so a single recorded block auto-loops.
fn graphin_looper_speaker() -> OjGraph {
    use ojcore::looper::looper_param;
    let mut g = OjGraph::empty(SR, BLOCK);
    let input = node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1);
    let mut loop_node = node(2, ojcore::LOOPER_ID, PrimitiveKind::Looper, 1, 1);
    loop_node.params.push(Param {
        id: looper_param::LOOP_SECS,
        value: BLOCK as f32 / SR as f32,
    });
    loop_node.params.push(Param {
        id: looper_param::WET,
        value: 1.0,
    });
    loop_node.params.push(Param {
        id: looper_param::DRY,
        value: 0.0,
    });
    let speaker = node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0);
    g.nodes.push(input);
    g.nodes.push(loop_node);
    g.nodes.push(speaker);
    g.edges.push(audio_edge(1, 0, 2, 0)); // input  -> looper
    g.edges.push(audio_edge(2, 0, 3, 0)); // looper -> speaker
    g
}

/// Record a known block, then play it back identically — through the engine, via
/// `RtCommand::Looper` actions on the wait-free command ring.
#[test]
fn looper_records_then_plays_back_through_engine() {
    use ojproto::looper_action;
    let reg = looper_registry();
    let prog = compile(&graphin_looper_speaker(), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let (mut tx, mut rx) = CommandQueue::split(8);

    let signal = ramp();
    let mut out = vec![0.0f32; NB];

    // RECORD: one block fills the quantized loop and auto-switches to Playing.
    tx.push(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::RECORD,
        arg: 0,
    })
    .unwrap();
    engine.drain(&mut rx);
    inject(&mut engine, &signal);
    engine.process_block(&mut out, NB);

    // Play back over silence: the GraphIn buffer is left at zero, so out == the
    // recorded loop (wet=1, dry=0) within tolerance.
    let silence = vec![0.0f32; NB];
    inject(&mut engine, &silence);
    engine.process_block(&mut out, NB);
    for (i, (&x, &y)) in signal.iter().zip(out.iter()).enumerate() {
        assert!(
            (x - y).abs() < 1e-5,
            "looper playback frame {i}: recorded {x} != played {y}"
        );
    }

    // CLEAR resets the loop to silence; playback then yields pure silence.
    tx.push(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::CLEAR,
        arg: 0,
    })
    .unwrap();
    engine.drain(&mut rx);
    inject(&mut engine, &silence);
    engine.process_block(&mut out, NB);
    assert!(out.iter().all(|&y| y.abs() < 1e-6), "loop not cleared");
}

/// `LooperNode::process` (driven through the engine) allocates zero bytes on the
/// hot path, in every state of the machine.
#[test]
fn looper_process_is_allocation_free() {
    use ojproto::looper_action;
    let reg = looper_registry();
    let prog = compile(&graphin_looper_speaker(), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let (mut tx, mut rx) = CommandQueue::split(8);

    let signal = ramp();
    let mut out = vec![0.0f32; NB];

    // Warm up (and prime a captured loop) outside the gate.
    inject(&mut engine, &signal);
    engine.process_block(&mut out, NB);

    // Cycle the looper through every state INSIDE the gate: applying the command
    // (looper_action) and rendering must both be allocation-free. The Stage-3
    // capture accessors (`last_captured_block` / `last_committed_layer_pcm`) are
    // read on the RT thread (native streams the captured block each block; both
    // are borrows into pre-allocated buffers), so they MUST be alloc-free too —
    // exercise them inside the gate after each render.
    let looper_slot = engine.program().slot_of_id(NodeIdx(2)).unwrap();
    assert_no_alloc(|| {
        for &(action, arg) in &[
            (looper_action::ARM, 0),
            (looper_action::RECORD, 0),
            (looper_action::OVERDUB, 0),
            (looper_action::PLAY, 0),
            // Indexed actions are allocation-free too: undo / mute / delete.
            (looper_action::SET_MUTE, looper_action::MUTE_FLAG), // layer 0, muted
            (looper_action::DELETE_LAYER, 0),
            (looper_action::UNDO_LAST, 0),
            (looper_action::STOP, 0),
            (looper_action::CLEAR, 0),
        ] {
            tx.push(RtCommand::Looper {
                node: NodeIdx(2),
                action,
                arg,
            })
            .unwrap();
            engine.drain(&mut rx);
            engine.process_block(&mut out, NB);
            // The native capture seam reads these every block; a borrow must
            // never allocate. `core::hint::black_box` keeps the reads observable.
            let inst = &engine.program().instances[looper_slot];
            let _ = core::hint::black_box(inst.last_captured_block().map(|s| s.len()));
            let _ = core::hint::black_box(inst.last_committed_layer_pcm().len());
        }
    });
}

/// THE USER SCENARIO, A/B: `GraphIn -> SpeakerOut` (direct) vs
/// `GraphIn -> Looper -> SpeakerOut` with the production param defaults the
/// manifest emits (LOOP_SECS=duration, WET=1, DRY=1) and NO record action, so the
/// looper sits IDLE. An idle looper inserted in the chain MUST be a perfect
/// passthrough — both paths produce bit-identical output. Regression guard for
/// "the looper massively amplifies anything that goes through it." If this FAILS,
/// the gain bug is in the engine; if it PASSES, the bug is in the graph the UI
/// emits (e.g. a surviving second path) — not the kernel.
#[test]
fn idle_looper_in_path_matches_direct_path() {
    use ojcore::looper::looper_param;
    let reg = looper_registry();

    // A: GraphIn(1) -> SpeakerOut(3) — the "no looper" baseline.
    let mut a = OjGraph::empty(SR, BLOCK);
    a.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    a.nodes
        .push(node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    a.edges.push(audio_edge(1, 0, 3, 0));
    let mut ea = Engine::new(compile(&a, &reg).expect("compile A"));

    // B: GraphIn(1) -> Looper(2, idle, prod defaults) -> SpeakerOut(3).
    let mut b = OjGraph::empty(SR, BLOCK);
    b.nodes.push(node(1, GAIN_ID, PrimitiveKind::GraphIn, 0, 1));
    let mut lp = node(2, ojcore::LOOPER_ID, PrimitiveKind::Looper, 1, 1);
    lp.params.push(Param {
        id: looper_param::LOOP_SECS,
        value: 10.0,
    });
    lp.params.push(Param {
        id: looper_param::WET,
        value: 1.0,
    });
    lp.params.push(Param {
        id: looper_param::DRY,
        value: 1.0,
    });
    b.nodes.push(lp);
    b.nodes
        .push(node(3, GAIN_ID, PrimitiveKind::SpeakerOut, 1, 0));
    b.edges.push(audio_edge(1, 0, 2, 0));
    b.edges.push(audio_edge(2, 0, 3, 0));
    let mut eb = Engine::new(compile(&b, &reg).expect("compile B"));

    let signal = ramp();
    let mut oa = vec![0.0f32; NB];
    let mut ob = vec![0.0f32; NB];
    inject(&mut ea, &signal);
    ea.process_block(&mut oa, NB);
    inject(&mut eb, &signal);
    eb.process_block(&mut ob, NB);

    for (i, (&da, &db)) in oa.iter().zip(ob.iter()).enumerate() {
        assert!(
            (da - db).abs() < 1e-6,
            "idle looper changed the signal at frame {i}: direct {da} vs through-looper {db}"
        );
    }
}
