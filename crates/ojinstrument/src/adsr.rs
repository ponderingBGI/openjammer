//! A minimal, allocation-free ADSR envelope shared by the voice-based
//! instruments.
//!
//! Stages: silence -> Attack (linear 0->1) -> Decay (linear 1->sustain) ->
//! Sustain (held at the sustain level until note-off) -> Release. The release
//! is an **exponential one-pole** decay toward zero (per the U6 spec), giving a
//! natural-sounding tail rather than a straight linear ramp.
//!
//! `tick()` advances one sample and returns the current gain in `[0, 1]`. The
//! envelope reports [`Adsr::is_active`] until it has fully decayed after a
//! note-off, which the voice pool uses to recycle finished voices.

/// Time/level configuration for an [`Adsr`]. Times are in seconds; `sustain`
/// is a level in `[0, 1]`.
#[derive(Debug, Clone, Copy)]
pub struct AdsrParams {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
}

impl Default for AdsrParams {
    fn default() -> Self {
        // A short, percussive-ish default that still sustains while held.
        Self {
            attack: 0.005,
            decay: 0.080,
            sustain: 0.7,
            release: 0.120,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

/// A single ADSR voice envelope. Construct with a sample rate, configure with
/// [`Adsr::set_params`], then [`Adsr::gate_on`] / [`Adsr::gate_off`] and tick.
#[derive(Debug, Clone, Copy)]
pub struct Adsr {
    params: AdsrParams,
    sample_rate: f32,
    stage: Stage,
    level: f32,
    /// Per-sample linear increment for the attack stage.
    attack_inc: f32,
    /// Per-sample linear decrement for the decay stage.
    decay_inc: f32,
    /// One-pole coefficient for the exponential release stage.
    release_coeff: f32,
}

/// Below this level the release stage is considered finished and the voice may
/// be recycled. -80 dB is well below audibility.
const SILENCE: f32 = 1.0e-4;

impl Adsr {
    /// New envelope bound to `sample_rate` with the given params.
    pub fn new(sample_rate: f32, params: AdsrParams) -> Self {
        let mut a = Self {
            params,
            sample_rate: sample_rate.max(1.0),
            stage: Stage::Idle,
            level: 0.0,
            attack_inc: 0.0,
            decay_inc: 0.0,
            release_coeff: 0.0,
        };
        a.recompute();
        a
    }

    /// Update the time/level params (recomputes the per-sample rates). Cheap;
    /// safe to call between blocks.
    pub fn set_params(&mut self, params: AdsrParams) {
        self.params = params;
        self.recompute();
    }

    /// Re-bind to a sample rate (recomputes the per-sample rates).
    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.recompute();
    }

    fn recompute(&mut self) {
        let sr = self.sample_rate;
        self.attack_inc = inc_for(self.params.attack, sr);
        let decay_span = (1.0 - self.params.sustain.clamp(0.0, 1.0)).max(0.0);
        self.decay_inc = inc_for(self.params.decay, sr) * decay_span;
        // Exponential one-pole release: per-sample multiplier that reaches the
        // SILENCE floor in ~`release` seconds (time-constant scaled so the tail
        // length tracks the configured release time).
        self.release_coeff = if self.params.release <= 0.0 {
            0.0
        } else {
            libm::expf(-1.0 / (self.params.release * sr).max(1.0))
        };
    }

    /// Trigger the attack stage (note-on). Starts from the current level so a
    /// re-triggered (stolen) voice does not click.
    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
    }

    /// Enter the release stage (note-off). No-op if already idle.
    pub fn gate_off(&mut self) {
        if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }

    /// Hard-reset to silence (voice steal / instrument reset).
    pub fn reset(&mut self) {
        self.stage = Stage::Idle;
        self.level = 0.0;
    }

    /// Whether the envelope is still producing audible output (i.e. not idle).
    #[inline]
    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// Advance one sample, returning the current gain in `[0, 1]`.
    #[inline]
    pub fn tick(&mut self) -> f32 {
        match self.stage {
            Stage::Idle => {
                self.level = 0.0;
            }
            Stage::Attack => {
                self.level += self.attack_inc;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.level -= self.decay_inc;
                let sustain = self.params.sustain.clamp(0.0, 1.0);
                if self.level <= sustain {
                    self.level = sustain;
                    self.stage = Stage::Sustain;
                }
            }
            Stage::Sustain => {
                self.level = self.params.sustain.clamp(0.0, 1.0);
            }
            Stage::Release => {
                self.level *= self.release_coeff;
                if self.level <= SILENCE {
                    self.level = 0.0;
                    self.stage = Stage::Idle;
                }
            }
        }
        self.level
    }
}

/// Per-sample linear increment that traverses a unit span in `time` seconds.
/// A zero/negative time means "instant" (full step in one sample).
#[inline]
fn inc_for(time: f32, sample_rate: f32) -> f32 {
    if time <= 0.0 {
        1.0
    } else {
        1.0 / (time * sample_rate).max(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn idle_is_silent_and_inactive() {
        let mut e = Adsr::new(SR, AdsrParams::default());
        assert!(!e.is_active());
        for _ in 0..100 {
            assert_eq!(e.tick(), 0.0);
        }
    }

    #[test]
    fn attack_rises_then_settles_to_sustain() {
        let p = AdsrParams {
            attack: 0.001,
            decay: 0.001,
            sustain: 0.5,
            release: 0.05,
        };
        let mut e = Adsr::new(SR, p);
        e.gate_on();
        let mut peak = 0.0f32;
        for _ in 0..2000 {
            peak = peak.max(e.tick());
        }
        // Reached (near) full scale on the way up.
        assert!(peak > 0.95, "attack peak was {peak}");
        // Settles at the sustain level.
        let mut last = 0.0;
        for _ in 0..2000 {
            last = e.tick();
        }
        assert!((last - 0.5).abs() < 1e-3, "sustain level was {last}");
        assert!(e.is_active());
    }

    #[test]
    fn release_decays_to_silence_and_deactivates() {
        let p = AdsrParams {
            attack: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.02,
        };
        let mut e = Adsr::new(SR, p);
        e.gate_on();
        // settle into sustain
        for _ in 0..100 {
            e.tick();
        }
        let before = e.tick();
        e.gate_off();
        let mut last = before;
        for _ in 0..(SR as usize) {
            last = e.tick();
            if !e.is_active() {
                break;
            }
        }
        assert!(last < before, "release did not decay: {before} -> {last}");
        assert!(!e.is_active(), "envelope never went idle after release");
    }
}
