//! Latency math for the Phase-1 loopback harness.
//!
//! Everything here is pure arithmetic over `(frames, sample_rate)` and over a
//! captured loopback buffer — NO audio device is touched, so it is fully
//! unit-testable in this (device-less) sandbox. The live `<5 ms` round-trip is
//! measured on the founder's hardware by feeding the impulse these functions
//! analyse through a real duplex stream (see `src/bin/loopback.rs`).

/// The pieces of a round-trip latency estimate, all in milliseconds.
///
/// A duplex audio path delays the signal by, at minimum: the input ring it is
/// captured into, the engine's own processing block, and the output ring it is
/// played out of. This is the *buffering* floor — driver/hardware converter
/// latency is on top and is what the live impulse measurement actually captures.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatencyEstimate {
    /// Capture-side buffering: `input_frames / sample_rate`.
    pub input_ms: f32,
    /// One engine block: `block_frames / sample_rate`.
    pub block_ms: f32,
    /// Playback-side buffering: `output_frames / sample_rate`.
    pub output_ms: f32,
    /// Sum of the three above — the theoretical buffering round-trip floor.
    pub round_trip_ms: f32,
}

/// Convert a count of frames to milliseconds at `sample_rate` Hz.
///
/// Returns `0.0` for a non-positive sample rate rather than dividing by zero,
/// so a mis-configured stream degrades to a harmless estimate instead of `NaN`.
#[inline]
pub fn frames_to_ms(frames: u32, sample_rate: u32) -> f32 {
    if sample_rate == 0 {
        return 0.0;
    }
    (frames as f32 / sample_rate as f32) * 1000.0
}

/// Inverse of [`frames_to_ms`]: how many whole frames span `ms` milliseconds at
/// `sample_rate`. Rounds to the nearest frame; `0` for a non-positive rate.
#[inline]
pub fn ms_to_frames(ms: f32, sample_rate: u32) -> u32 {
    if sample_rate == 0 || ms <= 0.0 {
        return 0;
    }
    (ms * sample_rate as f32 / 1000.0).round() as u32
}

impl LatencyEstimate {
    /// Build the buffering-floor estimate from the three frame counts and the
    /// stream sample rate.
    pub fn from_frames(
        input_frames: u32,
        block_frames: u32,
        output_frames: u32,
        sample_rate: u32,
    ) -> Self {
        let input_ms = frames_to_ms(input_frames, sample_rate);
        let block_ms = frames_to_ms(block_frames, sample_rate);
        let output_ms = frames_to_ms(output_frames, sample_rate);
        Self {
            input_ms,
            block_ms,
            output_ms,
            round_trip_ms: input_ms + block_ms + output_ms,
        }
    }
}

/// Find the first sample in `captured` whose absolute value crosses `threshold`,
/// i.e. the onset of an impulse echoed back through the loopback path. `None` if
/// nothing crossed the threshold (silence / no echo detected).
///
/// This is the analysis half of the live measurement: the harness emits a click
/// at a known frame and locates where it reappears in the recorded input; the
/// gap between the two is the measured device round-trip.
pub fn detect_onset(captured: &[f32], threshold: f32) -> Option<usize> {
    captured.iter().position(|&s| s.abs() >= threshold)
}

/// Measure the round-trip latency, in frames, of a single impulse: the distance
/// from the frame the impulse was *emitted* (`emit_frame`) to the frame it was
/// *detected* re-entering the capture buffer.
///
/// Returns `None` if no onset was found, or if the detected onset precedes the
/// emit point (which would indicate a mis-aligned capture, never a real echo).
pub fn measure_round_trip_frames(
    captured: &[f32],
    emit_frame: usize,
    threshold: f32,
) -> Option<usize> {
    let onset = detect_onset(captured, threshold)?;
    // `onset <= emit_frame` is implausible (the echo cannot arrive at or before
    // it was emitted); `filter(|&d| d > 0)` rejects both the underflow `None`
    // from `checked_sub` and the zero-latency degenerate case.
    onset.checked_sub(emit_frame).filter(|&d| d > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_to_ms_basic() {
        // 48 frames @ 48 kHz == 1 ms exactly.
        assert!((frames_to_ms(48, 48_000) - 1.0).abs() < 1e-6);
        // 64 frames @ 48 kHz ~= 1.333 ms.
        assert!((frames_to_ms(64, 48_000) - 1.3333334).abs() < 1e-4);
        // 32 frames @ 44.1 kHz ~= 0.7256 ms.
        assert!((frames_to_ms(32, 44_100) - 0.725624).abs() < 1e-4);
    }

    #[test]
    fn frames_to_ms_zero_rate_is_safe() {
        assert_eq!(frames_to_ms(128, 0), 0.0);
    }

    #[test]
    fn ms_to_frames_roundtrips_frames_to_ms() {
        for &(frames, sr) in &[(32u32, 48_000u32), (64, 48_000), (128, 44_100)] {
            let ms = frames_to_ms(frames, sr);
            assert_eq!(ms_to_frames(ms, sr), frames, "roundtrip {frames}@{sr}");
        }
    }

    #[test]
    fn ms_to_frames_zero_inputs_are_safe() {
        assert_eq!(ms_to_frames(5.0, 0), 0);
        assert_eq!(ms_to_frames(0.0, 48_000), 0);
        assert_eq!(ms_to_frames(-3.0, 48_000), 0);
    }

    #[test]
    fn estimate_sums_three_legs() {
        // 64-frame input + 64-frame block + 64-frame output @ 48 kHz.
        let e = LatencyEstimate::from_frames(64, 64, 64, 48_000);
        let one_block = frames_to_ms(64, 48_000);
        assert!((e.input_ms - one_block).abs() < 1e-6);
        assert!((e.block_ms - one_block).abs() < 1e-6);
        assert!((e.output_ms - one_block).abs() < 1e-6);
        assert!((e.round_trip_ms - 3.0 * one_block).abs() < 1e-5);
    }

    #[test]
    fn small_buffer_estimate_is_sub_5ms() {
        // The whole point of U7: 32-frame buffers @ 48 kHz keep the *buffering*
        // floor well under 5 ms (driver/converter latency lands on top, live).
        let e = LatencyEstimate::from_frames(32, 32, 32, 48_000);
        assert!(e.round_trip_ms < 5.0, "got {} ms", e.round_trip_ms);
    }

    #[test]
    fn onset_detection_finds_the_click() {
        let mut buf = vec![0.0f32; 256];
        buf[100] = 0.9; // the echoed impulse
        assert_eq!(detect_onset(&buf, 0.5), Some(100));
    }

    #[test]
    fn onset_detection_ignores_subthreshold_noise() {
        let buf = vec![0.01f32; 256];
        assert_eq!(detect_onset(&buf, 0.5), None);
    }

    #[test]
    fn round_trip_frames_is_onset_minus_emit() {
        let mut buf = vec![0.0f32; 512];
        buf[200] = -0.8; // negative-going click, abs() still crosses
        // Emitted at frame 8; detected at 200 => 192-frame round trip.
        assert_eq!(measure_round_trip_frames(&buf, 8, 0.5), Some(192));
    }

    #[test]
    fn round_trip_none_when_no_echo() {
        let buf = vec![0.0f32; 512];
        assert_eq!(measure_round_trip_frames(&buf, 8, 0.5), None);
    }

    #[test]
    fn round_trip_none_when_onset_precedes_emit() {
        let mut buf = vec![0.0f32; 512];
        buf[4] = 1.0; // onset before the emit frame: implausible, reject
        assert_eq!(measure_round_trip_frames(&buf, 8, 0.5), None);
    }
}
