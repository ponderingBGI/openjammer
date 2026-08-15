//! U12 — the musical transport clock (no_std, alloc-free).
//!
//! `exec.rs` ships a *minimal* clock: a `u64` sample counter plus a play/pause
//! bool, enough to honour `TransportPlay/Pause/Seek`. This module ADDS the
//! musical interpretation on top of that same playhead — tempo (BPM), a time
//! signature, and a derived bar / beat / intra-beat phase — so the engine can
//! emit an [`ojproto::EngineFrame::Beat`] from a control-rate position read.
//!
//! It is deliberately additive: a [`Transport`] is a small `Copy` value the
//! [`crate::Engine`] holds alongside (and keeps in lockstep with) the existing
//! `playing` / `sample_pos` fields. Nothing here allocates, locks, or names
//! `std`, so it compiles unchanged for the `wasm32` AudioWorklet.

/// A musical position derived from the sample playhead. Returned by
/// [`Transport::position`] so the host can build a `Beat` frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransportPos {
    /// Zero-based bar index since the seek origin (sample 0).
    pub bar: u32,
    /// Zero-based beat within the current bar (`0..beats_per_bar`).
    pub beat: u32,
    /// Fractional progress through the current beat, in `[0.0, 1.0)`.
    pub phase: f32,
    /// The underlying sample playhead this position was derived from.
    pub sample: u64,
}

/// The musical clock: tempo + time signature laid over the sample playhead.
///
/// `Copy` and field-light so the [`crate::Engine`] can hold one by value and a
/// position read is pure arithmetic (no allocation). The playhead itself is
/// advanced by [`Transport::advance`] once per block while playing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transport {
    /// Sample rate in Hz. Set from the graph at install time.
    pub sample_rate: f32,
    /// Tempo in beats per minute (quarter-notes by convention).
    pub tempo_bpm: f32,
    /// Beats per bar (the time-signature numerator, e.g. 4 for 4/4).
    pub beats_per_bar: u32,
    /// Note value that gets one beat (the denominator, e.g. 4 for 4/4). Carried
    /// for completeness / UI display; the sample-clock maths uses `tempo_bpm`
    /// which is already quarter-note based.
    pub beat_unit: u32,
    /// Sample playhead (mirrors the engine's `sample_pos`).
    pub sample_pos: u64,
    /// Whether the clock is running (mirrors the engine's `playing`).
    pub playing: bool,
}

impl Default for Transport {
    fn default() -> Self {
        Self {
            sample_rate: 48_000.0,
            tempo_bpm: 120.0,
            beats_per_bar: 4,
            beat_unit: 4,
            sample_pos: 0,
            playing: false,
        }
    }
}

impl Transport {
    /// A transport at `sample_rate`, 120 BPM, 4/4, stopped at sample 0.
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            ..Self::default()
        }
    }

    /// Samples per beat at the current tempo (a quarter-note). Guards against a
    /// zero/garbage tempo or sample rate so the position maths never divides by
    /// zero on the audio thread.
    #[inline]
    pub fn samples_per_beat(&self) -> f64 {
        let bpm = if self.tempo_bpm > 0.0 {
            self.tempo_bpm
        } else {
            120.0
        };
        let sr = if self.sample_rate > 0.0 {
            self.sample_rate
        } else {
            48_000.0
        };
        (sr as f64) * 60.0 / (bpm as f64)
    }

    /// Set the tempo in BPM (ignored if non-positive — the prior tempo stays).
    #[inline]
    pub fn set_tempo(&mut self, bpm: f32) {
        if bpm > 0.0 {
            self.tempo_bpm = bpm;
        }
    }

    /// Set the time signature `numerator/denominator` (each clamped to >= 1).
    #[inline]
    pub fn set_time_signature(&mut self, numerator: u32, denominator: u32) {
        self.beats_per_bar = numerator.max(1);
        self.beat_unit = denominator.max(1);
    }

    /// Advance the playhead by `nframes` if playing. Called once per block by
    /// the executor. No-op while paused (frozen position).
    #[inline]
    pub fn advance(&mut self, nframes: usize) {
        if self.playing {
            self.sample_pos = self.sample_pos.wrapping_add(nframes as u64);
        }
    }

    /// The current musical position derived from the sample playhead.
    ///
    /// `bar`/`beat` are zero-based; `phase` is the fractional progress through
    /// the current beat in `[0, 1)`. Pure arithmetic — RT-safe.
    pub fn position(&self) -> TransportPos {
        // W1 compatibility bridge: interpret the still-authoritative scalar
        // fields as an immutable one-tempo/one-meter map. Its precomputed
        // points live on the stack, so this remains allocation-free.
        let bpm = if self.tempo_bpm > 0.0 {
            self.tempo_bpm
        } else {
            120.0
        };
        let sr = if self.sample_rate > 0.0 {
            self.sample_rate
        } else {
            48_000.0
        };
        let metric = crate::tempo::TempoMapRt::one_point_position(
            self.sample_pos,
            f64::from(sr),
            f64::from(bpm),
            self.beats_per_bar.max(1),
        );
        TransportPos {
            // Map BBT is one-based; this existing API stays zero-based.
            bar: metric.bar.saturating_sub(1),
            beat: metric.beat.saturating_sub(1),
            phase: metric.phase,
            sample: self.sample_pos,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn default_is_120_bpm_4_4_stopped() {
        let t = Transport::new(SR);
        assert_eq!(t.tempo_bpm, 120.0);
        assert_eq!(t.beats_per_bar, 4);
        assert_eq!(t.beat_unit, 4);
        assert!(!t.playing);
        assert_eq!(t.sample_pos, 0);
    }

    #[test]
    fn samples_per_beat_matches_tempo() {
        let mut t = Transport::new(SR);
        // 120 BPM => 0.5 s per beat => 24000 samples at 48 kHz.
        assert!((t.samples_per_beat() - 24_000.0).abs() < 1e-6);
        t.set_tempo(60.0); // one beat per second => 48000 samples.
        assert!((t.samples_per_beat() - 48_000.0).abs() < 1e-6);
    }

    #[test]
    fn paused_transport_does_not_advance() {
        let mut t = Transport::new(SR);
        t.advance(512);
        assert_eq!(t.sample_pos, 0, "paused clock is frozen");
        t.playing = true;
        t.advance(512);
        assert_eq!(t.sample_pos, 512);
    }

    #[test]
    fn bar_beat_advance_correctly() {
        // 120 BPM, 4/4: 24000 samples/beat, 96000 samples/bar.
        let mut t = Transport::new(SR);
        t.playing = true;

        // Start of timeline: bar 0, beat 0, phase 0.
        let p = t.position();
        assert_eq!((p.bar, p.beat), (0, 0));
        assert!(p.phase < 1e-6);

        // Half a beat in.
        t.sample_pos = 12_000;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (0, 0));
        assert!((p.phase - 0.5).abs() < 1e-4, "phase {}", p.phase);

        // Exactly beat 1.
        t.sample_pos = 24_000;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (0, 1));
        assert!(p.phase < 1e-4);

        // Beat 3 (last beat of bar 0).
        t.sample_pos = 24_000 * 3;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (0, 3));

        // First beat of bar 1 (after 4 beats == one bar).
        t.sample_pos = 96_000;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (1, 0));
        assert!(p.phase < 1e-4);

        // Beat 2 of bar 2.
        t.sample_pos = 96_000 * 2 + 24_000 * 2;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (2, 2));
    }

    #[test]
    fn time_signature_changes_bar_length() {
        // 3/4 at 120 BPM: 3 beats == one bar.
        let mut t = Transport::new(SR);
        t.playing = true;
        t.set_time_signature(3, 4);
        // After 3 beats we should be at bar 1, beat 0.
        t.sample_pos = 24_000 * 3;
        let p = t.position();
        assert_eq!((p.bar, p.beat), (1, 0));
    }

    #[test]
    fn guards_against_zero_tempo_and_rate() {
        let mut t = Transport::new(0.0);
        t.set_tempo(0.0); // rejected; stays at 120.
        assert_eq!(t.tempo_bpm, 120.0);
        // Falls back to safe constants rather than dividing by zero.
        assert!(t.samples_per_beat().is_finite());
        assert!(t.samples_per_beat() > 0.0);
    }
}
