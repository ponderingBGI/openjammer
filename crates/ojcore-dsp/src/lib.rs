//! Pure OpenJammer DSP kernels.
//!
//! `no_std` (math via `libm`) so the exact same source compiles for the native
//! engine and the `wasm32` AudioWorklet. Buffers (delay lines, waveshaper LUTs)
//! are allocated at construction; the `process` hot paths are allocation-free.
//!
//! The biquad coefficient formulas and the distortion curve are ported
//! verbatim from the existing TS implementation
//! (`src/audio/pipeline/OperationFuser.ts`) so golden-render A/B parity holds.
#![cfg_attr(not(test), no_std)]

extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use core::f32::consts::PI;

pub mod guards;

// ===========================================================================
// Biquad (RBJ Audio EQ Cookbook), transposed Direct Form II
// ===========================================================================

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
    Peaking,
    Lowshelf,
    Highshelf,
    Allpass,
}

/// Normalized biquad coefficients (a0 divided out).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    pub const fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Port of `calculateBiquadCoefficients` (RBJ cookbook).
    pub fn design(
        kind: FilterType,
        frequency: f32,
        q: f32,
        gain_db: f32,
        sample_rate: f32,
    ) -> Self {
        let w0 = 2.0 * PI * frequency / sample_rate;
        let cos_w0 = libm::cosf(w0);
        let sin_w0 = libm::sinf(w0);
        let alpha = sin_w0 / (2.0 * q);
        let a = libm::powf(10.0, gain_db / 40.0);

        // Each arm yields (b0, b1, b2, a0, a1, a2); a0 is divided out below.
        let (b0, b1, b2, a0, a1, a2) = match kind {
            FilterType::Lowpass => (
                (1.0 - cos_w0) / 2.0,
                1.0 - cos_w0,
                (1.0 - cos_w0) / 2.0,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            ),
            FilterType::Highpass => (
                (1.0 + cos_w0) / 2.0,
                -(1.0 + cos_w0),
                (1.0 + cos_w0) / 2.0,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            ),
            FilterType::Bandpass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha),
            FilterType::Notch => (
                1.0,
                -2.0 * cos_w0,
                1.0,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            ),
            FilterType::Peaking => (
                1.0 + alpha * a,
                -2.0 * cos_w0,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos_w0,
                1.0 - alpha / a,
            ),
            FilterType::Lowshelf => {
                let sqrt_a = libm::sqrtf(a);
                (
                    a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
                    a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
                    (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
                    (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
                )
            }
            FilterType::Highshelf => {
                let sqrt_a = libm::sqrtf(a);
                (
                    a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
                    a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
                    (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
                    (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
                )
            }
            FilterType::Allpass => (
                1.0 - alpha,
                -2.0 * cos_w0,
                1.0 + alpha,
                1.0 + alpha,
                -2.0 * cos_w0,
                1.0 - alpha,
            ),
        };

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

/// A single biquad stage (transposed Direct Form II — two state words).
#[derive(Debug, Clone, Copy)]
pub struct Biquad {
    c: BiquadCoeffs,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub fn new(c: BiquadCoeffs) -> Self {
        Self {
            c,
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub fn set_coeffs(&mut self, c: BiquadCoeffs) {
        self.c = c;
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.c.b0 * x + self.z1;
        self.z1 = self.c.b1 * x - self.c.a1 * y + self.z2;
        self.z2 = self.c.b2 * x - self.c.a2 * y;
        y
    }
}

// ===========================================================================
// Waveshaper (soft-clip distortion LUT) — port of `generateDistortionCurve`
// ===========================================================================

/// Build a soft-clipping waveshaper curve over `samples` points in `x∈[-1,1]`.
pub fn generate_distortion_curve(amount: f32, samples: usize) -> Vec<f32> {
    let mut curve = vec![0.0f32; samples.max(1)];
    let deg = PI / 180.0;
    let k = amount.clamp(0.0, 1.0) * 100.0;
    let n = curve.len();
    for (i, c) in curve.iter_mut().enumerate() {
        let x = (i as f32 * 2.0) / n as f32 - 1.0;
        *c = if k == 0.0 {
            x
        } else {
            ((3.0 + k) * x * 20.0 * deg) / (PI + k * libm::fabsf(x))
        };
    }
    curve
}

/// Lookup-table waveshaper. The curve is built once at construction.
#[derive(Debug, Clone)]
pub struct Waveshaper {
    curve: Vec<f32>,
}

impl Waveshaper {
    pub fn new(amount: f32, samples: usize) -> Self {
        Self {
            curve: generate_distortion_curve(amount, samples),
        }
    }

    #[inline]
    pub fn process(&self, x: f32) -> f32 {
        let n = self.curve.len();
        if n < 2 {
            return x;
        }
        let pos = ((x.clamp(-1.0, 1.0) + 1.0) * 0.5) * (n as f32 - 1.0);
        let i = pos as usize;
        if i + 1 >= n {
            return self.curve[n - 1];
        }
        let frac = pos - i as f32;
        self.curve[i] * (1.0 - frac) + self.curve[i + 1] * frac
    }
}

// ===========================================================================
// Delay line (feedback + wet/dry) — buffer allocated up front
// ===========================================================================

#[derive(Debug, Clone)]
pub struct DelayLine {
    buf: Vec<f32>,
    write: usize,
    feedback: f32,
    wet: f32,
}

impl DelayLine {
    pub fn new(max_samples: usize) -> Self {
        Self {
            buf: vec![0.0; max_samples.max(1)],
            write: 0,
            feedback: 0.0,
            wet: 0.5,
        }
    }

    pub fn set(&mut self, feedback: f32, wet: f32) {
        self.feedback = feedback.clamp(0.0, 0.99);
        self.wet = wet.clamp(0.0, 1.0);
    }

    #[inline]
    pub fn process(&mut self, x: f32, delay_samples: usize) -> f32 {
        let n = self.buf.len();
        let d = delay_samples.clamp(1, n - 1);
        let read = (self.write + n - d) % n;
        let delayed = self.buf[read];
        let out = x * (1.0 - self.wet) + delayed * self.wet;
        self.buf[self.write] = x + delayed * self.feedback;
        self.write = (self.write + 1) % n;
        out
    }
}

// ===========================================================================
// Convolution (time-domain FIR) — impulse-response reverb / cabinet sim
// ===========================================================================

/// A time-domain (direct FIR) convolution engine. The impulse response is
/// installed once off the RT thread ([`Convolver::set_ir`]); the `process` hot
/// path runs a straight multiply-accumulate against a fixed-capacity input
/// history ring, so it is allocation-free.
///
/// Time-domain (rather than partitioned FFT) keeps the crate `no_std` with zero
/// extra deps. The IR is length-capped at construction; longer IRs are truncated
/// to that cap so the per-sample cost stays bounded and predictable.
#[derive(Debug, Clone)]
pub struct Convolver {
    /// The (possibly truncated) impulse response taps.
    ir: Vec<f32>,
    /// Ring of the most recent inputs; `len() == ir.capacity()`.
    history: Vec<f32>,
    /// Next write position in `history` (the slot the next input takes).
    write: usize,
    /// Number of valid IR taps actually loaded (`<= ir.capacity()`).
    taps: usize,
}

impl Convolver {
    /// Create a convolver that can hold an IR up to `max_taps` long. The history
    /// ring is sized to match so the `process` MAC never reads out of bounds.
    pub fn new(max_taps: usize) -> Self {
        let cap = max_taps.max(1);
        Self {
            ir: vec![0.0; cap],
            history: vec![0.0; cap],
            write: 0,
            taps: 0,
        }
    }

    /// Maximum IR length this convolver was sized for.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.ir.len()
    }

    /// Install (or replace) the impulse response. Off the RT thread. The IR is
    /// truncated to [`Convolver::capacity`] if longer; the history ring is
    /// cleared so no stale tail bleeds across the swap.
    pub fn set_ir(&mut self, ir: &[f32]) {
        let n = ir.len().min(self.ir.len());
        self.ir[..n].copy_from_slice(&ir[..n]);
        for t in self.ir[n..].iter_mut() {
            *t = 0.0;
        }
        self.taps = n;
        self.reset();
    }

    /// Whether an IR is currently loaded (non-empty).
    #[inline]
    pub fn is_loaded(&self) -> bool {
        self.taps > 0
    }

    /// Clear the input history (filter memory). Keeps the loaded IR.
    pub fn reset(&mut self) {
        for s in self.history.iter_mut() {
            *s = 0.0;
        }
        self.write = 0;
    }

    /// Convolve one input sample, returning `sum_{k} ir[k] * x[n-k]`. With no IR
    /// loaded this is a clean passthrough so an unbound convolution node is a
    /// no-op rather than silence.
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if self.taps == 0 {
            return x;
        }
        let cap = self.history.len();
        // Newest sample takes the `write` slot; advance the cursor past it.
        self.history[self.write] = x;
        self.write = (self.write + 1) % cap;
        // MAC the IR against the history, newest-first: tap k multiplies x[n-k].
        let mut acc = 0.0;
        let mut idx = self.write; // one past newest; stepping back hits newest first
        for &tap in self.ir[..self.taps].iter() {
            idx = if idx == 0 { cap - 1 } else { idx - 1 };
            acc += tap * self.history[idx];
        }
        acc
    }
}

// ===========================================================================
// One-pole parameter smoother (zipper-noise free)
// ===========================================================================

#[derive(Debug, Clone, Copy)]
pub struct OnePole {
    current: f32,
    target: f32,
    coeff: f32,
}

impl OnePole {
    pub fn new(initial: f32) -> Self {
        Self {
            current: initial,
            target: initial,
            coeff: 0.0,
        }
    }

    /// Set the smoothing time constant (seconds). `0` = instant.
    pub fn set_time(&mut self, time_seconds: f32, sample_rate: f32) {
        self.coeff = if time_seconds <= 0.0 {
            0.0
        } else {
            libm::expf(-1.0 / (time_seconds * sample_rate))
        };
    }

    pub fn set_target(&mut self, t: f32) {
        self.target = t;
    }

    pub fn snap(&mut self, v: f32) {
        self.current = v;
        self.target = v;
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.current = self.target + (self.current - self.target) * self.coeff;
        self.current
    }

    pub fn value(&self) -> f32 {
        self.current
    }
}

// ===========================================================================
// Sine oscillator (phase accumulator)
// ===========================================================================

#[derive(Debug, Clone, Copy, Default)]
pub struct Osc {
    phase: f32,
    inc: f32,
}

impl Osc {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_freq(&mut self, freq: f32, sample_rate: f32) {
        self.inc = freq / sample_rate;
    }

    #[inline]
    pub fn next_sine(&mut self) -> f32 {
        let y = libm::sinf(self.phase * 2.0 * PI);
        self.phase += self.inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        y
    }
}

// ===========================================================================
// Karplus-Strong plucked string
// ===========================================================================

#[derive(Debug, Clone)]
pub struct KarplusString {
    buf: Vec<f32>,
    idx: usize,
    len: usize,
    damp: f32,
}

impl KarplusString {
    pub fn new(max_len: usize) -> Self {
        Self {
            buf: vec![0.0; max_len.max(2)],
            idx: 0,
            len: 2,
            damp: 0.996,
        }
    }

    /// Excite the string for a given pitch.
    pub fn pluck(&mut self, freq: f32, sample_rate: f32) {
        let l = ((sample_rate / freq) as usize).clamp(2, self.buf.len());
        self.len = l;
        self.idx = 0;
        // simple bipolar excitation
        for (i, s) in self.buf[..l].iter_mut().enumerate() {
            *s = if i % 2 == 0 { 1.0 } else { -1.0 };
        }
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        let cur = self.buf[self.idx];
        let nxt = self.buf[(self.idx + 1) % self.len];
        let out = cur;
        // averaging lowpass with feedback damping
        self.buf[self.idx] = 0.5 * (cur + nxt) * self.damp;
        self.idx = (self.idx + 1) % self.len;
        out
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn approx(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() <= eps
    }

    #[test]
    fn lowpass_passes_dc() {
        let mut bq = Biquad::new(BiquadCoeffs::design(
            FilterType::Lowpass,
            1_000.0,
            0.707,
            0.0,
            SR,
        ));
        let mut y = 0.0;
        for _ in 0..4000 {
            y = bq.process(1.0);
        }
        // DC gain of an RBJ lowpass is unity.
        assert!(approx(y, 1.0, 1e-3), "dc gain was {y}");
    }

    #[test]
    fn lowpass_attenuates_nyquist() {
        let mut bq = Biquad::new(BiquadCoeffs::design(
            FilterType::Lowpass,
            1_000.0,
            0.707,
            0.0,
            SR,
        ));
        let mut last = 0.0;
        for i in 0..4000 {
            let x = if i % 2 == 0 { 1.0 } else { -1.0 };
            last = bq.process(x);
        }
        assert!(last.abs() < 0.05, "nyquist not attenuated: {last}");
    }

    #[test]
    fn biquad_is_stable() {
        let mut bq = Biquad::new(BiquadCoeffs::design(
            FilterType::Peaking,
            800.0,
            1.5,
            6.0,
            SR,
        ));
        let mut max = 0.0f32;
        for i in 0..8000 {
            let x = libm::sinf(i as f32 * 0.1);
            let y = bq.process(x);
            assert!(y.is_finite());
            max = max.max(y.abs());
        }
        assert!(max < 100.0, "filter blew up: {max}");
    }

    #[test]
    fn distortion_curve_is_identity_at_zero() {
        let curve = generate_distortion_curve(0.0, 1024);
        // midpoint ~ x=0 -> 0; endpoints ~ -1 and +~1
        assert!(approx(curve[512], 0.0, 0.01));
        assert!(curve[0] < -0.9);
        assert!(*curve.last().unwrap() > 0.9);
    }

    #[test]
    fn waveshaper_passthrough_at_zero_amount() {
        let ws = Waveshaper::new(0.0, 2048);
        assert!(approx(ws.process(0.5), 0.5, 0.01));
        assert!(approx(ws.process(-0.25), -0.25, 0.01));
    }

    #[test]
    fn delay_reproduces_impulse_after_n_samples() {
        let mut d = DelayLine::new(1000);
        d.set(0.0, 1.0); // full wet, no feedback
        let delay = 100;
        let mut tap = None;
        for i in 0..400 {
            let x = if i == 0 { 1.0 } else { 0.0 };
            let y = d.process(x, delay);
            if i == delay {
                tap = Some(y);
            }
        }
        assert!(approx(tap.unwrap(), 1.0, 1e-4), "impulse not delayed");
    }

    #[test]
    fn convolver_unit_impulse_is_passthrough() {
        // IR = [1.0] is the identity kernel: out == in, one sample at a time.
        let mut c = Convolver::new(8);
        c.set_ir(&[1.0]);
        for &x in &[0.5, -0.25, 1.0, 0.0, -1.0] {
            assert!(approx(c.process(x), x, 1e-6));
        }
    }

    #[test]
    fn convolver_delays_by_tap_index() {
        // IR = [0, 0, 1] delays the input by two samples (tap index == lag).
        let mut c = Convolver::new(8);
        c.set_ir(&[0.0, 0.0, 1.0]);
        let xs = [1.0, 0.0, 0.0, 0.0, 0.0];
        let ys: Vec<f32> = xs.iter().map(|&x| c.process(x)).collect();
        assert!(approx(ys[0], 0.0, 1e-6));
        assert!(approx(ys[1], 0.0, 1e-6));
        assert!(approx(ys[2], 1.0, 1e-6), "impulse should appear at lag 2");
    }

    #[test]
    fn convolver_no_ir_is_passthrough() {
        let mut c = Convolver::new(8);
        // No IR installed -> clean passthrough, not silence.
        assert!(approx(c.process(0.7), 0.7, 1e-6));
    }

    #[test]
    fn convolver_truncates_overlong_ir() {
        let mut c = Convolver::new(2);
        c.set_ir(&[1.0, 2.0, 3.0, 4.0]); // truncated to first 2 taps
        assert_eq!(c.capacity(), 2);
        // y[n] = 1*x[n] + 2*x[n-1]; feed an impulse.
        let ys: Vec<f32> = [1.0, 0.0, 0.0].iter().map(|&x| c.process(x)).collect();
        assert!(approx(ys[0], 1.0, 1e-6));
        assert!(approx(ys[1], 2.0, 1e-6));
    }

    #[test]
    fn smoother_converges_to_target() {
        let mut s = OnePole::new(0.0);
        s.set_time(0.005, SR);
        s.set_target(1.0);
        let mut v = 0.0;
        for _ in 0..2000 {
            v = s.tick();
        }
        assert!(approx(v, 1.0, 1e-2), "smoother at {v}");
    }

    #[test]
    fn osc_stays_in_range() {
        let mut o = Osc::new();
        o.set_freq(440.0, SR);
        for _ in 0..10_000 {
            let y = o.next_sine();
            assert!((-1.0..=1.0).contains(&y));
        }
    }

    #[test]
    fn karplus_decays() {
        let mut k = KarplusString::new(2048);
        k.pluck(220.0, SR);
        let early: f32 = (0..200).map(|_| k.tick().abs()).sum();
        let late: f32 = (0..200).map(|_| k.tick().abs()).sum();
        assert!(
            late < early,
            "string did not decay: early={early} late={late}"
        );
    }
}
