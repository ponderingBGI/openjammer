//! Hot-path benchmarks (Track A P1 — perf-regression gate).
//!
//! Measures the two deterministic paths the audio thread's behaviour rests on:
//! `compile` (Kahn topo-sort + routing plan) and `process_block` (the alloc-free
//! render step). Run locally with `cargo bench`; in CI the CodSpeed action runs
//! these under instruction-count measurement (stable to <1% run-to-run) and
//! comments the per-PR delta — so an accidental allocation or an O(n^2) schedule
//! regression is caught in review. This is a WORK-DONE proxy, NOT a wall-clock
//! latency gate (real <5ms is the founder-hardware loopback harness's job).

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::{compile, Engine, GainLoader, PluginRegistry, GAIN_ID};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};

fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg
}

fn node(id: u32, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: GAIN_ID.into(),
        kind,
        params: Vec::new(),
        assets: Vec::new(),
        n_in,
        n_out,
    }
}
fn edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

/// A representative chain: GraphIn -> Gain x8 -> SpeakerOut.
fn graph() -> OjGraph {
    let mut g = OjGraph::empty(48_000, 64);
    g.nodes.push(node(0, PrimitiveKind::GraphIn, 0, 1));
    for i in 1..=8 {
        g.nodes.push(node(i, PrimitiveKind::Gain, 1, 1));
    }
    g.nodes.push(node(9, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(edge(0, 1));
    for i in 1..9 {
        g.edges.push(edge(i, i + 1));
    }
    g
}

fn bench_compile(c: &mut Criterion) {
    let reg = registry();
    let g = graph();
    c.bench_function("compile_chain_10", |b| {
        b.iter(|| {
            let prog = compile(black_box(&g), black_box(&reg)).expect("compile");
            black_box(prog);
        })
    });
}

fn bench_process_block(c: &mut Criterion) {
    let reg = registry();
    let g = graph();
    let prog = compile(&g, &reg).expect("compile");
    let mut engine = Engine::new(prog);
    let mut out = vec![0.0f32; 64];
    c.bench_function("process_block_64", |b| {
        b.iter(|| {
            engine.process_block(black_box(&mut out), 64);
        })
    });
}

criterion_group!(benches, bench_compile, bench_process_block);
criterion_main!(benches);
