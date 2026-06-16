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
        (PrimitiveKind::FaustHost, "\"FaustHost\""),
        (PrimitiveKind::WasmHost, "\"WasmHost\""),
        (PrimitiveKind::PluginHost, "\"PluginHost\""),
        (PrimitiveKind::Add, "\"Add\""),
        (PrimitiveKind::MicIn, "\"MicIn\""),
        (PrimitiveKind::SpeakerOut, "\"SpeakerOut\""),
        (PrimitiveKind::GraphIn, "\"GraphIn\""),
        (PrimitiveKind::GraphOut, "\"GraphOut\""),
        (PrimitiveKind::Passthrough, "\"Passthrough\""),
        (PrimitiveKind::Looper, "\"Looper\""),
        (PrimitiveKind::Recorder, "\"Recorder\""),
    ];
    for (kind, expected) in all {
        assert_json(&kind, expected);
    }
}

/// Compile-time tripwire: a new `PrimitiveKind` variant breaks this match (it has
/// no wildcard arm), forcing the `VARIANTS` list below — and, in lockstep,
/// `schemas/primitive-kinds.json`, the TS `PRIMITIVE_KINDS` tuple, and the
/// `kind` enum in `schemas/oj-plugin-v1.json` — to be updated together (D1).
#[allow(dead_code)]
fn primitive_kind_exhaustiveness(k: PrimitiveKind) {
    match k {
        PrimitiveKind::Osc
        | PrimitiveKind::Sampler
        | PrimitiveKind::Sf2
        | PrimitiveKind::KarplusString
        | PrimitiveKind::Gain
        | PrimitiveKind::Biquad
        | PrimitiveKind::Waveshaper
        | PrimitiveKind::Delay
        | PrimitiveKind::Convolution
        | PrimitiveKind::FaustHost
        | PrimitiveKind::WasmHost
        | PrimitiveKind::PluginHost
        | PrimitiveKind::Add
        | PrimitiveKind::MicIn
        | PrimitiveKind::SpeakerOut
        | PrimitiveKind::GraphIn
        | PrimitiveKind::GraphOut
        | PrimitiveKind::Passthrough
        | PrimitiveKind::Looper
        | PrimitiveKind::Recorder => {}
    }
}

/// The Rust leg of the D1 `ssot-set-equality` gate: the set of `PrimitiveKind`
/// variant names MUST equal the canonical flat list in
/// `schemas/primitive-kinds.json`. Drift in either direction fails here. (The TS
/// `PRIMITIVE_KINDS` + schema `kind` enum are pinned to the same list by
/// `src/engine/__tests__/primitive-kinds-parity.test.ts`, so all four agree.)
#[test]
fn primitive_kind_matches_ssot_list() {
    const VARIANTS: [PrimitiveKind; 20] = [
        PrimitiveKind::Osc,
        PrimitiveKind::Sampler,
        PrimitiveKind::Sf2,
        PrimitiveKind::KarplusString,
        PrimitiveKind::Gain,
        PrimitiveKind::Biquad,
        PrimitiveKind::Waveshaper,
        PrimitiveKind::Delay,
        PrimitiveKind::Convolution,
        PrimitiveKind::FaustHost,
        PrimitiveKind::WasmHost,
        PrimitiveKind::PluginHost,
        PrimitiveKind::Add,
        PrimitiveKind::MicIn,
        PrimitiveKind::SpeakerOut,
        PrimitiveKind::GraphIn,
        PrimitiveKind::GraphOut,
        PrimitiveKind::Passthrough,
        PrimitiveKind::Looper,
        PrimitiveKind::Recorder,
    ];

    let ssot: serde_json::Value =
        serde_json::from_str(include_str!("../../../schemas/primitive-kinds.json"))
            .expect("schemas/primitive-kinds.json parses");
    let listed: std::collections::BTreeSet<String> = ssot["kinds"]
        .as_array()
        .expect("`kinds` is a JSON array")
        .iter()
        .map(|v| v.as_str().expect("each kind is a string").to_string())
        .collect();

    let actual: std::collections::BTreeSet<String> = VARIANTS
        .iter()
        .map(|k| {
            serde_json::to_value(k)
                .expect("serialize")
                .as_str()
                .expect("PrimitiveKind serializes to a bare string")
                .to_string()
        })
        .collect();

    assert_eq!(
        actual, listed,
        "PrimitiveKind enum drifted from schemas/primitive-kinds.json"
    );
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
    // Looper carries a node + a u8 action (one of `looper_action::*`); `action`
    // serializes as a bare number, mirrored on the TS side as `number`.
    assert_json(
        &RtCommand::Looper {
            node: NodeIdx(3),
            action: looper_action::OVERDUB,
        },
        r#"{"Looper":{"node":3,"action":5}}"#,
    );
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
        &EngineFrame::Error {
            code: 42,
            message: "boom".into(),
        },
        r#"{"Error":{"code":42,"message":"boom"}}"#,
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

#[test]
fn severity_is_bare_variant_string() {
    // Parallels `primitive_kind_is_bare_variant_string` — enumerate ALL.
    let all = [
        (Severity::Trace, "\"Trace\""),
        (Severity::Debug, "\"Debug\""),
        (Severity::Info, "\"Info\""),
        (Severity::Warn, "\"Warn\""),
        (Severity::Error, "\"Error\""),
    ];
    for (s, expected) in all {
        assert_json(&s, expected);
    }
}

#[test]
fn source_is_bare_variant_string() {
    let all = [
        (Source::Engine, "\"Engine\""),
        (Source::Wasm, "\"Wasm\""),
        (Source::Ui, "\"Ui\""),
        (Source::Native, "\"Native\""),
    ];
    for (s, expected) in all {
        assert_json(&s, expected);
    }
}

#[test]
fn fault_kind_is_bare_variant_string() {
    let all = [
        (FaultKind::NonFinite, "\"NonFinite\""),
        (FaultKind::OverBudget, "\"OverBudget\""),
        (FaultKind::AutoBypassed, "\"AutoBypassed\""),
    ];
    for (f, expected) in all {
        assert_json(&f, expected);
    }
}

#[test]
fn event_kind_external_tagging() {
    // Parallels `engine_frame_external_tagging`. Assert EVERY variant.
    assert_json(&EventKind::Lifecycle, "\"Lifecycle\"");
    assert_json(&EventKind::GraphSwap, "\"GraphSwap\"");
    assert_json(&EventKind::Xrun { dropped: 3 }, r#"{"Xrun":{"dropped":3}}"#);
    assert_json(
        &EventKind::NodeFault {
            node: NodeIdx(3),
            fault: FaultKind::NonFinite,
        },
        r#"{"NodeFault":{"node":3,"fault":"NonFinite"}}"#,
    );
    assert_json(&EventKind::RingFull, "\"RingFull\"");
    assert_json(&EventKind::Asset, "\"Asset\"");
    assert_json(&EventKind::Plugin, "\"Plugin\"");
    assert_json(&EventKind::Midi, "\"Midi\"");
    assert_json(&EventKind::Collab, "\"Collab\"");
    assert_json(
        &EventKind::Message {
            code: 42,
            text: "boom".into(),
        },
        r#"{"Message":{"code":42,"text":"boom"}}"#,
    );
}

#[test]
fn rt_event_external_tagging() {
    assert_json(&RtEvent::Xrun { dropped: 5 }, r#"{"Xrun":{"dropped":5}}"#);
    assert_json(
        &RtEvent::NodeFault {
            node: NodeIdx(3),
            fault: FaultKind::OverBudget,
        },
        r#"{"NodeFault":{"node":3,"fault":"OverBudget"}}"#,
    );
    assert_json(&RtEvent::RingFull, "\"RingFull\"");
}

#[test]
fn event_struct_shape() {
    // The off-RT Event ENVELOPE: a plain struct -> object with fields in
    // declaration order. The oj-protocol-ts `Event` interface mirrors this exactly.
    let ev = Event {
        v: SCHEMA_VERSION,
        seq: 12,
        severity: Severity::Warn,
        kind: EventKind::NodeFault {
            node: NodeIdx(3),
            fault: FaultKind::OverBudget,
        },
        source: Source::Engine,
        ts_us: 123456,
        corr_id: 0,
    };
    let expected = r#"{"v":1,"seq":12,"severity":"Warn","kind":{"NodeFault":{"node":3,"fault":"OverBudget"}},"source":"Engine","ts_us":123456,"corr_id":0}"#;
    assert_json(&ev, expected);
}
