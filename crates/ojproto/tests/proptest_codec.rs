//! Property-based codec tests (Track A P0a — the proptest on-ramp).
//!
//! `ParamPatch` is the hand-packed 7-byte frame on the HIGHEST-rate UI->RT path,
//! so its byte codec must be lossless for every possible input — exactly the kind
//! of total, all-inputs property a single example test cannot prove. This is the
//! first proptest in the workspace; the same `proptest` dependency + strategy
//! style will drive the OjGraph/`compile()` generators (acyclic-order validity,
//! cycle rejection, never-panics) that the deterministic-simulation harness reuses.

use ojproto::*;
use proptest::array::uniform7;
use proptest::prelude::*;

fn json_roundtrip<T>(value: &T) -> T
where
    T: serde::Serialize + serde::de::DeserializeOwned,
{
    let json = serde_json::to_vec(value).expect("serialize JSON");
    serde_json::from_slice(&json).expect("deserialize JSON")
}

fn finite_f32() -> impl Strategy<Value = f32> {
    any::<u32>()
        .prop_map(f32::from_bits)
        .prop_filter("JSON only represents finite floats", |value| {
            value.is_finite()
        })
}

fn tempo_point_strategy() -> impl Strategy<Value = TempoPoint> {
    (
        any::<u64>(),
        any::<u64>(),
        finite_f32(),
        finite_f32(),
        any::<bool>(),
    )
        .prop_map(
            |(tick, sample, bpm_start, bpm_end, continuing)| TempoPoint {
                tick,
                sample,
                bpm_start,
                bpm_end,
                continuing,
            },
        )
}

fn meter_point_strategy() -> impl Strategy<Value = MeterPoint> {
    (
        any::<u64>(),
        any::<u64>(),
        any::<u32>(),
        any::<u8>(),
        any::<u8>(),
    )
        .prop_map(
            |(tick, sample, bar, divisions_per_bar, note_value)| MeterPoint {
                tick,
                sample,
                bar,
                divisions_per_bar,
                note_value,
            },
        )
}

fn sched_event_strategy() -> impl Strategy<Value = SchedEvent> {
    (
        any::<u64>(),
        any::<u32>(),
        any::<u8>(),
        any::<u8>(),
        any::<u8>(),
        finite_f32(),
    )
        .prop_map(|(at, node, kind, a, b, value)| SchedEvent {
            at,
            node: NodeIdx(node),
            kind,
            a,
            b,
            value,
        })
}

proptest! {
    /// A constructed `ParamPatch` survives a `to_bytes` -> `from_bytes` round-trip
    /// exactly, for ALL fields — including NaN/denormal `value` payloads, compared
    /// by bit pattern (NaN != NaN under `==`, but the bytes must still be exact).
    #[test]
    fn parampatch_struct_roundtrip(node: u16, param: u8, bits in any::<u32>()) {
        let value = f32::from_bits(bits);
        let p = ParamPatch { node, param, value };
        let back = ParamPatch::from_bytes(p.to_bytes());
        prop_assert_eq!(back.node, p.node);
        prop_assert_eq!(back.param, p.param);
        prop_assert_eq!(back.value.to_bits(), value.to_bits());
    }

    /// Symmetrically, ANY 7 bytes decode and re-encode to the identical 7 bytes —
    /// the frame has no padding or unused bits that could silently drop data.
    #[test]
    fn parampatch_bytes_roundtrip(bytes in uniform7(any::<u8>())) {
        prop_assert_eq!(ParamPatch::from_bytes(bytes).to_bytes(), bytes);
    }

    /// Every time-domain discriminant survives serde JSON unchanged.
    #[test]
    fn time_domain_json_roundtrip(beat in any::<bool>()) {
        let value = if beat { TimeDomain::Beat } else { TimeDomain::Audio };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Domain-tagged positions preserve signed sample/tick values through JSON.
    #[test]
    fn time_pos_json_roundtrip(beat in any::<bool>(), value in any::<i64>()) {
        let value = TimePos {
            domain: if beat { TimeDomain::Beat } else { TimeDomain::Audio },
            value,
        };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Domain-tagged durations preserve signed lengths through JSON.
    #[test]
    fn time_span_json_roundtrip(beat in any::<bool>(), len in any::<i64>()) {
        let value = TimeSpan {
            domain: if beat { TimeDomain::Beat } else { TimeDomain::Audio },
            len,
        };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Tempo points preserve both synchronized coordinates and ramp metadata.
    #[test]
    fn tempo_point_json_roundtrip(value in tempo_point_strategy()) {
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Meter points preserve all three coordinates and the meter signature.
    #[test]
    fn meter_point_json_roundtrip(value in meter_point_strategy()) {
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Complete tempo-map documents preserve their point arrays through JSON.
    #[test]
    fn tempo_map_json_roundtrip(
        ppq in any::<u32>(),
        sample_rate in any::<u32>(),
        tempos in prop::collection::vec(tempo_point_strategy(), 0..5),
        meters in prop::collection::vec(meter_point_strategy(), 0..5),
    ) {
        let value = TempoMap { ppq, sample_rate, tempos, meters };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Compact authored events preserve every kind-specific payload field.
    #[test]
    fn sched_event_json_roundtrip(value in sched_event_strategy()) {
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Timeline documents preserve events, optional ranges, and their end sample.
    #[test]
    fn timeline_json_roundtrip(
        sample_rate in any::<u32>(),
        events in prop::collection::vec(sched_event_strategy(), 0..8),
        loop_range in prop::option::of((any::<u64>(), any::<u64>())),
        punch_range in prop::option::of((any::<u64>(), any::<u64>())),
        end in any::<u64>(),
    ) {
        let value = Timeline { sample_rate, events, loop_range, punch_range, armed_tracks: vec![], count_in_beats: 0, end };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// The additive transport-setting command keeps its numeric flag and boolean.
    #[test]
    fn transport_set_json_roundtrip(flag in any::<u8>(), on in any::<bool>()) {
        let value = RtCommand::TransportSet { flag, on };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    #[test]
    fn capture_mark_json_roundtrip(node in any::<u32>(), kind in any::<u8>(), at_frame in any::<u64>(), payload in any::<u32>()) {
        let value = CaptureMark { node: NodeIdx(node), kind, at_frame, payload };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Timestamped live commands preserve the full command and sample address.
    #[test]
    fn timed_command_json_roundtrip(at in any::<u64>(), flag in any::<u8>(), on in any::<bool>()) {
        let value = TimedCommand {
            at,
            cmd: RtCommand::TransportSet { flag, on },
        };
        prop_assert_eq!(json_roundtrip(&value), value);
    }

    /// Authoritative transport frames preserve position and state fields.
    #[test]
    fn transport_frame_json_roundtrip(
        sample in any::<u64>(),
        tick in any::<u64>(),
        bar in any::<u32>(),
        beat in any::<u16>(),
        phase in finite_f32(),
        motion in any::<u8>(),
        rec in any::<bool>(),
        loop_on in any::<bool>(),
    ) {
        let value = EngineFrame::Transport {
            sample,
            tick,
            bar,
            beat,
            phase,
            motion,
            rec,
            loop_on,
        };
        prop_assert_eq!(json_roundtrip(&value), value);
    }
}
