//! Offline-render audio ANALYSIS — the shared "what does this sound like?" report.
//!
//! This is the VERIFY half of the audition pillar (`docs/BOUNDARY.md` §9 "two
//! clocks"): [`crate::OfflineDriver`] renders a graph device-free, and
//! [`analyze_stereo`] turns the resulting L/R buffers into a structured
//! [`AudioReport`] — so an agent (or CI, or a test) can decide whether the sound is
//! right WITHOUT a human listening. One copy of the metrics lives here (extend,
//! don't fork): the `render` bin, future stems bounces, and the agent `audition`
//! tool all call this instead of re-deriving RMS/peak/pitch each time.
//!
//! Demo-gated (only the `render` bin + tests need it), so the lean host build that
//! the audio callback links never pulls serde.

use serde::Serialize;

/// Per-channel measurements (one for L, one for R).
#[derive(Debug, Clone, Serialize)]
pub struct ChannelReport {
    /// Root-mean-square level (energy).
    pub rms: f32,
    /// Largest absolute sample.
    pub peak: f32,
    /// Fundamental estimate from upward zero-crossings (Hz); 0.0 when silent.
    pub freq_est: f32,
}

/// A structured, serde-serializable verdict on a rendered stereo buffer. Everything
/// an agent needs to answer "did this graph make the sound I intended?".
#[derive(Debug, Clone, Serialize)]
pub struct AudioReport {
    pub frames: usize,
    pub sample_rate: u32,
    pub seconds: f32,
    /// Combined RMS across both channels (== interleaved RMS).
    pub rms: f32,
    /// Largest absolute sample across both channels.
    pub peak: f32,
    pub left: ChannelReport,
    pub right: ChannelReport,
    /// Pearson correlation of L vs R. ~1.0 = identical (a mono fan-out); lower means
    /// the channels genuinely differ — real stereo.
    pub stereo_correlation: f32,
    /// True when there is signal AND L/R differ meaningfully (correlation < 0.999).
    /// This is the assertion a stereo test wants: "I hear a real stereo image."
    pub is_stereo: bool,
    /// Percent of samples (both channels) above the silence floor (1e-4).
    pub nonsilent_pct: f32,
    /// Peak exceeded 1.0 — would clip a normalized sink.
    pub clipped: bool,
    /// No NaN/Inf escaped the engine — the single most important reliability gate.
    pub finite: bool,
}

const SILENCE_FLOOR: f32 = 1e-4;

fn rms(buf: &[f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = buf.iter().map(|&x| (x as f64) * (x as f64)).sum();
    (sum_sq / buf.len() as f64).sqrt() as f32
}

fn peak(buf: &[f32]) -> f32 {
    buf.iter()
        .fold(0.0f32, |m, &x| if x.is_finite() { m.max(x.abs()) } else { m })
}

/// Count upward zero-crossings (negative-or-zero → positive). One per cycle of a
/// periodic tone, so it yields a cheap fundamental estimate.
fn upward_zero_crossings(buf: &[f32]) -> usize {
    buf.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count()
}

fn estimate_freq(buf: &[f32], sample_rate: u32) -> f32 {
    if buf.len() < 2 || sample_rate == 0 {
        return 0.0;
    }
    let duration = buf.len() as f32 / sample_rate as f32;
    if duration <= 0.0 {
        0.0
    } else {
        upward_zero_crossings(buf) as f32 / duration
    }
}

/// Pearson correlation of two channels. 1.0 when identical (or both flat); a flat
/// channel paired with a signal channel reads 0.0 (clearly not a mono fan-out).
fn correlation(l: &[f32], r: &[f32]) -> f32 {
    let n = l.len().min(r.len());
    if n == 0 {
        return 1.0;
    }
    let (mut sl, mut sr) = (0.0f64, 0.0f64);
    for i in 0..n {
        sl += l[i] as f64;
        sr += r[i] as f64;
    }
    let (ml, mr) = (sl / n as f64, sr / n as f64);
    let (mut cov, mut vl, mut vr) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..n {
        let (dl, dr) = (l[i] as f64 - ml, r[i] as f64 - mr);
        cov += dl * dr;
        vl += dl * dl;
        vr += dr * dr;
    }
    let (fl, fr) = (vl <= 1e-20, vr <= 1e-20);
    if fl || fr {
        // Both flat -> identical (mono). One flat, one not -> definitely not a
        // mono fan-out, so the lowest correlation.
        return if fl == fr { 1.0 } else { 0.0 };
    }
    (cov / (vl.sqrt() * vr.sqrt())) as f32
}

/// Analyze a rendered stereo bounce into a verdict. `l`/`r` are planar channel
/// buffers (the shape [`crate::OfflineDriver::render_stereo`] returns).
pub fn analyze_stereo(l: &[f32], r: &[f32], sample_rate: u32) -> AudioReport {
    let frames = l.len().min(r.len());
    let finite = l.iter().chain(r.iter()).all(|x| x.is_finite());
    let lpk = peak(l);
    let rpk = peak(r);
    let pk = lpk.max(rpk);

    let total = (l.len() + r.len()).max(1);
    let comb_sum_sq: f64 = l
        .iter()
        .chain(r.iter())
        .map(|&x| (x as f64) * (x as f64))
        .sum();
    let comb_rms = (comb_sum_sq / total as f64).sqrt() as f32;

    let nonsilent = l
        .iter()
        .chain(r.iter())
        .filter(|&&x| x.abs() > SILENCE_FLOOR)
        .count();
    let nonsilent_pct = 100.0 * nonsilent as f32 / total as f32;

    let corr = correlation(l, r);
    let has_signal = comb_rms > SILENCE_FLOOR;

    AudioReport {
        frames,
        sample_rate,
        seconds: frames as f32 / sample_rate.max(1) as f32,
        rms: comb_rms,
        peak: pk,
        left: ChannelReport {
            rms: rms(l),
            peak: lpk,
            freq_est: estimate_freq(l, sample_rate),
        },
        right: ChannelReport {
            rms: rms(r),
            peak: rpk,
            freq_est: estimate_freq(r, sample_rate),
        },
        stereo_correlation: corr,
        is_stereo: has_signal && corr < 0.999,
        nonsilent_pct,
        clipped: pk > 1.0,
        finite,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_fanout_is_not_stereo() {
        let l = vec![0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
        let r = l.clone();
        let rep = analyze_stereo(&l, &r, 48_000);
        assert!(rep.finite);
        assert!(!rep.is_stereo, "identical channels must read mono");
        assert!(rep.stereo_correlation > 0.99);
        assert!(rep.peak > 0.0);
    }

    #[test]
    fn distinct_channels_read_stereo() {
        // Two sawtooths at different periods (no trig — libm-free, deterministic):
        // genuinely uncorrelated, each with one upward zero-crossing per period.
        let l: Vec<f32> = (0..960).map(|i| ((i % 100) as f32 / 100.0) * 2.0 - 1.0).collect();
        let r: Vec<f32> = (0..960).map(|i| ((i % 37) as f32 / 37.0) * 2.0 - 1.0).collect();
        let rep = analyze_stereo(&l, &r, 48_000);
        assert!(rep.finite);
        assert!(rep.is_stereo, "uncorrelated channels must read stereo");
        assert!(rep.left.freq_est > 0.0 && rep.right.freq_est > 0.0);
    }

    #[test]
    fn hard_panned_signal_reads_stereo() {
        // Signal hard-left (a ±0.5 square wave), right silent — the canonical pan.
        let l: Vec<f32> = (0..480)
            .map(|i| if (i / 20) % 2 == 0 { 0.5 } else { -0.5 })
            .collect();
        let r = vec![0.0f32; 480];
        let rep = analyze_stereo(&l, &r, 48_000);
        assert!(rep.is_stereo);
        assert!(rep.left.rms > 0.1 && rep.right.rms < 1e-3);
    }

    #[test]
    fn silence_is_finite_and_not_stereo() {
        let z = vec![0.0f32; 256];
        let rep = analyze_stereo(&z, &z, 48_000);
        assert!(rep.finite);
        assert!(!rep.is_stereo);
        assert_eq!(rep.nonsilent_pct, 0.0);
        assert!(!rep.clipped);
    }

    #[test]
    fn nan_is_caught() {
        let l = vec![0.1, f32::NAN, 0.2];
        let r = vec![0.1, 0.1, 0.1];
        let rep = analyze_stereo(&l, &r, 48_000);
        assert!(!rep.finite, "a NaN must trip the finite gate");
    }
}
