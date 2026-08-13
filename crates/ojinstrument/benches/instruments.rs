//! Instrument / voice benchmarks (Track A P1 — perf-regression gate).
//!
//! The DSP kernels (`ojcore-dsp`) and the engine mechanics (`ojcore`) have their
//! own suites; this one covers the layer in between — the polyphonic voice pools
//! that actually turn note events into sound, plus one realistic end-to-end patch
//! (the closest thing here to "what a performer runs"). Run locally with
//! `cargo bench`; in CI the CodSpeed action measures instruction count AND heap
//! allocations, so a voice path that starts allocating on the audio thread (the
//! cardinal sin) is caught in review.
//!
//! Coverage:
//!   * `{osc,sampler,karplus}/voices_{1,8,16}` — steady-state polyphony cost: N
//!     notes held, one block rendered per iteration (16 == `MAX_VOICES`).
//!   * `adsr/tick_block` — the envelope every voice is gated by.
//!   * `voice_alloc/note_on_off` — voice allocation + oldest-first stealing.
//!   * `process/realistic_patch_512` — Osc -> Biquad -> Delay -> SpeakerOut with
//!     a 3-note chord live, compiled and rendered through the real engine.

use std::sync::Arc;

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::{
    compile, BuiltinOpts, DspInstance, Engine, PluginRegistry, ProcessCtx, BIQUAD_ID, DELAY_ID,
    SPEAKER_OUT_ID,
};
use ojinstrument::{
    register_all, Adsr, AdsrParams, KarplusInstrument, OscInstrument, RegisterOpts,
    SamplerInstrument, SamplerSample, MAX_VOICES, OSC_ID,
};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};

const SR: f32 = 48_000.0;
const BLOCK: usize = 512;
const VOICE_COUNTS: [usize; 3] = [1, 8, 16];

/// Render one block of `inst` into a fresh single-channel buffer (instruments
/// are generators: zero audio inputs). The instrument is mutated in place, so
/// repeated calls advance phase/envelopes — i.e. steady-state polyphony cost.
#[inline]
fn render_block(inst: &mut dyn DspInstance, out: &mut [f32]) {
    let ins: [&[f32]; 0] = [];
    let mut outs: [&mut [f32]; 1] = [out];
    let mut ctx = ProcessCtx {
        inputs: &ins,
        outputs: &mut outs,
        nframes: BLOCK,
    };
    inst.process(&mut ctx);
}

fn bench_osc(c: &mut Criterion) {
    let mut group = c.benchmark_group("osc");
    for &voices in &VOICE_COUNTS {
        group.bench_function(format!("voices_{voices}"), |b| {
            let mut inst = OscInstrument::new(SR);
            inst.activate(SR, BLOCK);
            for i in 0..voices {
                inst.note_on(48 + i as u8, 100);
            }
            let mut out = vec![0.0f32; BLOCK];
            b.iter(|| {
                render_block(&mut inst, &mut out);
                black_box(out[0])
            });
        });
    }
    group.finish();
}

fn bench_sampler(c: &mut Criterion) {
    let mut group = c.benchmark_group("sampler");
    // A short synthetic one-shot (a ramp) standing in for a loaded PCM sample.
    let pcm: Vec<f32> = (0..2048).map(|i| (i as f32 / 2048.0) * 2.0 - 1.0).collect();
    let sample = Arc::new(SamplerSample::new(pcm, SR, 60));
    for &voices in &VOICE_COUNTS {
        let sample = sample.clone();
        group.bench_function(format!("voices_{voices}"), |b| {
            let mut inst = SamplerInstrument::new(SR);
            inst.activate(SR, BLOCK);
            inst.set_sample(sample.clone());
            for i in 0..voices {
                inst.note_on(48 + i as u8, 100);
            }
            let mut out = vec![0.0f32; BLOCK];
            b.iter(|| {
                render_block(&mut inst, &mut out);
                black_box(out[0])
            });
        });
    }
    group.finish();
}

fn bench_karplus(c: &mut Criterion) {
    let mut group = c.benchmark_group("karplus");
    for &voices in &VOICE_COUNTS {
        group.bench_function(format!("voices_{voices}"), |b| {
            let mut inst = KarplusInstrument::new(SR);
            inst.activate(SR, BLOCK);
            for i in 0..voices {
                inst.note_on(48 + i as u8, 100);
            }
            let mut out = vec![0.0f32; BLOCK];
            b.iter(|| {
                render_block(&mut inst, &mut out);
                black_box(out[0])
            });
        });
    }
    group.finish();
}

fn bench_adsr(c: &mut Criterion) {
    c.bench_function("adsr/tick_block", |b| {
        b.iter(|| {
            let mut env = Adsr::new(SR, AdsrParams::default());
            env.gate_on();
            let mut acc = 0.0f32;
            for _ in 0..BLOCK {
                acc += env.tick();
            }
            black_box(acc)
        })
    });
}

fn bench_voice_alloc(c: &mut Criterion) {
    // Allocate a full pool then re-trigger it, forcing oldest-first voice steal.
    c.bench_function("voice_alloc/note_on_off", |b| {
        let mut inst = OscInstrument::new(SR);
        inst.activate(SR, BLOCK);
        b.iter(|| {
            for i in 0..MAX_VOICES as u8 {
                inst.note_on(40 + i, 100);
            }
            for i in 0..MAX_VOICES as u8 {
                inst.note_off(40 + i);
            }
        });
    });
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

fn audio_edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

/// Osc -> Biquad -> Delay -> SpeakerOut: a small but real effects chain.
fn realistic_graph() -> OjGraph {
    let mut g = OjGraph::empty(48_000, BLOCK as u32);
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

fn bench_realistic_patch(c: &mut Criterion) {
    let mut reg = PluginRegistry::new();
    // Effects + structural + instruments; SF2 not needed for this patch.
    register_all(
        &mut reg,
        RegisterOpts {
            builtins: BuiltinOpts::full(),
            instruments: true,
            sf2: false,
        },
    );
    let prog = compile(&realistic_graph(), &reg).expect("compile realistic patch");
    let mut engine = Engine::new(prog);
    // A 3-note chord on the oscillator -> three voices through the effects chain.
    for note in [57u8, 60, 64] {
        engine.apply(RtCommand::NoteOn {
            node: NodeIdx(1),
            note,
            vel: 100,
        });
    }
    let mut out = vec![0.0f32; BLOCK];
    c.bench_function("process/realistic_patch_512", |b| {
        b.iter(|| engine.process_block(black_box(&mut out), BLOCK))
    });
}

criterion_group!(
    benches,
    bench_osc,
    bench_sampler,
    bench_karplus,
    bench_adsr,
    bench_voice_alloc,
    bench_realistic_patch,
);
criterion_main!(benches);
