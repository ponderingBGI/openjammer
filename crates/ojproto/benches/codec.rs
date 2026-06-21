//! Control-plane serialization benchmarks (Track A P1 — perf-regression gate).
//!
//! Nothing here touches audio samples (that boundary is sacred — see the crate
//! docs); this is the UI->engine wire path. Three frequencies of traffic:
//!   * `ojgraph/*` — the whole graph, (re)serialized on every edit and pushed to
//!     the engine (emit -> JSON -> load). Cost scales with node + edge count.
//!   * `parampatch/*` — the hand-packed 7-byte frame for the highest-rate param
//!     stream (a knob being swept); pack/unpack must stay trivially cheap.
//!   * `rtcommand/*` — the per-note/-param JSON control message.
//!
//! Run locally with `cargo bench`; CI measures instruction count + allocations.

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojproto::{
    ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, ParamPatch, PrimitiveKind, RtCommand,
};

/// A ~30-node patch: GraphIn -> 28 mixed effects (each with a couple of params)
/// -> SpeakerOut, chained. Representative of a busy session graph.
fn graph_30() -> OjGraph {
    let mut g = OjGraph::empty(48_000, 512);
    let kinds = [
        ("builtin.gain", PrimitiveKind::Gain),
        ("builtin.biquad", PrimitiveKind::Biquad),
        ("builtin.delay", PrimitiveKind::Delay),
        ("builtin.waveshaper", PrimitiveKind::Waveshaper),
    ];

    g.nodes.push(IrNode {
        id: NodeIdx(0),
        manifest_id: "host.graph_in".into(),
        kind: PrimitiveKind::GraphIn,
        params: Vec::new(),
        assets: Vec::new(),
        n_in: 0,
        n_out: 1,
    });

    let interior = 28u32;
    for i in 1..=interior {
        let (manifest, kind) = kinds[(i as usize) % kinds.len()];
        g.nodes.push(IrNode {
            id: NodeIdx(i),
            manifest_id: manifest.into(),
            kind,
            params: vec![
                Param { id: 0, value: 0.5 },
                Param {
                    id: 1,
                    value: 1_000.0,
                },
            ],
            assets: Vec::new(),
            n_in: 1,
            n_out: 1,
        });
    }

    let speaker = interior + 1;
    g.nodes.push(IrNode {
        id: NodeIdx(speaker),
        manifest_id: "host.speaker_out".into(),
        kind: PrimitiveKind::SpeakerOut,
        params: Vec::new(),
        assets: Vec::new(),
        n_in: 1,
        n_out: 0,
    });

    for from in 0..=interior {
        g.edges.push(IrEdge {
            from_node: NodeIdx(from),
            from_port: 0,
            to_node: NodeIdx(from + 1),
            to_port: 0,
            kind: ConnectionType::Audio,
        });
    }
    g
}

fn bench_ojgraph(c: &mut Criterion) {
    let g = graph_30();
    let bytes = serde_json::to_vec(&g).expect("serialize");
    let mut group = c.benchmark_group("ojgraph");

    group.bench_function("serialize", |b| {
        b.iter(|| black_box(serde_json::to_vec(black_box(&g)).expect("serialize")))
    });

    group.bench_function("deserialize", |b| {
        b.iter(|| {
            let g2: OjGraph = serde_json::from_slice(black_box(&bytes)).expect("deserialize");
            black_box(g2)
        })
    });

    group.bench_function("roundtrip", |b| {
        b.iter(|| {
            let v = serde_json::to_vec(black_box(&g)).expect("serialize");
            let g2: OjGraph = serde_json::from_slice(&v).expect("deserialize");
            black_box(g2)
        })
    });

    group.finish();
}

fn bench_parampatch(c: &mut Criterion) {
    let p = ParamPatch {
        node: 7,
        param: 3,
        value: 0.42,
    };
    let bytes = p.to_bytes();
    let mut group = c.benchmark_group("parampatch");

    group.bench_function("to_bytes", |b| {
        b.iter(|| black_box(black_box(p).to_bytes()))
    });

    group.bench_function("from_bytes", |b| {
        b.iter(|| black_box(ParamPatch::from_bytes(black_box(bytes))))
    });

    group.finish();
}

fn bench_rtcommand(c: &mut Criterion) {
    let cmd = RtCommand::NoteOn {
        node: NodeIdx(3),
        note: 60,
        vel: 100,
    };
    let bytes = serde_json::to_vec(&cmd).expect("serialize");
    let mut group = c.benchmark_group("rtcommand");

    group.bench_function("serialize_noteon", |b| {
        b.iter(|| black_box(serde_json::to_vec(black_box(&cmd)).expect("serialize")))
    });

    group.bench_function("deserialize", |b| {
        b.iter(|| {
            let c2: RtCommand = serde_json::from_slice(black_box(&bytes)).expect("deserialize");
            black_box(c2)
        })
    });

    group.finish();
}

criterion_group!(benches, bench_ojgraph, bench_parampatch, bench_rtcommand);
criterion_main!(benches);
