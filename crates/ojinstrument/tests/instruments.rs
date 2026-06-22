//! U6 instrument verification: each voice-based instrument produces non-silent
//! output at the expected pitch on note-on, releases on note-off, and steals
//! voices oldest-first. Exercised directly through the [`DspInstance`] surface
//! (the same one the engine drives) plus loader/manifest sanity.

// Test signal generators use std transcendentals; the libm-only guard is for the
// deterministic DSP path, not the test reference tones.
#![allow(clippy::disallowed_methods)]

use std::sync::Arc;

use ojcore::{DspInstance, PluginLoader, ProcessCtx};
use ojinstrument::{
    param, KarplusInstrument, KarplusLoader, OscInstrument, OscLoader, SamplerInstrument,
    SamplerLoader, SamplerSample, KARPLUS_ID, OSC_ID, SAMPLER_ID,
};
use ojproto::PrimitiveKind;

const SR: f32 = 48_000.0;
const BLOCK: usize = 512;

/// Render `blocks` blocks of a (source) instrument into one contiguous buffer.
fn render(inst: &mut dyn DspInstance, blocks: usize) -> Vec<f32> {
    let mut all = Vec::with_capacity(blocks * BLOCK);
    let mut buf = vec![0.0f32; BLOCK];
    for _ in 0..blocks {
        for s in buf.iter_mut() {
            *s = 0.0;
        }
        {
            let ins: [&[f32]; 0] = [];
            let mut outs: [&mut [f32]; 1] = [&mut buf];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: BLOCK,
            };
            inst.process(&mut ctx);
        }
        all.extend_from_slice(&buf);
    }
    all
}

/// Peak absolute amplitude of a buffer.
fn peak(buf: &[f32]) -> f32 {
    buf.iter().fold(0.0f32, |m, &x| m.max(x.abs()))
}

/// Estimate the fundamental period (in samples) of a roughly-periodic signal by
/// counting positive-going zero crossings over a window, skipping the attack.
fn estimate_freq(buf: &[f32], sample_rate: f32) -> f32 {
    let start = buf.len() / 8; // skip attack transient
    let win = &buf[start..];
    let mut crossings = 0usize;
    let mut first = None;
    let mut last = 0usize;
    let mut prev = win[0];
    for (i, &x) in win.iter().enumerate().skip(1) {
        if prev <= 0.0 && x > 0.0 {
            if first.is_none() {
                first = Some(i);
            }
            last = i;
            crossings += 1;
        }
        prev = x;
    }
    let first = first.unwrap_or(0);
    if crossings < 2 || last <= first {
        return 0.0;
    }
    let span = (last - first) as f32;
    let cycles = (crossings - 1) as f32;
    cycles / span * sample_rate
}

/// Estimate the fundamental frequency by AUTOCORRELATION — robust for a
/// harmonically rich signal (a plucked Karplus string) where naive zero-crossing
/// counting reads the upper harmonics. Picks the smallest lag whose correlation is
/// near the global peak, so it locks to the fundamental period (not a harmonic).
fn estimate_freq_autocorr(buf: &[f32], sample_rate: f32) -> f32 {
    let start = buf.len() / 4; // skip the broadband pluck attack
    let win = &buf[start..];
    if win.len() < 64 {
        return 0.0;
    }
    let min_lag = (sample_rate / 1200.0) as usize; // search up to ~1200 Hz
    let max_lag = ((sample_rate / 80.0) as usize).min(win.len() / 2); // down to ~80 Hz
    let mut corr = vec![0.0f32; max_lag + 1];
    let mut best = 0.0f32;
    for lag in min_lag..=max_lag {
        let mut sum = 0.0f32;
        for i in 0..(win.len() - lag) {
            sum += win[i] * win[i + lag];
        }
        corr[lag] = sum;
        if sum > best {
            best = sum;
        }
    }
    // Smallest lag that is a local peak within 85% of the global max = the
    // fundamental period (guards against an octave-up read on a strong harmonic).
    let mut lag = 0usize;
    for l in (min_lag + 1)..max_lag {
        if corr[l] >= 0.85 * best && corr[l] >= corr[l - 1] && corr[l] >= corr[l + 1] {
            lag = l;
            break;
        }
    }
    if lag == 0 {
        0.0
    } else {
        sample_rate / lag as f32
    }
}

// ===========================================================================
// Osc
// ===========================================================================

#[test]
fn osc_note_produces_non_silent_output() {
    let mut osc = OscInstrument::new(SR);
    osc.activate(SR, BLOCK);
    osc.note_on(69, 100); // A4
    let out = render(&mut osc, 8);
    assert!(
        peak(&out) > 0.01,
        "osc note was silent (peak {})",
        peak(&out)
    );
}

#[test]
fn osc_pitch_matches_midi_note() {
    let mut osc = OscInstrument::new(SR);
    osc.activate(SR, BLOCK);
    osc.set_param(param::ATTACK, 0.001);
    osc.set_param(param::SUSTAIN, 1.0);
    osc.note_on(69, 100); // A4 = 440 Hz
    let out = render(&mut osc, 16);
    let f = estimate_freq(&out, SR);
    assert!(
        (f - 440.0).abs() < 12.0,
        "osc A4 measured {f} Hz, expected ~440"
    );
}

#[test]
fn osc_release_decays_after_note_off() {
    let mut osc = OscInstrument::new(SR);
    osc.activate(SR, BLOCK);
    osc.set_param(param::SUSTAIN, 1.0);
    osc.set_param(param::RELEASE, 0.05);
    osc.note_on(60, 110);
    let held = render(&mut osc, 8);
    osc.note_off(60);
    let released = render(&mut osc, 32); // long enough to fully decay
                                         // Tail end after release should be (near) silent vs. the held body.
    let tail = peak(&released[released.len() - BLOCK..]);
    assert!(
        tail < 0.01 * peak(&held).max(1e-6) + 1e-4,
        "release did not decay: held peak {}, tail {}",
        peak(&held),
        tail
    );
}

#[test]
fn osc_voice_steal_keeps_polyphony_bounded() {
    let mut osc = OscInstrument::new(SR);
    osc.activate(SR, BLOCK);
    // Trigger far more notes than voices; the pool must steal oldest-first and
    // never blow up (output stays finite and audible).
    for n in 36..36 + 40u8 {
        osc.note_on(n, 100);
    }
    let out = render(&mut osc, 4);
    assert!(
        out.iter().all(|x| x.is_finite()),
        "voice steal produced NaN"
    );
    assert!(peak(&out) > 0.01, "voice-stolen pool went silent");
}

// ===========================================================================
// Karplus
// ===========================================================================

#[test]
fn karplus_pluck_produces_non_silent_output() {
    let mut k = KarplusInstrument::new(SR);
    k.activate(SR, BLOCK);
    k.note_on(57, 100); // A3
    let out = render(&mut k, 4);
    assert!(peak(&out) > 0.01, "karplus pluck was silent");
}

#[test]
fn karplus_pitch_matches_midi_note() {
    let mut k = KarplusInstrument::new(SR);
    k.activate(SR, BLOCK);
    k.note_on(69, 100); // A4 = 440 Hz
    let out = render(&mut k, 8);
    // A plucked string is harmonically rich; use autocorrelation (zero-crossing
    // counting would read an upper harmonic).
    let f = estimate_freq_autocorr(&out, SR);
    assert!(
        (f - 440.0).abs() < 25.0,
        "karplus A4 measured {f} Hz, expected ~440"
    );
}

#[test]
fn karplus_decays_over_time() {
    let mut k = KarplusInstrument::new(SR);
    k.activate(SR, BLOCK);
    k.note_on(45, 120);
    let early = render(&mut k, 2);
    let late = render(&mut k, 2);
    let _mid = render(&mut k, 8);
    let very_late = render(&mut k, 2);
    assert!(
        peak(&early) > peak(&late),
        "string did not decay early->late"
    );
    assert!(
        peak(&very_late) < peak(&early),
        "string did not keep decaying"
    );
}

// ===========================================================================
// Sampler
// ===========================================================================

/// A 1 kHz sine sample one second long, rooted at MIDI note 69 (A4). Playing it
/// at note 69 reproduces 1 kHz; playing an octave up (note 81) yields ~2 kHz.
fn sine_sample(freq: f32, root: u8) -> Arc<SamplerSample> {
    let n = SR as usize; // 1 s
    let pcm: Vec<f32> = (0..n)
        .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / SR).sin())
        .collect();
    Arc::new(SamplerSample::new(pcm, SR, root))
}

#[test]
fn sampler_plays_loaded_sample_at_root() {
    let mut s = SamplerInstrument::new(SR);
    s.activate(SR, BLOCK);
    s.set_param(param::SUSTAIN, 1.0);
    s.set_sample(sine_sample(1000.0, 69));
    s.note_on(69, 100); // play at root -> ~1000 Hz
    let out = render(&mut s, 16);
    assert!(peak(&out) > 0.01, "sampler was silent at root note");
    let f = estimate_freq(&out, SR);
    assert!(
        (f - 1000.0).abs() < 30.0,
        "sampler at root measured {f} Hz, expected ~1000"
    );
}

#[test]
fn sampler_velocity_controls_brightness() {
    // A low fundamental + a strong high partial, so the velocity low-pass changes
    // the spectral BALANCE (a single tone would just be attenuated, not dulled).
    fn bright_sample() -> Arc<SamplerSample> {
        let n = SR as usize;
        let pcm: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / SR;
                let low = (2.0 * std::f32::consts::PI * 220.0 * t).sin();
                let high = (2.0 * std::f32::consts::PI * 8000.0 * t).sin();
                0.5 * (low + high)
            })
            .collect();
        Arc::new(SamplerSample::new(pcm, SR, 69))
    }
    // Spectral-tilt proxy (amplitude-independent): first-difference energy / total.
    fn brightness(buf: &[f32]) -> f32 {
        let total: f32 = buf.iter().map(|&x| x * x).sum::<f32>().max(1e-12);
        let hf: f32 = buf.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum();
        hf / total
    }

    let mut soft = SamplerInstrument::new(SR);
    soft.activate(SR, BLOCK);
    soft.set_param(param::SUSTAIN, 1.0);
    soft.set_sample(bright_sample());
    soft.note_on(69, 20); // soft -> dark
    let soft_out = render(&mut soft, 8);

    let mut hard = SamplerInstrument::new(SR);
    hard.activate(SR, BLOCK);
    hard.set_param(param::SUSTAIN, 1.0);
    hard.set_sample(bright_sample());
    hard.note_on(69, 127); // hard -> open / bright
    let hard_out = render(&mut hard, 8);

    let (b_soft, b_hard) = (brightness(&soft_out), brightness(&hard_out));
    assert!(
        b_hard > b_soft * 1.5,
        "a hard note ({b_hard}) must be brighter than a soft one ({b_soft})"
    );
    assert!(peak(&soft_out) > 0.001, "soft note went silent");
}

#[test]
fn sampler_resamples_pitch_up_an_octave() {
    let mut s = SamplerInstrument::new(SR);
    s.activate(SR, BLOCK);
    s.set_param(param::SUSTAIN, 1.0);
    s.set_sample(sine_sample(1000.0, 69));
    s.note_on(81, 100); // octave above root -> ~2000 Hz
    let out = render(&mut s, 12);
    let f = estimate_freq(&out, SR);
    assert!(
        (f - 2000.0).abs() < 60.0,
        "sampler +1 octave measured {f} Hz, expected ~2000"
    );
}

#[test]
fn sampler_release_decays_after_note_off() {
    let mut s = SamplerInstrument::new(SR);
    s.activate(SR, BLOCK);
    s.set_param(param::SUSTAIN, 1.0);
    s.set_param(param::RELEASE, 0.05);
    s.set_sample(sine_sample(440.0, 69));
    s.note_on(69, 120);
    let held = render(&mut s, 4);
    s.note_off(69);
    let released = render(&mut s, 32);
    let tail = peak(&released[released.len() - BLOCK..]);
    assert!(
        tail < 0.01 * peak(&held).max(1e-6) + 1e-4,
        "sampler release did not decay: held {}, tail {}",
        peak(&held),
        tail
    );
}

#[test]
fn sampler_voice_steal_is_bounded_and_finite() {
    let mut s = SamplerInstrument::new(SR);
    s.activate(SR, BLOCK);
    s.set_param(param::SUSTAIN, 1.0);
    s.set_sample(sine_sample(440.0, 69));
    for n in 50..50 + 40u8 {
        s.note_on(n, 100);
    }
    let out = render(&mut s, 4);
    assert!(
        out.iter().all(|x| x.is_finite()),
        "sampler steal produced NaN"
    );
    assert!(peak(&out) > 0.01, "sampler voice-stolen pool went silent");
}

#[test]
fn sampler_without_sample_is_silent_not_panicking() {
    let mut s = SamplerInstrument::new(SR);
    s.activate(SR, BLOCK);
    s.note_on(69, 100); // no PCM loaded
    let out = render(&mut s, 2);
    assert_eq!(peak(&out), 0.0, "unloaded sampler should be silent");
}

// ===========================================================================
// Loaders / manifests
// ===========================================================================

#[test]
fn loaders_expose_expected_manifests() {
    let osc = OscLoader::new();
    assert_eq!(osc.manifest().id, OSC_ID);
    assert_eq!(osc.manifest().kind, PrimitiveKind::Osc);
    assert_eq!(osc.manifest().ports.audio_out, 1);
    assert_eq!(osc.manifest().ports.audio_in, 0);

    let samp = SamplerLoader::new();
    assert_eq!(samp.manifest().id, SAMPLER_ID);
    assert_eq!(samp.manifest().kind, PrimitiveKind::Sampler);

    let karp = KarplusLoader::new();
    assert_eq!(karp.manifest().id, KARPLUS_ID);
    assert_eq!(karp.manifest().kind, PrimitiveKind::KarplusString);
}

#[test]
fn loaders_instantiate_drivable_instances() {
    let osc = OscLoader::new();
    let mut inst = osc.instantiate(SR, BLOCK);
    inst.activate(SR, BLOCK);
    inst.note_on(64, 100);
    let out = render(&mut *inst, 4);
    assert!(peak(&out) > 0.01, "instantiated osc was silent");
}
