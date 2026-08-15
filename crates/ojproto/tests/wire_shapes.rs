//! Wire-format guard for the hand-written TypeScript mirror in
//! `packages/oj-protocol-ts`.
//!
//! `packages/oj-protocol-ts/src/index.ts` is a HAND-MAINTAINED mirror of every
//! `ojproto` wire type. Nothing in Rust mechanically derives it, so it can
//! silently drift from `serde`'s actual JSON. This test pins that JSON: it
//! serializes representative values and asserts the EXACT bytes (field names,
//! field order, and — critically — `serde`'s default **externally tagged**
//! enum form). If a future change to `crates/ojproto/src/lib.rs` alters the
//! wire shape (rename a field, reorder, change enum tagging, swap a newtype for
//! a wrapper object, ...), this test fails, signalling that the TS mirror must
//! be updated in lockstep.
//!
//! Observed `serde_json` facts this mirror relies on:
//!   * `NodeIdx(u32)` / `AssetId(u32)` are newtype structs => serialized as a
//!     BARE number (e.g. `"node":3`), never `{"0":3}`.
//!   * field-less / data-carrying enums use serde's default EXTERNAL tagging:
//!       - unit variant         => bare string         `"TransportPlay"`
//!       - struct/tuple variant => `{ "<Variant>": { ..fields.. } }`
//!   * C-like enums (`PrimitiveKind`, `ConnectionType`) => bare string equal to
//!     the Rust variant identifier verbatim (no rename_all), e.g. `"Osc"`,
//!     `"KarplusString"`, `"Audio"`.
//!   * struct fields serialize in declaration order; whole-valued `f32`
//!     round-trips as `440.0` (irrelevant to shape, only to numeric tests).

use ojproto::*;

/// Serialize `v` and assert it equals `expected` byte-for-byte.
fn assert_json<T: serde::Serialize>(v: &T, expected: &str) {
    let got = serde_json::to_string(v).expect("serialize");
    assert_eq!(got, expected, "wire shape drifted from the TS mirror");
}

#[test]
fn primitive_kind_is_bare_variant_string() {
    // Every variant must serialize as its exact Rust identifier. The TS union
    // `PrimitiveKind` lists precisely these strings.
    let all = [
        (PrimitiveKind::Osc, "\"Osc\""),
        (PrimitiveKind::Sampler, "\"Sampler\""),
        (PrimitiveKind::Sf2, "\"Sf2\""),
        (PrimitiveKind::KarplusString, "\"KarplusString\""),
        (PrimitiveKind::Gain, "\"Gain\""),
        (PrimitiveKind::Biquad, "\"Biquad\""),
        (PrimitiveKind::Waveshaper, "\"Waveshaper\""),
        (PrimitiveKind::Delay, "\"Delay\""),
        (PrimitiveKind::Convolution, "\"Convolution\""),
        (PrimitiveKind::Pan, "\"Pan\""),
        (PrimitiveKind::Width, "\"Width\""),
        (PrimitiveKind::FaustHost, "\"FaustHost\""),
        (PrimitiveKind::WasmHost, "\"WasmHost\""),
        (PrimitiveKind::PluginHost, "\"PluginHost\""),
        (PrimitiveKind::Add, "\"Add\""),
        (PrimitiveKind::Subtract, "\"Subtract\""),
        (PrimitiveKind::Multiply, "\"Multiply\""),
        (PrimitiveKind::MicIn, "\"MicIn\""),
        (PrimitiveKind::SpeakerOut, "\"SpeakerOut\""),
        (PrimitiveKind::GraphIn, "\"GraphIn\""),
        (PrimitiveKind::GraphOut, "\"GraphOut\""),
        (PrimitiveKind::Passthrough, "\"Passthrough\""),
        (PrimitiveKind::Looper, "\"Looper\""),
    ];
    for (kind, expected) in all {
        assert_json(&kind, expected);
    }
}

#[test]
fn connection_type_is_bare_variant_string() {
    assert_json(&ConnectionType::Audio, "\"Audio\"");
    assert_json(&ConnectionType::Control, "\"Control\"");
}

#[test]
fn node_idx_and_asset_id_are_bare_numbers() {
    assert_json(&NodeIdx(42), "42");
    assert_json(&AssetId(7), "7");
}

#[test]
fn time_domain_position_and_span_shapes() {
    assert_eq!(PPQ, 960);
    assert_json(&TimeDomain::Audio, "\"Audio\"");
    assert_json(&TimeDomain::Beat, "\"Beat\"");
    assert_json(
        &TimePos {
            domain: TimeDomain::Beat,
            value: -960,
        },
        r#"{"domain":"Beat","value":-960}"#,
    );
    assert_json(
        &TimeSpan {
            domain: TimeDomain::Audio,
            len: 48_000,
        },
        r#"{"domain":"Audio","len":48000}"#,
    );
}

#[test]
fn tempo_and_meter_map_shapes() {
    let tempo = TempoPoint {
        tick: 0,
        sample: 0,
        bpm_start: 120.0,
        bpm_end: 128.0,
        continuing: true,
    };
    assert_json(
        &tempo,
        r#"{"tick":0,"sample":0,"bpm_start":120.0,"bpm_end":128.0,"continuing":true}"#,
    );

    let meter = MeterPoint {
        tick: 0,
        sample: 0,
        bar: 1,
        divisions_per_bar: 4,
        note_value: 4,
    };
    assert_json(
        &meter,
        r#"{"tick":0,"sample":0,"bar":1,"divisions_per_bar":4,"note_value":4}"#,
    );

    assert_json(
        &TempoMap {
            ppq: PPQ,
            sample_rate: 48_000,
            tempos: vec![tempo],
            meters: vec![meter],
        },
        concat!(
            r#"{"ppq":960,"sample_rate":48000,"tempos":[{"tick":0,"sample":0,"#,
            r#""bpm_start":120.0,"bpm_end":128.0,"continuing":true}],"#,
            r#""meters":[{"tick":0,"sample":0,"bar":1,"divisions_per_bar":4,"note_value":4}]}"#,
        ),
    );
}

#[test]
fn param_and_asset_ref_shapes() {
    assert_json(&Param { id: 3, value: 0.5 }, r#"{"id":3,"value":0.5}"#);
    assert_json(
        &AssetRef {
            slot: 1,
            asset: AssetId(9),
        },
        r#"{"slot":1,"asset":9}"#,
    );
}

#[test]
fn ojgraph_with_one_node_and_edge() {
    let graph = OjGraph {
        ir_version: 1,
        sample_rate: 48_000,
        block_size: 128,
        nodes: vec![IrNode {
            id: NodeIdx(0),
            manifest_id: "builtin.osc".into(),
            kind: PrimitiveKind::Osc,
            params: vec![Param {
                id: 0,
                value: 440.0,
            }],
            assets: vec![AssetRef {
                slot: 0,
                asset: AssetId(7),
            }],
            n_in: 0,
            n_out: 1,
        }],
        edges: vec![IrEdge {
            from_node: NodeIdx(0),
            from_port: 0,
            to_node: NodeIdx(1),
            to_port: 0,
            kind: ConnectionType::Audio,
        }],
        schedule: vec![vec![NodeIdx(0)], vec![NodeIdx(1)]],
    };

    let expected = concat!(
        r#"{"ir_version":1,"sample_rate":48000,"block_size":128,"#,
        r#""nodes":[{"id":0,"manifest_id":"builtin.osc","kind":"Osc","#,
        r#""params":[{"id":0,"value":440.0}],"assets":[{"slot":0,"asset":7}],"#,
        r#""n_in":0,"n_out":1}],"#,
        r#""edges":[{"from_node":0,"from_port":0,"to_node":1,"to_port":0,"kind":"Audio"}],"#,
        r#""schedule":[[0],[1]]}"#,
    );
    assert_json(&graph, expected);
}

#[test]
fn empty_graph_shape() {
    // OjGraph::empty stamps the current SCHEMA_VERSION into ir_version.
    let g = OjGraph::empty(44_100, 64);
    assert_eq!(g.ir_version, SCHEMA_VERSION);
    assert_json(
        &g,
        r#"{"ir_version":1,"sample_rate":44100,"block_size":64,"nodes":[],"edges":[],"schedule":[]}"#,
    );
}

#[test]
fn scheduled_event_and_timeline_shapes() {
    let event = SchedEvent {
        at: 24_000,
        node: NodeIdx(3),
        kind: sched_event_kind::NOTE_ON,
        a: 60,
        b: 100,
        value: 0.25,
    };
    assert_json(
        &event,
        r#"{"at":24000,"node":3,"kind":2,"a":60,"b":100,"value":0.25}"#,
    );
    assert_json(
        &Timeline {
            sample_rate: 48_000,
            events: vec![event],
            loop_range: Some((0, 96_000)),
            punch_range: None,
            armed_tracks: vec![],
            count_in_beats: 0,
            end: 192_000,
        },
        concat!(
            r#"{"sample_rate":48000,"events":[{"at":24000,"node":3,"kind":2,"#,
            r#""a":60,"b":100,"value":0.25}],"loop_range":[0,96000],"#,
            r#""punch_range":null,"armed_tracks":[],"count_in_beats":0,"end":192000}"#,
        ),
    );
}

/// Pin scheduled-event kind codes and their same-sample ordering rank.
#[test]
fn scheduled_event_kind_codes() {
    assert_eq!(sched_event_kind::SET_PARAM, 0);
    assert_eq!(sched_event_kind::NOTE_OFF, 1);
    assert_eq!(sched_event_kind::NOTE_ON, 2);
    assert_eq!(sched_event_kind::SAMPLER_START, 3);
}

#[test]
fn rt_command_external_tagging() {
    // Struct variants => { "<Variant>": { ..fields.. } }
    assert_json(
        &RtCommand::SetParam {
            node: NodeIdx(3),
            param: 5,
            value: 0.25,
        },
        r#"{"SetParam":{"node":3,"param":5,"value":0.25}}"#,
    );
    assert_json(
        &RtCommand::NoteOn {
            node: NodeIdx(3),
            note: 60,
            vel: 100,
        },
        r#"{"NoteOn":{"node":3,"note":60,"vel":100}}"#,
    );
    assert_json(
        &RtCommand::NoteOff {
            node: NodeIdx(3),
            note: 60,
        },
        r#"{"NoteOff":{"node":3,"note":60}}"#,
    );
    assert_json(
        &RtCommand::Bypass {
            node: NodeIdx(3),
            on: true,
        },
        r#"{"Bypass":{"node":3,"on":true}}"#,
    );
    // Unit variants => bare string.
    assert_json(&RtCommand::TransportPlay, "\"TransportPlay\"");
    assert_json(&RtCommand::TransportPause, "\"TransportPause\"");
    // Struct variant with a single field is still wrapped.
    assert_json(
        &RtCommand::Seek { samples: 9000 },
        r#"{"Seek":{"samples":9000}}"#,
    );
    assert_json(
        &RtCommand::TransportSet {
            flag: transport_flag::LOOP_ENABLE,
            on: true,
        },
        r#"{"TransportSet":{"flag":0,"on":true}}"#,
    );
    // Looper carries a node + a u8 action (one of `looper_action::*`) + a u32
    // `arg` (layer index / packed flags for the indexed actions, ignored by the
    // transport actions). `action`/`arg` serialize as bare numbers, mirrored on
    // the TS side as `number`.
    assert_json(
        &RtCommand::Looper {
            node: NodeIdx(3),
            action: looper_action::OVERDUB,
            arg: 0,
        },
        r#"{"Looper":{"node":3,"action":5,"arg":0}}"#,
    );
    // Indexed action: SET_MUTE of layer 2 with the mute flag set in `arg`'s high
    // bit — pins both the action code (7) and the MUTE_FLAG packing.
    assert_json(
        &RtCommand::Looper {
            node: NodeIdx(3),
            action: looper_action::SET_MUTE,
            arg: 2 | looper_action::MUTE_FLAG,
        },
        r#"{"Looper":{"node":3,"action":7,"arg":2147483650}}"#,
    );
}

/// Pin the numeric transport-setting codes so the TS mirror cannot drift.
#[test]
fn transport_flag_codes() {
    assert_eq!(transport_flag::LOOP_ENABLE, 0);
    assert_eq!(transport_flag::PUNCH_ENABLE, 1);
    assert_eq!(transport_flag::RECORD_ARM, 2);
    assert_eq!(transport_flag::CLICK, 3);
    assert_eq!(transport_flag::COUNT_IN, 4);
}

#[test]
fn capture_wire_shapes() {
    assert_json(
        &CaptureMark {
            node: NodeIdx(7),
            kind: capture_mark_kind::NOTE_ON,
            at_frame: 123,
            payload: 60 | (100 << 8),
        },
        r#"{"node":7,"kind":6,"at_frame":123,"payload":25660}"#,
    );
    assert_json(
        &CaptureResult {
            take_id: 9,
            segments: vec![CaptureSegment {
                node: NodeIdx(7),
                asset: AssetId(42),
                start_sample: 10,
                frames: 20,
                start_tick: 1,
                length_ticks: 2,
                loop_index: 0,
                xruns: 0,
            }],
            notes: vec![],
            recovered: false,
        },
        r#"{"take_id":9,"segments":[{"node":7,"asset":42,"start_sample":10,"frames":20,"start_tick":1,"length_ticks":2,"loop_index":0,"xruns":0}],"notes":[],"recovered":false}"#,
    );
}

#[test]
fn timed_command_shape() {
    assert_json(
        &TimedCommand {
            at: 24_000,
            cmd: RtCommand::TransportSet {
                flag: transport_flag::CLICK,
                on: false,
            },
        },
        r#"{"at":24000,"cmd":{"TransportSet":{"flag":3,"on":false}}}"#,
    );
}

/// Pin the numeric looper-action codes so the TS mirror's `LooperAction` union
/// can never silently drift from the Rust consts.
#[test]
fn looper_action_codes() {
    assert_eq!(looper_action::ARM, 0);
    assert_eq!(looper_action::RECORD, 1);
    assert_eq!(looper_action::PLAY, 2);
    assert_eq!(looper_action::STOP, 3);
    assert_eq!(looper_action::CLEAR, 4);
    assert_eq!(looper_action::OVERDUB, 5);
    assert_eq!(looper_action::UNDO_LAST, 6);
    assert_eq!(looper_action::SET_MUTE, 7);
    assert_eq!(looper_action::DELETE_LAYER, 8);
    assert_eq!(looper_action::MUTE_FLAG, 0x8000_0000);
}

#[test]
fn engine_frame_external_tagging() {
    assert_json(
        &EngineFrame::EngineState {
            running: true,
            sample_rate: 48_000,
            block_size: 128,
            xruns: 2,
        },
        r#"{"EngineState":{"running":true,"sample_rate":48000,"block_size":128,"xruns":2}}"#,
    );
    assert_json(
        &EngineFrame::Meter {
            node: NodeIdx(3),
            rms: 0.1,
            peak: 0.9,
        },
        r#"{"Meter":{"node":3,"rms":0.1,"peak":0.9}}"#,
    );
    assert_json(
        &EngineFrame::IrAck {
            ir_version: 1,
            ok: true,
        },
        r#"{"IrAck":{"ir_version":1,"ok":true}}"#,
    );
    assert_json(
        &EngineFrame::Beat {
            bar: 2,
            beat: 3,
            phase: 0.5,
        },
        r#"{"Beat":{"bar":2,"beat":3,"phase":0.5}}"#,
    );
    assert_json(
        &EngineFrame::Transport {
            sample: 9_000,
            tick: 360,
            bar: 1,
            beat: 2,
            phase: 0.5,
            motion: 1,
            rec: false,
            loop_on: true,
        },
        concat!(
            r#"{"Transport":{"sample":9000,"tick":360,"bar":1,"beat":2,"#,
            r#""phase":0.5,"motion":1,"rec":false,"loop_on":true}}"#,
        ),
    );
    // Looper telemetry frame: node + state(u8) + pos(u32) + loop_len(u32) + peak(f32).
    // `state` is a bare number (one of `looper_state::*`); mirrored on the TS
    // side by the `LooperState` numeric union.
    assert_json(
        &EngineFrame::Looper {
            node: NodeIdx(3),
            state: looper_state::PLAYING,
            pos: 1024,
            loop_len: 48_000,
            peak: 0.5,
        },
        r#"{"Looper":{"node":3,"state":3,"pos":1024,"loop_len":48000,"peak":0.5}}"#,
    );
    assert_json(
        &EngineFrame::Error {
            code: 42,
            message: "boom".into(),
        },
        r#"{"Error":{"code":42,"message":"boom"}}"#,
    );
}

#[test]
fn event_taxonomy_shapes_match_ts_mirror() {
    assert_json(&Severity::Warn, "\"Warn\"");
    assert_json(&Source::Engine, "\"Engine\"");
    assert_json(&FaultKind::OverBudget, "\"OverBudget\"");
    assert_json(&FaultKind::Crashed, "\"Crashed\"");

    assert_json(&EventKind::Xrun { dropped: 2 }, r#"{"Xrun":{"dropped":2}}"#);
    assert_json(
        &EventKind::NodeFault {
            node: NodeIdx(4),
            fault: FaultKind::NonFinite,
        },
        r#"{"NodeFault":{"node":4,"fault":"NonFinite"}}"#,
    );
    assert_json(
        &EventKind::LooperEdge {
            node: NodeIdx(3),
            from: looper_state::RECORDING,
            to: looper_state::PLAYING,
        },
        r#"{"LooperEdge":{"node":3,"from":2,"to":3}}"#,
    );
    assert_json(&EventKind::RingFull, "\"RingFull\"");
    assert_json(
        &EventKind::Message {
            code: 7,
            text: "hi".into(),
        },
        r#"{"Message":{"code":7,"text":"hi"}}"#,
    );

    assert_json(
        &RtEvent::NodeFault {
            node: NodeIdx(4),
            fault: FaultKind::AutoBypassed,
        },
        r#"{"NodeFault":{"node":4,"fault":"AutoBypassed"}}"#,
    );

    // The RT-safe LooperEdge subset rides the event ring; same external tagging.
    assert_json(
        &RtEvent::LooperEdge {
            node: NodeIdx(3),
            from: looper_state::RECORDING,
            to: looper_state::PLAYING,
        },
        r#"{"LooperEdge":{"node":3,"from":2,"to":3}}"#,
    );

    assert_json(
        &Event {
            v: SCHEMA_VERSION,
            seq: 9,
            severity: Severity::Error,
            kind: EventKind::NodeFault {
                node: NodeIdx(4),
                fault: FaultKind::OverBudget,
            },
            source: Source::Engine,
            ts_us: 123456,
            corr_id: 0,
        },
        r#"{"v":1,"seq":9,"severity":"Error","kind":{"NodeFault":{"node":4,"fault":"OverBudget"}},"source":"Engine","ts_us":123456,"corr_id":0}"#,
    );
}

#[test]
fn round_trips_back_to_rust() {
    // Deserialization must accept the exact same shape we assert above, so the
    // contract is symmetric (the TS side both produces and consumes these).
    let cmd = RtCommand::SetParam {
        node: NodeIdx(3),
        param: 5,
        value: 0.25,
    };
    let json = serde_json::to_string(&cmd).unwrap();
    let back: RtCommand = serde_json::from_str(&json).unwrap();
    assert_eq!(cmd, back);

    let play: RtCommand = serde_json::from_str("\"TransportPlay\"").unwrap();
    assert_eq!(play, RtCommand::TransportPlay);

    let frame = EngineFrame::Error {
        code: 42,
        message: "boom".into(),
    };
    let json = serde_json::to_string(&frame).unwrap();
    let back: EngineFrame = serde_json::from_str(&json).unwrap();
    assert_eq!(frame, back);
}
