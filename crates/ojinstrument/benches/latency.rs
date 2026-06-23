//! End-to-end MIDI→audio latency benchmark (Track A — the latency-budget gate).
//!
//! WHAT THIS CAN AND CANNOT MEASURE. CodSpeed's simulation instrument measures
//! CPU work (instruction count), and the walltime instrument measures wall-clock
//! CPU time — NEITHER measures the real device round-trip (driver + converter +
//! USB), which is the founder-hardware loopback harness's job
//! (`ojcore-native/src/bin/loopback.rs`). What this bench tracks is the part of
//! latency the engine actually owns: the CPU cost of turning a note into one
//! block of sound at the PRODUCTION buffer. That cost is the real-time deadline —
//! a 64-frame block @ 48 kHz must render in < 1.333 ms or the device is forced to
//! a bigger buffer, which *is* more latency. So this is the honest end-to-end
//! latency gate: keep the per-block work well under the block period and a small,
//! low-latency buffer stays sustainable; regress it and latency climbs.
//!
//! The full live signal chain is exercised — instrument voices, an effects chain,
//! and the master mix — with a real note-driven chord, so the number reflects "what
//! a performer runs", not a synthetic kernel. The headline `e2e/midi_to_audio_64`
//! is the production buffer the native engine requests (`DEFAULT_STREAM`,
//! `src-tauri/src/engine.rs`); the sweep shows how the per-block budget scales
//! with buffer size (the CPU↔latency trade-off). The engine's INTRINSIC
//! note→sound delay (≈ 0, well under one block) is asserted in
//! `tests/e2e_latency.rs`.

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::{compile, BuiltinOpts, Engine, PluginRegistry, BIQUAD_ID, DELAY_ID, SPEAKER_OUT_ID};
use ojinstrument::{register_all, RegisterOpts, OSC_ID};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};

const SR: u32 = 48_000;

/// Buffer sizes to sweep. 64 is the production buffer the native cpal stream
/// requests; the larger sizes show the per-block CPU↔latency trade-off.
const BLOCKS: [u32; 4] = [64, 128, 256, 512];

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

fn audio_edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

/// Osc -> Biquad -> Delay -> SpeakerOut: the realistic live chain (instrument +
/// filter + time effect + speaker), sized to `block` frames so the engine's
/// pre-allocated scratch matches the render width exactly.
fn realistic_graph(block: u32) -> OjGraph {
    let mut g = OjGraph::empty(SR, block);
    g.nodes.push(node(1, OSC_ID, PrimitiveKind::Osc, 0, 1));
    g.nodes
        .push(node(2, BIQUAD_ID, PrimitiveKind::Biquad, 1, 1));
    g.nodes.push(node(3, DELAY_ID, PrimitiveKind::Delay, 1, 1));
    g.nodes
        .push(node(4, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    g.edges.push(audio_edge(3, 4));
    g
}

/// Effects + structural + instruments (no SF2 — this patch doesn't need it).
fn full_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    register_all(
        &mut reg,
        RegisterOpts {
            builtins: BuiltinOpts::full(),
            instruments: true,
            sf2: false,
        },
    );
    reg
}

/// Compile the realistic patch at `block`, build the engine, and drive a 3-note
/// chord onto the oscillator (three voices live through the effects chain) — the
/// state every benched block renders from.
fn engine_with_chord(block: u32) -> Engine {
    let prog = compile(&realistic_graph(block), &full_registry()).expect("compile realistic patch");
    let mut engine = Engine::new(prog);
    for note in [57u8, 60, 64] {
        engine.apply(RtCommand::NoteOn {
            node: NodeIdx(1),
            note,
            vel: 100,
        });
    }
    engine
}

fn bench_e2e(c: &mut Criterion) {
    let mut group = c.benchmark_group("e2e");
    for &block in &BLOCKS {
        let nb = block as usize;
        let mut engine = engine_with_chord(block);
        let mut out = vec![0.0f32; nb];
        // `midi_to_audio_64` is the headline: one block of the full live chain at
        // the production buffer — the work that must beat the 1.333 ms deadline.
        group.bench_function(format!("midi_to_audio_{block}"), |b| {
            b.iter(|| engine.process_block(black_box(&mut out), nb))
        });
    }
    group.finish();
}

criterion_group!(benches, bench_e2e);
criterion_main!(benches);
