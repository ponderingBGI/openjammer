//! Output safety guards for the code-node HOST layer (D4-A4).
//!
//! An AI-authored DSP kernel (a `.wasm` module, see `docs/code-node-abi.md`) is
//! UNTRUSTED. Even a kernel that compiles cleanly can emit `NaN`/`Inf` (a divide
//! by zero, an unstable feedback loop), denormals (which silently tank CPU on the
//! audio thread), an over-unity blast that clips the converters, or a DC offset
//! that creeps the speaker cone. These guards are the HOST's last line of defence:
//! they run on the kernel's output buffer AFTER `oj_process` returns, OUTSIDE the
//! wasm sandbox, so a kernel can never disable them — that is the whole point of
//! living here in `ojcore-dsp` (the host-shared DSP crate) rather than inside the
//! kernel ABI.
//!
//! All three guards are pure, allocation-free, `no_std`, and ported to run on both
//! the native engine and the `wasm32` worklet (the same code path D4 specifies for
//! when the founder wires the RT execution host). The DC blocker is the only
//! stateful one; the scrub + limiter are per-sample pure functions.
//!
//! # FOUNDER-GATED BOUNDARY
//!
//! These functions exist NOW and are unit-tested NOW, but nothing on the realtime
//! audio thread CALLS them yet: the wasmtime native execution host and the
//! AudioWorklet wasm executor are the founder-gated next step (see the ABI doc).
//! When that host lands it MUST funnel every code-node output sample through
//! [`OutputGuard`] before the sample reaches the bus — they are the contract a
//! Bypass-on-trip wrapper is built from.

/// The largest absolute sample value the limiter will ever emit. Slightly under
/// 1.0 so the downstream converters keep headroom and never hard-clip.
pub const LIMITER_CEILING: f32 = 0.999;

/// Below this magnitude an `f32` is treated as a denormal-ish "effectively zero"
/// and flushed to `0.0`. This is well above the true subnormal threshold so it
/// also catches the tiny-but-normal tails that cause denormal CPU spikes once
/// they feed back through a filter.
pub const DENORMAL_FLOOR: f32 = 1.0e-30;

/// Flush a single sample to a finite, denormal-free value.
///
/// * `NaN` / `+Inf` / `-Inf` -> `0.0` (a non-finite sample is meaningless audio
///   and would poison every later stage / the converters).
/// * `|x| < `[`DENORMAL_FLOOR`] -> `0.0` (kill denormals before they spike CPU).
/// * otherwise the sample is returned unchanged.
///
/// This does NOT bound the magnitude — that is the limiter's job; keeping the two
/// concerns separate makes each trivially testable.
#[inline]
pub fn scrub_denormals_and_nan(sample: f32) -> f32 {
    if !sample.is_finite() {
        return 0.0;
    }
    if libm::fabsf(sample) < DENORMAL_FLOOR {
        return 0.0;
    }
    sample
}

/// A hard peak limiter with a soft (cubic) knee approaching [`LIMITER_CEILING`].
///
/// Inputs within the linear region (|x| <= `knee_start`) pass through untouched.
/// Between the knee start and the ceiling the response is smoothly compressed so
/// there is no audible corner, and anything at/over the ceiling is clamped to
/// exactly +/- [`LIMITER_CEILING`]. The result is ALWAYS within +/- the ceiling.
///
/// Non-finite input is treated as `0.0` (the limiter is also a safety net: even if
/// it is called without a prior [`scrub_denormals_and_nan`] it can never emit a
/// `NaN`/`Inf`).
#[inline]
pub fn soft_limit(sample: f32) -> f32 {
    if !sample.is_finite() {
        return 0.0;
    }
    // Linear below the knee; the knee starts at half the ceiling.
    let ceiling = LIMITER_CEILING;
    let knee_start = ceiling * 0.5;
    let mag = libm::fabsf(sample);
    let sign = if sample < 0.0 { -1.0 } else { 1.0 };

    if mag <= knee_start {
        return sample;
    }
    if mag >= ceiling {
        return sign * ceiling;
    }
    // Soft knee: map [knee_start, +inf) onto [knee_start, ceiling) with a cubic
    // that flattens as it approaches the ceiling. `t` is how far into the knee
    // region the input is; we never let the output reach the ceiling for finite
    // input, and we clamp the rare overshoot at the end for total safety.
    let span = ceiling - knee_start;
    let over = mag - knee_start;
    // A saturating curve: out = knee_start + span * (1 - 1/(1+over/span)).
    let shaped = knee_start + span * (1.0 - 1.0 / (1.0 + over / span));
    let out = sign * shaped;
    // Belt-and-braces: guarantee the contract even against FP rounding.
    out.clamp(-ceiling, ceiling)
}

/// A one-pole DC blocker (high-pass at ~5–20 Hz): `y[n] = x[n] - x[n-1] + R*y[n-1]`.
///
/// Removes the slow DC drift an untrusted kernel can introduce (which would push
/// the speaker cone toward a rail and waste headroom) while leaving the audible
/// band essentially flat. `R` near 1.0 places the corner just above DC.
///
/// Stateful: one instance per output channel, reset on (re)load.
#[derive(Debug, Clone, Copy)]
pub struct DcBlocker {
    /// Previous input sample `x[n-1]`.
    x1: f32,
    /// Previous output sample `y[n-1]`.
    y1: f32,
    /// Pole radius `R` (closer to 1.0 = lower corner frequency).
    r: f32,
}

impl Default for DcBlocker {
    fn default() -> Self {
        Self::new()
    }
}

impl DcBlocker {
    /// A DC blocker with a sensible default corner (`R = 0.995`, ~corner near a
    /// handful of Hz at 48 kHz).
    pub fn new() -> Self {
        Self {
            x1: 0.0,
            y1: 0.0,
            r: 0.995,
        }
    }

    /// A DC blocker with an explicit pole radius `r` (clamped to a stable
    /// `[0.0, 0.99999]`). Higher `r` = lower corner = gentler bass roll-off.
    pub fn with_pole(r: f32) -> Self {
        Self {
            x1: 0.0,
            y1: 0.0,
            r: r.clamp(0.0, 0.999_99),
        }
    }

    /// Clear the filter memory (call on (re)load so no stale tail bleeds across).
    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }

    /// Filter one sample, removing its DC component.
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = x - self.x1 + self.r * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// The full host output guard chain a code-node host applies per output channel,
/// per sample, in the order D4-A4 mandates: **scrub -> DC-block -> limit**.
///
/// Scrubbing first means the DC blocker never integrates a `NaN`; limiting last
/// guarantees the value handed to the bus is finite AND within +/- the ceiling.
/// One instance per output channel (the DC blocker is stateful).
#[derive(Debug, Clone, Copy, Default)]
pub struct OutputGuard {
    dc: DcBlocker,
}

impl OutputGuard {
    /// A guard with the default DC blocker.
    pub fn new() -> Self {
        Self {
            dc: DcBlocker::new(),
        }
    }

    /// Reset the stateful stage (the DC blocker). Call on kernel (re)load.
    pub fn reset(&mut self) {
        self.dc.reset();
    }

    /// Run one output sample through the full guard chain.
    #[inline]
    pub fn process(&mut self, sample: f32) -> f32 {
        let scrubbed = scrub_denormals_and_nan(sample);
        let blocked = self.dc.process(scrubbed);
        soft_limit(blocked)
    }

    /// Run a whole output buffer in place (convenience for a block-based host).
    pub fn process_buffer(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            *s = self.process(*s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_flushes_non_finite_to_zero() {
        assert_eq!(scrub_denormals_and_nan(f32::NAN), 0.0);
        assert_eq!(scrub_denormals_and_nan(f32::INFINITY), 0.0);
        assert_eq!(scrub_denormals_and_nan(f32::NEG_INFINITY), 0.0);
    }

    #[test]
    fn scrub_flushes_denormals_to_zero() {
        assert_eq!(scrub_denormals_and_nan(1.0e-40), 0.0);
        assert_eq!(scrub_denormals_and_nan(-1.0e-40), 0.0);
        // f32::MIN_POSITIVE subnormal is well below the floor.
        assert_eq!(scrub_denormals_and_nan(f32::from_bits(1)), 0.0);
    }

    #[test]
    fn scrub_passes_normal_audio_unchanged() {
        for &x in &[0.5_f32, -0.25, 1.0, -1.0, 0.001, 0.0] {
            assert_eq!(scrub_denormals_and_nan(x), x);
        }
    }

    #[test]
    fn limiter_bounds_over_unity_input() {
        for &x in &[1.0_f32, 2.0, 10.0, 1.0e9, -1.0, -2.0, -1.0e9] {
            let y = soft_limit(x);
            assert!(y.is_finite(), "limiter emitted non-finite for {x}");
            assert!(
                y.abs() <= LIMITER_CEILING + 1e-6,
                "limiter did not bound {x} -> {y}"
            );
        }
    }

    #[test]
    fn limiter_passes_quiet_signals_untouched() {
        for &x in &[0.0_f32, 0.1, -0.1, 0.4, -0.4] {
            assert_eq!(soft_limit(x), x, "limiter altered linear-region sample {x}");
        }
    }

    #[test]
    fn limiter_is_finite_for_nonfinite_input() {
        // Non-finite input is treated as silence (0.0) — the limiter is a safety
        // net even when called without a prior scrub, and never emits NaN/Inf.
        assert_eq!(soft_limit(f32::NAN), 0.0);
        assert_eq!(soft_limit(f32::INFINITY), 0.0);
        assert_eq!(soft_limit(f32::NEG_INFINITY), 0.0);
    }

    #[test]
    fn dc_blocker_removes_constant_offset() {
        let mut dc = DcBlocker::new();
        // Feed a pure DC signal; the steady-state output must converge to ~0.
        let mut last = 0.0;
        for _ in 0..20_000 {
            last = dc.process(1.0);
        }
        assert!(last.abs() < 1e-2, "DC not removed, residual = {last}");
    }

    #[test]
    fn dc_blocker_passes_alternating_signal() {
        // A fast AC signal (Nyquist-ish square) should largely pass through.
        let mut dc = DcBlocker::new();
        // Prime the filter, then measure peak magnitude of the AC output.
        let mut peak = 0.0_f32;
        for i in 0..2000 {
            let x = if i % 2 == 0 { 1.0 } else { -1.0 };
            let y = dc.process(x);
            if i > 1000 {
                peak = peak.max(y.abs());
            }
        }
        // The AC content survives (a DC blocker barely touches high frequencies).
        assert!(peak > 0.9, "AC content over-attenuated, peak = {peak}");
    }

    #[test]
    fn output_guard_chain_is_finite_bounded_and_dc_free() {
        // A hostile buffer: NaN, Inf, denormal, huge over-unity, plus a DC bias.
        let mut guard = OutputGuard::new();
        let mut buf = [f32::NAN, f32::INFINITY, 1.0e-40, 50.0, -50.0, 1.0, 1.0, 1.0];
        guard.process_buffer(&mut buf);
        for &y in &buf {
            assert!(y.is_finite(), "guard chain leaked a non-finite sample");
            assert!(y.abs() <= LIMITER_CEILING + 1e-6, "guard chain leaked {y}");
        }

        // Now prove the DC stage: a long constant input ends near zero output.
        let mut dc_guard = OutputGuard::new();
        let mut last = 0.0;
        for _ in 0..20_000 {
            last = dc_guard.process(0.8);
        }
        assert!(last.abs() < 1e-2, "guard chain did not remove DC: {last}");
    }
}
