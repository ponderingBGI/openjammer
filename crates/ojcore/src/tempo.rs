//! Immutable, real-time-safe tempo and meter lookup.
//!
//! Construction validates and precomputes an [`ojproto::TempoMap`] off the
//! audio thread. Every lookup after that is allocation-free and lock-free.

use alloc::boxed::Box;
use alloc::vec::Vec;

use ojproto::{MeterPoint, TempoMap, TempoPoint};

#[derive(Debug, Clone, Copy)]
struct TempoRt {
    tick: u64,
    sample: u64,
    spq0: f64,
    omega: f64,
}

#[derive(Debug, Clone, Copy)]
struct MeterRt {
    tick: u64,
    bar: u32,
    divisions_per_bar: u8,
    note_value: u8,
}

/// One-entry lookup hint carried by a process callback across blocks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MetricCursor {
    tempo_i: u32,
    meter_i: u32,
}

/// One-based bar/beat coordinates and phase within the meter beat.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MetricPosition {
    pub bar: u32,
    pub beat: u32,
    pub phase: f32,
}

/// Precomputed immutable tempo-map snapshot.
#[derive(Debug)]
pub struct TempoMapRt {
    ppq: u32,
    sr: f64,
    tempos: Box<[TempoRt]>,
    meters: Box<[MeterRt]>,
}

impl TempoMapRt {
    /// Validate and precompute a wire map. This allocates and must run off-RT.
    pub fn from_wire(map: &TempoMap) -> Self {
        assert!(map.ppq > 0, "tempo map PPQ must be positive");
        assert!(
            map.sample_rate > 0,
            "tempo map sample rate must be positive"
        );
        assert!(!map.tempos.is_empty(), "tempo map needs a tempo point");
        assert!(!map.meters.is_empty(), "tempo map needs a meter point");
        assert_eq!(map.tempos[0].tick, 0, "tempo map must start at tick zero");
        assert_eq!(
            map.tempos[0].sample, 0,
            "tempo map must start at sample zero"
        );
        assert_eq!(map.meters[0].tick, 0, "meter map must start at tick zero");
        assert_eq!(
            map.meters[0].sample, 0,
            "meter map must start at sample zero"
        );

        validate_tempos(&map.tempos, map.ppq);
        validate_meters(&map.meters, map.ppq);

        let sr = f64::from(map.sample_rate);
        let ppq = f64::from(map.ppq);
        let mut tempos = Vec::with_capacity(map.tempos.len());
        for (i, point) in map.tempos.iter().enumerate() {
            let spq0 = samples_per_quarter(sr, point.bpm_start);
            let omega = map.tempos.get(i + 1).map_or(0.0, |next| {
                let end_bpm = if point.continuing {
                    next.bpm_start
                } else {
                    point.bpm_end
                };
                let spq1 = samples_per_quarter(sr, end_bpm);
                let quarters = (next.tick - point.tick) as f64 / ppq;
                (1.0 / spq1 - 1.0 / spq0) / quarters
            });
            tempos.push(TempoRt {
                tick: point.tick,
                sample: point.sample,
                spq0,
                omega: if omega.abs() <= f64::EPSILON {
                    0.0
                } else {
                    omega
                },
            });
        }

        let meters = map
            .meters
            .iter()
            .map(|point| MeterRt {
                tick: point.tick,
                bar: point.bar,
                divisions_per_bar: point.divisions_per_bar,
                note_value: point.note_value,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();

        Self {
            ppq: map.ppq,
            sr,
            tempos: tempos.into_boxed_slice(),
            meters,
        }
    }

    pub fn ppq(&self) -> u32 {
        self.ppq
    }

    pub fn sample_rate(&self) -> f64 {
        self.sr
    }

    /// Convert a musical tick to its nearest audio sample (cold lookup).
    pub fn sample_at_tick(&self, tick: u64) -> u64 {
        let mut cursor = MetricCursor::default();
        self.sample_at_tick_with_cursor(tick, &mut cursor)
    }

    /// Alias using the domain-first naming used by the time-engine API.
    pub fn sample_at(&self, tick: u64) -> u64 {
        self.sample_at_tick(tick)
    }

    /// Convert an audio sample to its nearest musical tick (cold lookup).
    pub fn tick_at_sample(&self, sample: u64) -> u64 {
        let mut cursor = MetricCursor::default();
        self.tick_at_sample_with_cursor(sample, &mut cursor)
    }

    /// Alias using the domain-first naming used by the time-engine API.
    pub fn tick_at(&self, sample: u64) -> u64 {
        self.tick_at_sample(sample)
    }

    pub fn sample_at_tick_with_cursor(&self, tick: u64, cursor: &mut MetricCursor) -> u64 {
        let i = locate_tempo_tick(&self.tempos, tick, cursor.tempo_i as usize);
        cursor.tempo_i = i as u32;
        sample_in_segment(self.tempos[i], self.ppq, tick)
    }

    pub fn tick_at_sample_with_cursor(&self, sample: u64, cursor: &mut MetricCursor) -> u64 {
        let i = locate_tempo_sample(&self.tempos, sample, cursor.tempo_i as usize);
        cursor.tempo_i = i as u32;
        tick_in_segment(self.tempos[i], self.ppq, sample)
    }

    /// Resolve one-based bar/beat coordinates at an integer musical tick.
    pub fn meter_at_tick(&self, tick: u64) -> MetricPosition {
        let mut cursor = MetricCursor::default();
        self.meter_at_tick_with_cursor(tick, &mut cursor)
    }

    pub fn meter_at_tick_with_cursor(
        &self,
        tick: u64,
        cursor: &mut MetricCursor,
    ) -> MetricPosition {
        let i = locate_meter(&self.meters, tick, cursor.meter_i as usize);
        cursor.meter_i = i as u32;
        meter_position(self.meters[i], self.ppq, tick as f64)
    }

    /// Resolve meter coordinates directly from a sample without quantizing the
    /// intra-beat phase to a whole tick.
    pub fn meter_at_sample_with_cursor(
        &self,
        sample: u64,
        cursor: &mut MetricCursor,
    ) -> MetricPosition {
        let tempo_i = locate_tempo_sample(&self.tempos, sample, cursor.tempo_i as usize);
        cursor.tempo_i = tempo_i as u32;
        let tick = tick_f64_in_segment(self.tempos[tempo_i], self.ppq, sample);
        let meter_i = locate_meter(
            &self.meters,
            saturating_round(tick),
            cursor.meter_i as usize,
        );
        cursor.meter_i = meter_i as u32;
        meter_position(self.meters[meter_i], self.ppq, tick)
    }

    /// Stack-only one-point map lookup used while [`crate::Transport`] still
    /// stores scalar tempo/meter fields during migration wave W1.
    pub(crate) fn one_point_position(
        sample: u64,
        sample_rate: f64,
        bpm: f64,
        divisions_per_bar: u32,
    ) -> MetricPosition {
        let tempo = TempoRt {
            tick: 0,
            sample: 0,
            spq0: sample_rate * 60.0 / bpm,
            omega: 0.0,
        };
        let meter = MeterRt {
            tick: 0,
            bar: 1,
            divisions_per_bar: divisions_per_bar.min(u8::MAX as u32) as u8,
            note_value: 4,
        };
        let tick = tick_f64_in_segment(tempo, ojproto::PPQ, sample);
        meter_position(meter, ojproto::PPQ, tick)
    }
}

fn validate_tempos(points: &[TempoPoint], ppq: u32) {
    for (i, point) in points.iter().enumerate() {
        assert!(point.bpm_start.is_finite() && point.bpm_start > 0.0);
        assert!(point.bpm_end.is_finite() && point.bpm_end > 0.0);
        assert_eq!(
            point.tick % u64::from(ppq),
            0,
            "tempo changes must be on beats"
        );
        if let Some(previous) = i.checked_sub(1).map(|j| points[j]) {
            assert!(point.tick > previous.tick, "tempo ticks must increase");
            assert!(
                point.sample > previous.sample,
                "tempo samples must increase"
            );
        }
    }
}

fn validate_meters(points: &[MeterPoint], ppq: u32) {
    for (i, point) in points.iter().enumerate() {
        assert!(point.bar > 0);
        assert!(point.divisions_per_bar > 0);
        assert!(point.note_value > 0);
        let ticks_per_beat = u64::from(ppq) * 4 / u64::from(point.note_value);
        assert!(ticks_per_beat > 0);
        if let Some(previous) = i.checked_sub(1).map(|j| points[j]) {
            assert!(point.tick > previous.tick, "meter ticks must increase");
            assert!(
                point.sample > previous.sample,
                "meter samples must increase"
            );
            let previous_bar_ticks = u64::from(ppq) * 4 / u64::from(previous.note_value)
                * u64::from(previous.divisions_per_bar);
            assert_eq!(
                (point.tick - previous.tick) % previous_bar_ticks,
                0,
                "meter changes must be on bar boundaries"
            );
        }
    }
}

#[inline]
fn samples_per_quarter(sr: f64, bpm: f32) -> f64 {
    sr * 60.0 / f64::from(bpm)
}

fn locate_tempo_tick(points: &[TempoRt], tick: u64, hint: usize) -> usize {
    locate(points.len(), hint, |i| points[i].tick <= tick)
}

fn locate_tempo_sample(points: &[TempoRt], sample: u64, hint: usize) -> usize {
    locate(points.len(), hint, |i| points[i].sample <= sample)
}

fn locate_meter(points: &[MeterRt], tick: u64, hint: usize) -> usize {
    locate(points.len(), hint, |i| points[i].tick <= tick)
}

fn locate(mut len: usize, hint: usize, before_or_equal: impl Fn(usize) -> bool) -> usize {
    let hint = hint.min(len - 1);
    if before_or_equal(hint) && (hint + 1 == len || !before_or_equal(hint + 1)) {
        return hint;
    }
    let mut base = 0;
    while len > 0 {
        let half = len / 2;
        let mid = base + half;
        if before_or_equal(mid) {
            base = mid + 1;
            len -= half + 1;
        } else {
            len = half;
        }
    }
    base.saturating_sub(1)
}

fn sample_in_segment(segment: TempoRt, ppq: u32, tick: u64) -> u64 {
    let quarters = (tick - segment.tick) as f64 / f64::from(ppq);
    let samples = if segment.omega == 0.0 {
        segment.spq0 * quarters
    } else {
        libm::log1p(segment.spq0 * segment.omega * quarters) / segment.omega
    };
    segment.sample.saturating_add(saturating_round(samples))
}

fn tick_in_segment(segment: TempoRt, ppq: u32, sample: u64) -> u64 {
    saturating_round(tick_f64_in_segment(segment, ppq, sample))
}

fn tick_f64_in_segment(segment: TempoRt, ppq: u32, sample: u64) -> f64 {
    let samples = sample.saturating_sub(segment.sample) as f64;
    let quarters = if segment.omega == 0.0 {
        samples / segment.spq0
    } else {
        (libm::exp(segment.omega * samples) - 1.0) / (segment.spq0 * segment.omega)
    };
    segment.tick as f64 + quarters * f64::from(ppq)
}

fn meter_position(meter: MeterRt, ppq: u32, tick: f64) -> MetricPosition {
    let ticks_per_beat = f64::from(ppq) * 4.0 / f64::from(meter.note_value);
    let beats = (tick - meter.tick as f64).max(0.0) / ticks_per_beat;
    let beat_index = libm::floor(beats);
    let divisions = u64::from(meter.divisions_per_bar.max(1));
    MetricPosition {
        bar: meter
            .bar
            .saturating_add((beat_index as u64 / divisions).min(u64::from(u32::MAX)) as u32),
        beat: (beat_index as u64 % divisions) as u32 + 1,
        phase: (beats - beat_index).clamp(0.0, 0.999_999_9) as f32,
    }
}

fn saturating_round(value: f64) -> u64 {
    if value <= 0.0 {
        0
    } else if value >= u64::MAX as f64 {
        u64::MAX
    } else {
        libm::round(value) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    use proptest::prelude::*;

    fn map(tempos: Vec<TempoPoint>) -> TempoMapRt {
        TempoMapRt::from_wire(&TempoMap {
            ppq: ojproto::PPQ,
            sample_rate: 48_000,
            tempos,
            meters: vec![MeterPoint {
                tick: 0,
                sample: 0,
                bar: 1,
                divisions_per_bar: 4,
                note_value: 4,
            }],
        })
    }

    #[test]
    fn constant_segment_is_exact_at_quarter_boundaries() {
        let rt = map(vec![TempoPoint {
            tick: 0,
            sample: 0,
            bpm_start: 120.0,
            bpm_end: 120.0,
            continuing: false,
        }]);
        assert_eq!(rt.sample_at_tick(960), 24_000);
        assert_eq!(rt.tick_at_sample(24_000), 960);
        assert_eq!(rt.sample_at_tick(3_840), 96_000);
    }

    #[test]
    fn ramped_segment_uses_next_tempo_when_continuing() {
        let rt = map(vec![
            TempoPoint {
                tick: 0,
                sample: 0,
                bpm_start: 120.0,
                bpm_end: 10.0,
                continuing: true,
            },
            TempoPoint {
                tick: 3_840,
                sample: 83_178,
                bpm_start: 180.0,
                bpm_end: 180.0,
                continuing: false,
            },
        ]);
        let halfway = rt.sample_at_tick(1_920);
        assert!(halfway > 40_000 && halfway < 48_000, "{halfway}");
        assert_eq!(rt.sample_at_tick(3_840), 83_178);
    }

    #[test]
    fn tick_sample_round_trip_is_monotonic() {
        let rt = map(vec![
            TempoPoint {
                tick: 0,
                sample: 0,
                bpm_start: 90.0,
                bpm_end: 150.0,
                continuing: false,
            },
            TempoPoint {
                tick: 7_680,
                sample: 215_342,
                bpm_start: 150.0,
                bpm_end: 150.0,
                continuing: false,
            },
        ]);
        let mut previous = 0;
        for tick in 0..12_000 {
            let sample = rt.sample_at_tick(tick);
            assert!(sample >= previous);
            previous = sample;
            assert!(rt.tick_at_sample(sample).abs_diff(tick) <= 1);
        }
    }

    proptest! {
        #[test]
        fn cursor_matches_cold_binary_search(queries in prop::collection::vec(0_u64..20_000, 1..256)) {
            let rt = map(vec![
                TempoPoint { tick: 0, sample: 0, bpm_start: 120.0, bpm_end: 100.0, continuing: false },
                TempoPoint { tick: 3_840, sample: 103_783, bpm_start: 100.0, bpm_end: 160.0, continuing: false },
                TempoPoint { tick: 7_680, sample: 190_258, bpm_start: 160.0, bpm_end: 160.0, continuing: false },
            ]);
            let mut cursor = MetricCursor::default();
            for tick in queries {
                prop_assert_eq!(rt.sample_at_tick_with_cursor(tick, &mut cursor), rt.sample_at_tick(tick));
                let sample = rt.sample_at_tick(tick);
                prop_assert_eq!(rt.tick_at_sample_with_cursor(sample, &mut cursor), rt.tick_at_sample(sample));
                prop_assert_eq!(rt.meter_at_tick_with_cursor(tick, &mut cursor), rt.meter_at_tick(tick));
            }
        }
    }
}
