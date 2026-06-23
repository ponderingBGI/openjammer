//! U-RENDER: the OFFLINE golden-render audio-correctness gate.
//!
//! The key insight: the ojcore engine's audio is verifiable WITHOUT an audio
//! device. We build representative [`OjGraph`]s, [`compile`] them against the
//! SHARED `register_all` registry (the exact loaders the native host and the
//! wasm worklet run), render several blocks through [`Engine::process_block`]
//! into a plain `Vec<f32>`, and ASSERT the samples are correct with real numeric
//! tolerances — not "it ran".
//!
//! This suite is the verification backbone for ojcore's audio: if these pass,
//! the compiled graph -> rendered-buffer path is sample-correct end to end.
//!
//! Signal model. A `GraphIn` source carries host-injected input (the executor
//! leaves source output buffers intact — see [`Engine::input_mut`]), so
//! `GraphIn -> Effect -> SpeakerOut` lets us assert the effect's exact transfer.
//! Instruments are sources (no audio in); a `NoteOn` drives them.
#![cfg(feature = "std")]
// Test reference tones use std transcendentals; the libm-only guard is for the
// deterministic DSP path, not the test fixtures.
#![allow(clippy::disallowed_methods)]

use ojcore::effects::{biquad_param, convolution_param, delay_param, waveshaper_param};
use ojcore::{
    compile, compile_with_assets, master_param, AssetPcm, AssetResolver, Engine, PluginRegistry,
    BIQUAD_ID, CONVOLUTION_ID, DELAY_ID, GAIN_ID, GAIN_PARAM, GRAPH_IN_ID, LOOPER_ID, PAN_ID,
    SPEAKER_OUT_ID, WAVESHAPER_ID, WIDTH_ID,
};
use ojinstrument::{
    param as instr_param, register_all, RegisterOpts, KARPLUS_ID, OSC_ID, SAMPLER_ID,
    SAMPLER_PCM_PARAM,
};
use ojproto::{
    looper_action, AssetId, AssetRef, ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param,
    PrimitiveKind, RtCommand,
};

const SR: u32 = 48_000;
const SRF: f32 = SR as f32;
const BLOCK: u32 = 256;
const NB: usize = BLOCK as usize;

// ===========================================================================
// Graph-building + signal-analysis helpers
// ===========================================================================

/// The FULL shared registry (effects + structural + instruments), exactly as the
/// native host builds it — so the golden renders exercise the real loaders.
fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    register_all(&mut reg, RegisterOpts::full());
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

fn with_params(mut n: IrNode, params: &[(u16, f32)]) -> IrNode {
    n.params = params
        .iter()
        .map(|&(id, value)| Param { id, value })
        .collect();
    n
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

/// Render `blocks` blocks of `NB` frames into one contiguous buffer.
fn render(engine: &mut Engine, blocks: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; blocks * NB];
    for b in 0..blocks {
        engine.process_block(&mut out[b * NB..(b + 1) * NB], NB);
    }
    out
}

/// Render `blocks` blocks into TWO channel buffers via `process_block_into` — the
/// stereo counterpart of [`render`], exercising the N-channel device-output path.
fn render_stereo(engine: &mut Engine, blocks: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0f32; blocks * NB];
    let mut r = vec![0.0f32; blocks * NB];
    for b in 0..blocks {
        let (lb, rb) = (&mut l[b * NB..(b + 1) * NB], &mut r[b * NB..(b + 1) * NB]);
        let mut outs: [&mut [f32]; 2] = [lb, rb];
        engine.process_block_into(&mut outs, NB);
    }
    (l, r)
}

/// Root-mean-square of a buffer.
fn rms(buf: &[f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = buf.iter().map(|&x| (x as f64) * (x as f64)).sum();
    (sum_sq / buf.len() as f64).sqrt() as f32
}

/// Peak absolute amplitude.
fn peak(buf: &[f32]) -> f32 {
    buf.iter().fold(0.0f32, |m, &x| m.max(x.abs()))
}

/// Count upward zero crossings (positive-going) — robust estimator of the
/// fundamental frequency of a roughly-periodic signal.
fn upward_zero_crossings(buf: &[f32]) -> usize {
    let mut count = 0;
    for w in buf.windows(2) {
        if w[0] <= 0.0 && w[1] > 0.0 {
            count += 1;
        }
    }
    count
}

/// Estimate the fundamental frequency (Hz) from upward zero crossings over a
/// buffer of `sample_rate`-spaced samples.
fn estimate_freq(buf: &[f32], sample_rate: f32) -> f32 {
    let crossings = upward_zero_crossings(buf) as f32;
    let seconds = buf.len() as f32 / sample_rate;
    crossings / seconds
}

/// Assert every sample is finite (no NaN/Inf leaks past the engine guard).
fn assert_all_finite(buf: &[f32]) {
    assert!(
        buf.iter().all(|s| s.is_finite()),
        "non-finite sample in output"
    );
}

// ===========================================================================
// 1. Osc(440 Hz) -> SpeakerOut: output is a ~440 Hz sine
// ===========================================================================

#[test]
fn osc_440_renders_a_clean_sine_at_pitch() {
    // Osc(1) -> SpeakerOut(2). A4 = MIDI 69 = 440 Hz. Short, snappy envelope and
    // a high sustain so the tone is steady across the analysis window.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(with_params(
        node(1, OSC_ID, PrimitiveKind::Osc, 0, 1),
        &[
            (instr_param::GAIN, 1.0),
            (instr_param::ATTACK, 0.001),
            (instr_param::DECAY, 0.001),
            (instr_param::SUSTAIN, 1.0),
            (instr_param::RELEASE, 0.2),
        ],
    ));
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile osc graph"));

    // Idle: silent before any note.
    let idle = render(&mut engine, 1);
    assert!(peak(&idle) < 1e-6, "osc was not silent before NoteOn");

    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 69, // A4 = 440 Hz
        vel: 127,
    });
    // Let the (1 ms) attack settle, then analyse a steady window.
    let _settle = render(&mut engine, 1);
    let tone = render(&mut engine, 8); // 8 * 256 / 48k ≈ 42.7 ms

    assert_all_finite(&tone);

    // A full-velocity sine through unity gain (osc internal gain 1.0) has
    // amplitude ~1.0, so RMS ≈ 1/sqrt(2) ≈ 0.707. Allow generous headroom for
    // the envelope / voice gain shaping.
    let r = rms(&tone);
    assert!(
        (0.35..=0.78).contains(&r),
        "440 Hz sine RMS {r} out of expected range (~0.5..0.71)"
    );

    // Zero-crossing frequency estimate must land near 440 Hz.
    let f = estimate_freq(&tone, SRF);
    assert!(
        (f - 440.0).abs() < 12.0,
        "estimated osc frequency {f} Hz not ~440 Hz"
    );
}

// ===========================================================================
// 2. Gain: output == input * gain (within smoothing tolerance)
// ===========================================================================

#[test]
fn gain_scales_injected_input_exactly() {
    const G: f32 = 0.5;
    // GraphIn(1) -> Gain(2) -> SpeakerOut(3).
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1),
        &[(GAIN_PARAM, G)],
    ));
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile gain graph"));

    // Inject a known DC-ish ramp into the GraphIn source buffer each block.
    let input: Vec<f32> = (0..NB).map(|i| ((i % 32) as f32 - 16.0) * 0.05).collect();

    // First block: the gain smoother is snapped to target by `compile`'s reset,
    // so output should already equal input * G within a tight tolerance.
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        buf.copy_from_slice(&input);
    }
    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB);

    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        let expected = x * G;
        assert!(
            (y - expected).abs() < 1e-3,
            "gain frame {i}: got {y}, expected {expected}"
        );
    }
}

// ===========================================================================
// 3. Biquad lowpass: high frequency attenuated, DC/low passes
// ===========================================================================

#[test]
fn biquad_lowpass_attenuates_highs_passes_dc() {
    // GraphIn -> Biquad(lowpass @ 500 Hz) -> SpeakerOut.
    let make = |freq: f32| {
        let mut g = OjGraph::empty(SR, BLOCK);
        g.nodes
            .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
        g.nodes.push(with_params(
            node(2, BIQUAD_ID, PrimitiveKind::Biquad, 1, 1),
            &[
                (biquad_param::TYPE, 0.0), // lowpass
                (biquad_param::FREQ, freq),
                (biquad_param::Q, 0.707),
            ],
        ));
        g.nodes
            .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
        g.edges.push(audio_edge(1, 2));
        g.edges.push(audio_edge(2, 3));
        g
    };

    // --- DC passes: a constant 1.0 input settles to ~unity at the output.
    let mut engine = Engine::new(compile(&make(500.0), &registry()).expect("compile"));
    let dc = vec![1.0f32; NB];
    let mut last = 0.0;
    for _ in 0..20 {
        if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
            b.copy_from_slice(&dc);
        }
        let mut out = vec![0.0f32; NB];
        engine.process_block(&mut out, NB);
        last = out[NB - 1];
    }
    assert!(
        (last - 1.0).abs() < 0.05,
        "lowpass DC gain {last} not ~unity"
    );

    // --- A high-frequency tone (8 kHz, well above the 500 Hz cutoff) is heavily
    // attenuated relative to a low-frequency tone (100 Hz, in the passband).
    let tone = |hz: f32| -> Vec<f32> {
        (0..NB)
            .map(|i| core_f32_sin(2.0 * std::f32::consts::PI * hz * i as f32 / SRF))
            .collect()
    };
    let drive = |cutoff: f32, hz: f32| -> f32 {
        let mut engine = Engine::new(compile(&make(cutoff), &registry()).expect("compile"));
        let sig = tone(hz);
        let mut last_block = vec![0.0f32; NB];
        // Run several blocks so the filter reaches steady state on the periodic
        // input, then measure the last block's RMS.
        for _ in 0..40 {
            if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
                b.copy_from_slice(&sig);
            }
            engine.process_block(&mut last_block, NB);
        }
        rms(&last_block)
    };

    let low_rms = drive(500.0, 100.0); // passband
    let high_rms = drive(500.0, 8_000.0); // stopband
    assert!(
        low_rms > 0.5,
        "low tone RMS {low_rms} should pass ~unimpeded"
    );
    assert!(
        high_rms < low_rms * 0.2,
        "8 kHz ({high_rms}) not attenuated vs 100 Hz ({low_rms})"
    );
}

/// `f32::sin` via the std lib (the test crate has std), avoiding an extra dep.
#[inline]
fn core_f32_sin(x: f32) -> f32 {
    x.sin()
}

// ===========================================================================
// 4. Waveshaper + Delay: sane, finite, expected character
// ===========================================================================

#[test]
fn waveshaper_changes_amplitude_shape() {
    // Clean (amount 0) vs driven (amount 1) on a full-scale sine: the driven
    // curve compresses peaks, so its RMS rises relative to its peak (the crest
    // factor drops). Both stay finite and bounded.
    let make = |amount: f32| {
        let mut g = OjGraph::empty(SR, BLOCK);
        g.nodes
            .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
        g.nodes.push(with_params(
            node(2, WAVESHAPER_ID, PrimitiveKind::Waveshaper, 1, 1),
            &[
                (waveshaper_param::AMOUNT, amount),
                (waveshaper_param::LEVEL, 1.0),
            ],
        ));
        g.nodes
            .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
        g.edges.push(audio_edge(1, 2));
        g.edges.push(audio_edge(2, 3));
        g
    };
    // Amplitude 0.4 keeps the CLEAN sine under the master limiter's 0.4995 knee
    // (decision #1), so the clean crest factor stays the pure-sine sqrt(2); only
    // the waveshaper's distortion (and any limiting it then provokes) lowers it.
    // Crest factor is amplitude-independent for a pure sine, so this measures the
    // shaper, not the master brickwall.
    let sine: Vec<f32> = (0..NB)
        .map(|i| 0.4 * core_f32_sin(2.0 * std::f32::consts::PI * 220.0 * i as f32 / SRF))
        .collect();

    let crest = |amount: f32| -> f32 {
        let mut engine = Engine::new(compile(&make(amount), &registry()).expect("compile"));
        let mut last = vec![0.0f32; NB];
        for _ in 0..8 {
            if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
                b.copy_from_slice(&sine);
            }
            engine.process_block(&mut last, NB);
        }
        assert_all_finite(&last);
        peak(&last) / rms(&last).max(1e-9)
    };

    let clean = crest(0.0);
    let driven = crest(1.0);
    // A pure sine has crest factor sqrt(2) ≈ 1.414. Distortion squashes peaks, so
    // the driven crest factor must be MEASURABLY lower than the clean one.
    assert!(
        (clean - std::f32::consts::SQRT_2).abs() < 0.15,
        "clean waveshaper crest {clean} not ~1.414 (should be transparent)"
    );
    assert!(
        driven < clean - 0.05,
        "driven crest {driven} not lower than clean {clean} (no distortion?)"
    );
}

#[test]
fn delay_reproduces_impulse_after_n_samples() {
    // GraphIn -> Delay(10 ms, no feedback, full wet) -> SpeakerOut. An impulse in
    // the first frame must reappear exactly `lag` samples later at the master out.
    let time = 0.010_f32; // 10 ms
    let lag = (time * SRF) as usize; // 480 samples
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, DELAY_ID, PrimitiveKind::Delay, 1, 1),
        &[
            (delay_param::TIME, time),
            (delay_param::FEEDBACK, 0.0),
            (delay_param::MIX, 1.0), // full wet
        ],
    ));
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile delay graph"));

    // Inject an impulse only in the first frame of the first block.
    let mut impulse = vec![0.0f32; NB];
    impulse[0] = 1.0;
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.copy_from_slice(&impulse);
    }
    // Render enough blocks to cover the lag; subsequent blocks inject silence.
    let blocks = lag / NB + 2;
    let mut full = Vec::with_capacity(blocks * NB);
    for b in 0..blocks {
        if b > 0 {
            if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
                buf.fill(0.0);
            }
        }
        let mut out = vec![0.0f32; NB];
        engine.process_block(&mut out, NB);
        full.extend_from_slice(&out);
    }
    assert_all_finite(&full);
    // The delayed impulse lands at `lag` (full wet, no dry leak in this design).
    assert!(
        (full[lag] - 1.0).abs() < 1e-3,
        "delayed impulse {} at lag {lag} not ~1.0",
        full[lag]
    );
    // Nothing rings before the tap (no dry path, no feedback).
    let pre: f32 = full[1..lag].iter().fold(0.0, |m, &x| m.max(x.abs()));
    assert!(pre < 1e-3, "spurious energy {pre} before the delay tap");
}

// ===========================================================================
// 5. Convolution: dry passthrough with no IR; unit-impulse IR ≈ input
// ===========================================================================

/// A resolver backed by an owned PCM buffer, used to drive the asset-bind seam
/// from a test without `ojcore-native`. Returns the same PCM for ANY id.
struct OneAsset {
    id: AssetId,
    /// Interleaved PCM (`channels`-major frames); mono when `channels == 1`.
    pcm: Vec<f32>,
    channels: u8,
    sample_rate: f32,
}

impl AssetResolver for OneAsset {
    fn resolve(&self, id: AssetId) -> Option<AssetPcm<'_>> {
        if id == self.id {
            Some(AssetPcm::from_interleaved(
                &self.pcm,
                self.channels as u16,
                self.sample_rate,
            ))
        } else {
            None
        }
    }
}

#[test]
fn convolution_dry_without_ir_and_identity_with_unit_ir() {
    let make = |with_asset: bool| {
        let mut g = OjGraph::empty(SR, BLOCK);
        g.nodes
            .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
        let mut conv = with_params(
            node(2, CONVOLUTION_ID, PrimitiveKind::Convolution, 1, 1),
            &[(convolution_param::MIX, 1.0)], // full wet
        );
        if with_asset {
            conv.assets.push(AssetRef {
                slot: 0,
                asset: AssetId(7),
            });
        }
        g.nodes.push(conv);
        g.nodes
            .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
        g.edges.push(audio_edge(1, 2));
        g.edges.push(audio_edge(2, 3));
        g
    };

    let input: Vec<f32> = (0..NB).map(|i| ((i % 7) as f32 - 3.0) * 0.1).collect();

    // --- No IR: full-wet convolution is a clean dry passthrough.
    let mut engine = Engine::new(compile(&make(false), &registry()).expect("compile"));
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.copy_from_slice(&input);
    }
    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB);
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        assert!(
            (x - y).abs() < 1e-6,
            "no-IR passthrough frame {i}: {x} != {y}"
        );
    }

    // --- Unit-impulse IR resolved through the asset seam: output ≈ input.
    let ir = OneAsset {
        id: AssetId(7),
        pcm: vec![1.0], // identity kernel
        channels: 1,
        sample_rate: SRF,
    };
    let mut engine =
        Engine::new(compile_with_assets(&make(true), &registry(), &ir).expect("compile w/ IR"));
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.copy_from_slice(&input);
    }
    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB);
    for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
        assert!(
            (x - y).abs() < 1e-5,
            "identity-IR convolution frame {i}: {x} != {y}"
        );
    }
}

// ===========================================================================
// 6. Instrument note: NoteOn -> non-silent at pitch; NoteOff -> decays
// ===========================================================================

#[test]
fn osc_instrument_note_on_off_lifecycle() {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(with_params(
        node(1, OSC_ID, PrimitiveKind::Osc, 0, 1),
        &[(instr_param::SUSTAIN, 1.0), (instr_param::RELEASE, 0.05)],
    ));
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile"));

    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 57, // A3 = 220 Hz
        vel: 120,
    });
    let _settle = render(&mut engine, 1);
    let held = render(&mut engine, 8);
    assert!(
        peak(&held) > 0.05,
        "held note silent (peak {})",
        peak(&held)
    );
    let f = estimate_freq(&held, SRF);
    assert!((f - 220.0).abs() < 10.0, "note pitch {f} Hz not ~220 Hz");

    engine.apply(RtCommand::NoteOff {
        node: NodeIdx(1),
        note: 57,
    });
    // After release (~50 ms) plus margin, the tail decays to near silence.
    let tail = render(&mut engine, 60);
    let tail_peak = peak(&tail[tail.len() - NB..]);
    assert!(
        tail_peak < 1e-2,
        "note did not decay after NoteOff (tail {tail_peak})"
    );
}

#[test]
fn karplus_instrument_note_is_audible_then_rings_down() {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, KARPLUS_ID, PrimitiveKind::KarplusString, 0, 1));
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile"));

    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 60,
        vel: 127,
    });
    let attack = render(&mut engine, 1);
    assert_all_finite(&attack);
    assert!(peak(&attack) > 0.02, "karplus pluck silent");

    // SUSTAIN past the first wavelength. A degenerate ±1 excitation is annihilated
    // by the averaging lowpass within ONE period (note 60 ≈ 184 samples < one
    // 256-frame block), so this later window would be ~0 — the "extremely silent"
    // bug. A proper noise burst keeps ringing, so the string is still audible here.
    let sustain = render(&mut engine, 8);
    assert_all_finite(&sustain);
    assert!(peak(&sustain) > 0.02, "karplus collapsed to a click — no sustained ring");

    engine.apply(RtCommand::NoteOff {
        node: NodeIdx(1),
        note: 60,
    });
    // The string damps on its own; after a long ring-down it is near silent.
    let tail = render(&mut engine, 400);
    let tail_peak = peak(&tail[tail.len() - NB..]);
    assert!(
        tail_peak < 5e-2,
        "karplus did not ring down (tail {tail_peak})"
    );
}

// ===========================================================================
// 7. Sampler asset resolution: NoteOn -> output matches the loaded sample
// ===========================================================================

#[test]
fn sampler_plays_resolved_asset_at_root_pitch() {
    // A short, distinctive mono PCM as the asset. Played at the root note the
    // resampling ratio is 1.0, so the output reproduces the buffer sample-for-
    // sample (scaled by the velocity * gain envelope).
    let pcm: Vec<f32> = (0..64)
        .map(|i| core_f32_sin(2.0 * std::f32::consts::PI * i as f32 / 16.0) * 0.8)
        .collect();
    let asset = OneAsset {
        id: AssetId(42),
        pcm: pcm.clone(),
        channels: 1,
        sample_rate: SRF,
    };

    // Sampler(1) with the asset bound in slot 0 + root note 60 -> SpeakerOut(2).
    let mut g = OjGraph::empty(SR, BLOCK);
    let mut sampler = with_params(
        node(1, SAMPLER_ID, PrimitiveKind::Sampler, 0, 1),
        &[
            (instr_param::GAIN, 1.0),
            (instr_param::ATTACK, 0.0),
            (instr_param::DECAY, 0.0),
            (instr_param::SUSTAIN, 1.0),
            (SAMPLER_PCM_PARAM, 60.0), // root note = 60
        ],
    );
    sampler.assets.push(AssetRef {
        slot: 0,
        asset: AssetId(42),
    });
    g.nodes.push(sampler);
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));

    // Compile WITH the asset resolver -> the sampler's `set_sample` fires.
    let mut engine =
        Engine::new(compile_with_assets(&g, &registry(), &asset).expect("compile w/ sample"));

    // Before NoteOn: silent.
    let idle = render(&mut engine, 1);
    assert!(peak(&idle) < 1e-6, "sampler not silent before note");

    // Play at the root note (60) -> unity playback ratio.
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 60,
        vel: 127,
    });
    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB);
    assert_all_finite(&out);

    // The first `pcm.len()` output frames reproduce the buffer (vel 127 -> amp
    // ~1.0, gain 1.0, attack 0 + sustain 1 -> envelope ~1.0). Allow a small
    // tolerance for the envelope's first-sample ramp.
    // Compare against the limited expectation: the engine's final output passes
    // through the master brickwall (decision #1), so any PCM sample past the
    // 0.4995 knee is softly compressed before it reaches `out`.
    let mut matched = 0;
    for (i, &expected) in pcm.iter().enumerate() {
        if (out[i] - ojcore_dsp::guards::soft_limit(expected)).abs() < 0.05 {
            matched += 1;
        }
    }
    assert!(
        matched >= pcm.len() - 2,
        "sampler output matched only {matched}/{} sample frames",
        pcm.len()
    );

    // Past the end of the (64-frame) sample, output returns to silence.
    let tail_peak = peak(&out[pcm.len() + 8..]);
    assert!(
        tail_peak < 1e-2,
        "sampler rang past sample end (tail {tail_peak})"
    );
}

#[test]
fn sampler_stereo_asset_renders_distinct_left_and_right() {
    // An interleaved STEREO asset whose right channel is the phase-inverse of the
    // left. Played at the root note (unity ratio), the stereo Sampler must route
    // L -> device L and R -> device R (the last mono boundary, CHANNELS.md §5.3) —
    // NOT duplicate one channel — so the two device channels are genuine mirror
    // images. This locks the stereo asset path end-to-end through the real registry.
    let frames = 64usize;
    let mut interleaved = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        let s = core_f32_sin(2.0 * std::f32::consts::PI * i as f32 / 16.0) * 0.6;
        interleaved.push(s); // L
        interleaved.push(-s); // R (phase-inverted)
    }
    let asset = OneAsset {
        id: AssetId(43),
        pcm: interleaved,
        channels: 2,
        sample_rate: SRF,
    };

    let mut g = OjGraph::empty(SR, BLOCK);
    let mut sampler = with_params(
        node(1, SAMPLER_ID, PrimitiveKind::Sampler, 0, 1),
        &[
            (instr_param::GAIN, 1.0),
            (instr_param::ATTACK, 0.0),
            (instr_param::DECAY, 0.0),
            (instr_param::SUSTAIN, 1.0),
            (SAMPLER_PCM_PARAM, 60.0), // root note = 60 -> unity ratio
        ],
    );
    sampler.assets.push(AssetRef {
        slot: 0,
        asset: AssetId(43),
    });
    g.nodes.push(sampler);
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));

    let mut engine = Engine::new(
        compile_with_assets(&g, &registry(), &asset).expect("compile w/ stereo sample"),
    );
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 60,
        vel: 127,
    });
    let (l, r) = render_stereo(&mut engine, 1);
    assert_all_finite(&l);
    assert_all_finite(&r);

    // Both device channels carry the sample — neither is silent or dropped.
    assert!(
        peak(&l[..frames]) > 0.2,
        "left carries the sample (peak {})",
        peak(&l[..frames])
    );
    assert!(
        peak(&r[..frames]) > 0.2,
        "right carries the sample (peak {})",
        peak(&r[..frames])
    );
    // ...and they are DISTINCT: R is the inverse of L, so L + R ≈ 0 everywhere
    // (the master brickwall is an odd function, so it preserves the symmetry)
    // while |L - R| is large — proving the channels are independently routed.
    let mut max_abs_diff = 0.0f32;
    for i in 0..frames {
        assert!(
            (l[i] + r[i]).abs() < 0.05,
            "R is the phase-inverse of L (frame {i}: L {} R {})",
            l[i],
            r[i]
        );
        max_abs_diff = max_abs_diff.max((l[i] - r[i]).abs());
    }
    assert!(
        max_abs_diff > 0.3,
        "L and R are genuinely distinct, not a duplicated mono lane (max |L-R| {max_abs_diff})"
    );
}

#[test]
fn sampler_without_asset_is_silent_but_well_defined() {
    // A sampler whose asset is unresolvable (no resolver) must render clean
    // silence on NoteOn, never garbage — the documented "starts empty" behaviour.
    let mut g = OjGraph::empty(SR, BLOCK);
    let mut sampler = node(1, SAMPLER_ID, PrimitiveKind::Sampler, 0, 1);
    sampler.assets.push(AssetRef {
        slot: 0,
        asset: AssetId(999),
    });
    g.nodes.push(sampler);
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    // Plain `compile` (NoAssets resolver) -> nothing bound.
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile"));
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 60,
        vel: 127,
    });
    let out = render(&mut engine, 4);
    assert_all_finite(&out);
    assert!(peak(&out) < 1e-6, "unbound sampler produced sound");
}

// ===========================================================================
// 8. Looper: record -> play reproduces; overdub sums; clear -> silence
// ===========================================================================

#[test]
fn looper_records_plays_overdubs_and_clears() {
    // GraphIn(1) -> Looper(2) -> SpeakerOut(3). A one-block quantized loop with
    // wet-only output so playback == the recorded buffer.
    let loop_secs = NB as f32 / SRF;
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, LOOPER_ID, PrimitiveKind::Looper, 1, 1),
        &[(0, loop_secs), (1, 1.0), (2, 0.0)], // LOOP_SECS, WET=1, DRY=0
    ));
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile looper graph"));

    let first: Vec<f32> = (0..NB).map(|i| ((i % 13) as f32 - 6.0) * 0.05).collect();

    // Record exactly one block (fills the quantized loop -> auto Playing).
    engine.apply(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::RECORD,
        arg: 0,
    });
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.copy_from_slice(&first);
    }
    let mut rec_out = vec![0.0f32; NB];
    engine.process_block(&mut rec_out, NB);

    // Play back over silence: out == recorded loop.
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.fill(0.0);
    }
    let mut play = vec![0.0f32; NB];
    engine.process_block(&mut play, NB);
    for (i, (&x, &y)) in first.iter().zip(play.iter()).enumerate() {
        assert!((x - y).abs() < 1e-6, "loop playback frame {i}: {x} != {y}");
    }

    // Overdub a second pass: the loop now holds first + second.
    let second: Vec<f32> = (0..NB).map(|i| ((i % 9) as f32 - 4.0) * 0.03).collect();
    engine.apply(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::OVERDUB,
        arg: 0,
    });
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.copy_from_slice(&second);
    }
    let mut over = vec![0.0f32; NB];
    engine.process_block(&mut over, NB);

    // Back to playback over silence: out == first + second.
    engine.apply(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::PLAY,
        arg: 0,
    });
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.fill(0.0);
    }
    let mut sum = vec![0.0f32; NB];
    engine.process_block(&mut sum, NB);
    for i in 0..NB {
        let expected = first[i] + second[i];
        assert!(
            (sum[i] - expected).abs() < 1e-6,
            "overdub frame {i}: got {} expected {expected}",
            sum[i]
        );
    }

    // Clear -> the loop is gone; playback over silence is pure silence.
    engine.apply(RtCommand::Looper {
        node: NodeIdx(2),
        action: looper_action::CLEAR,
        arg: 0,
    });
    if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
        b.fill(0.0);
    }
    let mut cleared = vec![0.0f32; NB];
    engine.process_block(&mut cleared, NB);
    assert!(peak(&cleared) < 1e-9, "loop not cleared to silence");
}

// ===========================================================================
// 9. SpeakerOut master volume / mute scales the master output
// ===========================================================================

#[test]
fn speaker_master_volume_and_mute_scale_output() {
    // GraphIn -> Gain(unity) -> SpeakerOut. Set the master volume via SetParam on
    // the SpeakerOut node and assert the master output scales by it; mute -> 0.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1),
        &[(GAIN_PARAM, 1.0)],
    ));
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile"));

    let input = vec![0.5f32; NB];
    let drive = |engine: &mut Engine| -> Vec<f32> {
        if let Some(b) = engine.input_mut(NodeIdx(1), 0) {
            b.copy_from_slice(&input);
        }
        let mut out = vec![0.0f32; NB];
        engine.process_block(&mut out, NB);
        out
    };

    // Default volume == unity: master == input.
    let unity = drive(&mut engine);
    assert!(
        (unity[NB - 1] - 0.5).abs() < 1e-4,
        "default master not unity"
    );

    // Volume 0.25 -> master scaled to 0.125.
    engine.apply(RtCommand::SetParam {
        node: NodeIdx(3),
        param: master_param::VOLUME,
        value: 0.25,
    });
    let quarter = drive(&mut engine);
    assert!(
        (quarter[NB - 1] - 0.125).abs() < 1e-4,
        "master volume 0.25 gave {} (want 0.125)",
        quarter[NB - 1]
    );

    // Mute -> silence regardless of volume.
    engine.apply(RtCommand::SetParam {
        node: NodeIdx(3),
        param: master_param::MUTE,
        value: 1.0,
    });
    let muted = drive(&mut engine);
    assert!(peak(&muted) < 1e-9, "mute did not silence master");

    // Unmute -> restores the (still 0.25) volume.
    engine.apply(RtCommand::SetParam {
        node: NodeIdx(3),
        param: master_param::MUTE,
        value: 0.0,
    });
    let restored = drive(&mut engine);
    assert!(
        (restored[NB - 1] - 0.125).abs() < 1e-4,
        "unmute did not restore volume"
    );
}

// ===========================================================================
// 10. A multi-node chain renders finite, non-silent, expected-RMS output
// ===========================================================================

#[test]
fn instrument_effect_chain_renders_expected_output() {
    // Osc -> Biquad(lowpass 2 kHz) -> Delay -> SpeakerOut. A realistic synth
    // voice through two effects: the rendered output must be finite, non-silent,
    // and in a sane RMS band.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(with_params(
        node(1, OSC_ID, PrimitiveKind::Osc, 0, 1),
        &[(instr_param::GAIN, 0.8), (instr_param::SUSTAIN, 1.0)],
    ));
    g.nodes.push(with_params(
        node(2, BIQUAD_ID, PrimitiveKind::Biquad, 1, 1),
        &[(biquad_param::TYPE, 0.0), (biquad_param::FREQ, 2_000.0)],
    ));
    g.nodes.push(with_params(
        node(3, DELAY_ID, PrimitiveKind::Delay, 1, 1),
        &[
            (delay_param::TIME, 0.12),
            (delay_param::FEEDBACK, 0.3),
            (delay_param::MIX, 0.4),
        ],
    ));
    g.nodes
        .push(node(4, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    g.edges.push(audio_edge(3, 4));
    let mut engine = Engine::new(compile(&g, &registry()).expect("compile chain"));

    // Silent before any note.
    assert!(
        peak(&render(&mut engine, 1)) < 1e-6,
        "chain not silent idle"
    );

    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 64, // E4 ≈ 330 Hz, comfortably below the 2 kHz cutoff
        vel: 110,
    });
    let _settle = render(&mut engine, 2);
    let body = render(&mut engine, 16);
    assert_all_finite(&body);
    let r = rms(&body);
    assert!(r > 0.02, "chain output too quiet (RMS {r})");
    assert!(r < 1.5, "chain output unexpectedly hot (RMS {r})");
    // The note's fundamental (330 Hz) survives the lowpass.
    let f = estimate_freq(&body, SRF);
    assert!(
        (f - 330.0).abs() < 20.0,
        "chain fundamental {f} Hz not ~330 Hz"
    );
}

// ===========================================================================
// Golden corpus: a COMMITTED per-arch fingerprint, ULP-banded.
//
// libm routes every transcendental through one implementation, so the engine's
// render is bit-stable across linux-x64 / macos-aarch64 / macos-x64 / wasm. This
// pins a sparse fingerprint of the deterministic Osc(440)->Speaker render to a
// committed golden in a tight band — a regression in the DSP (or a non-libm math
// call sneaking in) moves the samples and fails on every arch.
// ===========================================================================

/// Render the canonical Osc(440)->Speaker tone and return a sparse fingerprint:
/// the sample at every 64th index of a fixed post-attack window.
fn osc440_fingerprint() -> Vec<f32> {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(with_params(
        node(1, OSC_ID, PrimitiveKind::Osc, 0, 1),
        &[
            (instr_param::GAIN, 1.0),
            (instr_param::ATTACK, 0.001),
            (instr_param::DECAY, 0.001),
            (instr_param::SUSTAIN, 1.0),
            (instr_param::RELEASE, 0.2),
        ],
    ));
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile osc graph"));
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 69,
        vel: 127,
    });
    let _settle = render(&mut engine, 1);
    let tone = render(&mut engine, 4); // 1024 samples
    tone.iter().step_by(64).copied().collect()
}

/// The committed golden (16 samples). Generated once on a libm rig; identical on
/// every supported arch. Update ONLY with an intentional DSP change.
// Re-captured for the master brickwall limiter (decision #1): the engine's final
// output now passes through `ojcore_dsp::guards::soft_limit` (ceiling 0.999, knee
// at 0.4995), so samples whose magnitude exceeded the knee are softly compressed.
// Under-knee samples (e.g. #1, #2, #7, #8, #13, #14) are byte-identical to the
// pre-limiter golden, confirming the limiter leaves quiet/normal signal untouched.
const OSC440_GOLDEN: [f32; 16] = [
    0.69515896,
    -0.40674695,
    -0.12532012,
    0.59731567,
    -0.73280275,
    0.7450017,
    -0.6632713,
    0.28905588,
    0.24866231,
    -0.6497807,
    0.74272686,
    -0.7366629,
    0.61717886,
    -0.1668075,
    -0.36808708,
    0.6857557,
];

#[test]
fn osc_440_matches_committed_golden() {
    let fp = osc440_fingerprint();
    assert_eq!(fp.len(), OSC440_GOLDEN.len(), "fingerprint length drifted");
    // Tight ULP band: libm is deterministic, so allow only a few ULP of slack.
    for (i, (&got, &want)) in fp.iter().zip(OSC440_GOLDEN.iter()).enumerate() {
        let tol = 8.0 * f32::EPSILON * want.abs().max(1.0);
        assert!(
            (got - want).abs() <= tol,
            "golden sample #{i} drifted: got {got:?}, want {want:?} (tol {tol:?})"
        );
    }
}

// ===========================================================================
// Stereo: the channel path through the SHARED registry + process_block_into.
// A mono GraphIn injected into a real Pan node images to two device channels per
// the equal-power law (docs/CHANNELS.md) — the end-to-end stereo proof in the gate.
// ===========================================================================

#[test]
fn pan_centre_images_injected_input_equal_power() {
    // GraphIn(1) -> Pan(2, centre) -> SpeakerOut(3). A centred pan sends a mono DC
    // input to BOTH device channels at the equal-power gain 1/√2 ≈ 0.7071 (not the
    // 1.0 of a mono fan-out, nor the 0.5 of a linear law) — proving the real Pan
    // loader ran and process_block_into delivered true two-channel output.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(2, PAN_ID, PrimitiveKind::Pan, 1, 1)); // pan defaults to 0 = centre
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile pan-centre graph"));

    const DC: f32 = 0.5;
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        buf.copy_from_slice(&vec![DC; NB]);
    }
    let (l, r) = render_stereo(&mut engine, 1);
    assert_all_finite(&l);
    assert_all_finite(&r);

    let centre = DC * core::f32::consts::FRAC_1_SQRT_2;
    for i in 1..NB {
        assert!(
            (l[i] - centre).abs() < 1e-3,
            "L[{i}] = {} != {centre}",
            l[i]
        );
        assert!(
            (r[i] - centre).abs() < 1e-3,
            "R[{i}] = {} != {centre}",
            r[i]
        );
    }
}

#[test]
fn pan_hard_left_routes_input_to_left_channel_only() {
    // GraphIn(1) -> Pan(2, pan=-1 hard left) -> SpeakerOut(3). The mono input lands
    // ENTIRELY in the left device channel; the right is silent — true stereo
    // separation (L != R) end to end through the real path.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, PAN_ID, PrimitiveKind::Pan, 1, 1),
        &[(0, -1.0)], // pan_param::PAN = 0; -1 = hard left
    ));
    g.nodes
        .push(node(3, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile pan-left graph"));

    const DC: f32 = 0.5;
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        buf.copy_from_slice(&vec![DC; NB]);
    }
    let (l, r) = render_stereo(&mut engine, 1);
    assert_all_finite(&l);
    assert_all_finite(&r);

    for i in 1..NB {
        assert!(
            (l[i] - DC).abs() < 1e-3,
            "L[{i}] = {} != {DC} (hard left)",
            l[i]
        );
        assert!(
            r[i].abs() < 1e-3,
            "R[{i}] = {} != 0 (hard left silent)",
            r[i]
        );
    }
}

// A mid-graph stereo EFFECT (Width) re-imaging a real stereo SOURCE (Pan) — the
// end-to-end lock for the general lane-aware mix (`mix_input_lane`): Pan's two output
// lanes must route into Width's two INPUT lanes through the real compile + registry.

#[test]
fn pan_into_width_unity_routes_the_stereo_chain() {
    // GraphIn -> Pan(centre) -> Width(unity) -> SpeakerOut. A unity Width is
    // transparent, so the output is the centred equal-power image, unchanged — proving
    // the chain ROUTES (Pan's L/R lanes reach Width's two input lanes).
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(2, PAN_ID, PrimitiveKind::Pan, 1, 1));
    g.nodes.push(node(3, WIDTH_ID, PrimitiveKind::Width, 1, 1));
    g.nodes
        .push(node(4, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    g.edges.push(audio_edge(3, 4));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile pan->width chain"));
    const DC: f32 = 0.5;
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        buf.copy_from_slice(&vec![DC; NB]);
    }
    let (l, r) = render_stereo(&mut engine, 1);
    assert_all_finite(&l);
    assert_all_finite(&r);

    let centre = DC * core::f32::consts::FRAC_1_SQRT_2;
    for i in 1..NB {
        assert!(
            (l[i] - centre).abs() < 1e-3,
            "L[{i}] = {} != {centre}",
            l[i]
        );
        assert!(
            (r[i] - centre).abs() < 1e-3,
            "R[{i}] = {} != {centre}",
            r[i]
        );
    }
}

#[test]
fn width_collapses_a_panned_signal_to_mono() {
    // GraphIn -> Pan(hard left) -> Width(0) -> SpeakerOut. Pan sends the input to L
    // only (L=DC, R=0); Width receives that stereo pair via the general mix and at
    // width 0 mid/side-collapses it to the centre (L'=R'=mid=DC/2). The proof that a
    // stereo EFFECT mid-graph genuinely re-images a real stereo source — commit F.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(with_params(
        node(2, PAN_ID, PrimitiveKind::Pan, 1, 1),
        &[(0, -1.0)], // hard left
    ));
    g.nodes.push(with_params(
        node(3, WIDTH_ID, PrimitiveKind::Width, 1, 1),
        &[(0, 0.0)], // width 0 = mono collapse
    ));
    g.nodes
        .push(node(4, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));
    g.edges.push(audio_edge(2, 3));
    g.edges.push(audio_edge(3, 4));

    let mut engine = Engine::new(compile(&g, &registry()).expect("compile pan->width collapse"));
    const DC: f32 = 0.5;
    if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
        buf.copy_from_slice(&vec![DC; NB]);
    }
    let (l, r) = render_stereo(&mut engine, 1);
    assert_all_finite(&l);
    assert_all_finite(&r);

    let centre = DC / 2.0; // mid of (DC, 0)
    for i in 1..NB {
        assert!(
            (l[i] - centre).abs() < 1e-3,
            "L[{i}] = {} != {centre}",
            l[i]
        );
        assert!(
            (r[i] - centre).abs() < 1e-3,
            "R[{i}] = {} != {centre}",
            r[i]
        );
    }
}
