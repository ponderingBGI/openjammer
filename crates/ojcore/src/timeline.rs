//! Immutable, real-time-safe compiled timeline snapshots.
//!
//! Authoring resolves musical positions through [`crate::TempoMapRt`] before
//! publication. Consequently the RT form contains only absolute sample frames:
//! no tempo lookup, allocation, or sorting occurs in the process callback.

use alloc::boxed::Box;
use alloc::vec::Vec;

use ojproto::{sched_event_kind, SchedEvent, Timeline};

/// Compiled swap-whole timeline data. The playback cursor is deliberately kept
/// on [`crate::Engine`], because this object may be shared by an RCU reader.
#[derive(Debug)]
pub struct TimelineRt {
    events: Box<[SchedEvent]>,
    loop_range: Option<(u64, u64)>,
    punch_range: Option<(u64, u64)>,
    end: u64,
    sample_rate: u32,
}

impl TimelineRt {
    /// Compile an authored timeline. Events are normalized into the mandated
    /// `(at, kind-rank, node, payload)` order off the audio thread.
    pub fn from_wire(timeline: &Timeline, _tempo: &crate::TempoMapRt) -> Self {
        let mut events: Vec<SchedEvent> = timeline.events.clone();
        events.sort_by(|a, b| {
            (
                a.at,
                kind_rank(a.kind),
                a.node.0,
                a.a,
                a.b,
                a.value.to_bits(),
            )
                .cmp(&(
                    b.at,
                    kind_rank(b.kind),
                    b.node.0,
                    b.a,
                    b.b,
                    b.value.to_bits(),
                ))
        });
        Self {
            events: events.into_boxed_slice(),
            loop_range: valid_range(timeline.loop_range),
            punch_range: valid_range(timeline.punch_range),
            end: timeline.end,
            sample_rate: timeline.sample_rate.max(1),
        }
    }

    /// Empty timeline used before the first publication.
    pub fn empty(sample_rate: u32) -> Self {
        Self {
            events: Box::new([]),
            loop_range: None,
            punch_range: None,
            end: 0,
            sample_rate: sample_rate.max(1),
        }
    }

    pub fn events(&self) -> &[SchedEvent] {
        &self.events
    }

    pub fn loop_range(&self) -> Option<(u64, u64)> {
        self.loop_range
    }

    pub fn punch_range(&self) -> Option<(u64, u64)> {
        self.punch_range
    }

    pub fn end(&self) -> u64 {
        self.end
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// First event at or after `at`, used on install, locate, and loop wrap.
    pub fn seek(&self, at: u64) -> usize {
        self.events.partition_point(|event| event.at < at)
    }
}

fn valid_range(range: Option<(u64, u64)>) -> Option<(u64, u64)> {
    range.filter(|(start, end)| start < end)
}

fn kind_rank(kind: u8) -> u8 {
    match kind {
        sched_event_kind::SET_PARAM => 0,
        sched_event_kind::NOTE_OFF => 1,
        sched_event_kind::NOTE_ON => 2,
        sched_event_kind::SAMPLER_START => 3,
        _ => u8::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::{NodeIdx, Timeline};

    #[test]
    fn compile_sorts_and_seek_is_lower_bound() {
        let wire = Timeline {
            sample_rate: 48_000,
            events: alloc::vec![
                SchedEvent {
                    at: 9,
                    node: NodeIdx(2),
                    kind: sched_event_kind::NOTE_ON,
                    a: 60,
                    b: 90,
                    value: 0.0
                },
                SchedEvent {
                    at: 9,
                    node: NodeIdx(2),
                    kind: sched_event_kind::NOTE_OFF,
                    a: 60,
                    b: 0,
                    value: 0.0
                },
                SchedEvent {
                    at: 3,
                    node: NodeIdx(1),
                    kind: sched_event_kind::SET_PARAM,
                    a: 0,
                    b: 0,
                    value: 1.0
                },
            ],
            loop_range: None,
            punch_range: None,
            end: 10,
        };
        let map = crate::TempoMapRt::one_point(48_000, 120.0, 4, 4);
        let rt = TimelineRt::from_wire(&wire, &map);
        assert_eq!(
            rt.events
                .iter()
                .map(|e| (e.at, e.kind))
                .collect::<alloc::vec::Vec<_>>(),
            alloc::vec![(3, 0), (9, 1), (9, 2)]
        );
        assert_eq!(rt.seek(9), 1);
        assert_eq!(rt.seek(10), 3);
    }
}
