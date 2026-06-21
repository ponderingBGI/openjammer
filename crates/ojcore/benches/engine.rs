//! Hot-path benchmarks (Track A P1 — perf-regression gate).
//!
//! Measures the two deterministic paths the audio thread's behaviour rests on:
//! `compile` (Kahn topo-sort + routing plan) and `process_block` (the alloc-free
//! render step). Run locally with `cargo bench`; in CI the CodSpeed action runs
//! these under the CPU-simulation instrument (stable to <1% run-to-run) AND the
//! memory instrument (heap allocations) and comments the per-PR delta — so an
//! accidental allocation or an O(n^2) schedule regression is caught in review.
//! This is a WORK-DONE / allocation proxy, NOT a wall-clock latency gate (real
//! <5ms is the founder-hardware loopback harness's job).
//!
//! Coverage is deliberately spread across the engine's cost drivers:
//!   * compile: chain length (10/50/100), wide fan-out, and a diamond join —
//!     the schedule + routing-plan work that scales with nodes and edges.
//!   * process_block: block-size scaling (32..512), heavy fan-in mixing, a
//!     100-deep schedule, and the metering path toggled on (its accumulate cost).
//!
//! All graphs use only Gain + structural nodes so the measurement tracks engine
//! *mechanics* (schedule walk + per-node dispatch + mixing), not DSP kernel cost
//! (the kernels have their own suite in `ojcore-dsp`).

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::{
    compile, register_builtins, BuiltinOpts, Engine, PluginRegistry, GAIN_ID, GRAPH_IN_ID,
    SPEAKER_OUT_ID,
};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};

/// The full built-in registry (gain + structural + effects). Resolving real
/// manifest ids (`GRAPH_IN_ID` / `GAIN_ID` / `SPEAKER_OUT_ID`) keeps the graphs
/// honest; lookup cost is O(1) so registry size never skews `compile`.
fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    register_builtins(&mut reg, BuiltinOpts::full());
    reg
}

fn node(id: u32, manifest: &str, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: manifest.into(),
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

/// A linear chain of `total` nodes: GraphIn -> Gain x(total-2) -> SpeakerOut.
/// `total = 10` reproduces the original `compile_chain_10` / `process_block_64`
/// topology (8 gains) so their CodSpeed history continues unbroken.
fn chain(total: u32, block: u32) -> OjGraph {
    assert!(total >= 2);
    let mut g = OjGraph::empty(48_000, block);
    g.nodes
        .push(node(0, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    let last = total - 1;
    for i in 1..last {
        g.nodes.push(node(i, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    }
    g.nodes
        .push(node(last, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(edge(0, 1));
    for i in 1..last {
        g.edges.push(edge(i, i + 1));
    }
    g
}

/// One source fanned out to `width` parallel gains, all summed back into the
/// master input (the executor's `mix_input` folds every source feeding a port).
/// Stresses the routing plan (many edges on one port) and fan-in mixing.
fn fanout(width: u32, block: u32) -> OjGraph {
    let mut g = OjGraph::empty(48_000, block);
    g.nodes
        .push(node(0, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    let speaker = width + 1;
    for i in 1..=width {
        g.nodes.push(node(i, GAIN_ID, PrimitiveKind::Gain, 1, 1));
        g.edges.push(edge(0, i)); // source -> each parallel gain
        g.edges.push(edge(i, speaker)); // each gain -> master (summed)
    }
    g.nodes.push(node(
        speaker,
        SPEAKER_OUT_ID,
        PrimitiveKind::SpeakerOut,
        1,
        0,
    ));
    g
}

/// GraphIn -> {Gain a, Gain b} -> Gain c (summed) -> SpeakerOut. The classic
/// split-then-join shape that exercises a fan-in on an interior node.
fn diamond(block: u32) -> OjGraph {
    let mut g = OjGraph::empty(48_000, block);
    g.nodes
        .push(node(0, GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(1, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(2, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(3, GAIN_ID, PrimitiveKind::Gain, 1, 1));
    g.nodes
        .push(node(4, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(edge(0, 1));
    g.edges.push(edge(0, 2));
    g.edges.push(edge(1, 3));
    g.edges.push(edge(2, 3)); // join: 1 and 2 both feed 3's port 0 (summed)
    g.edges.push(edge(3, 4));
    g
}

fn bench_compile(c: &mut Criterion) {
    let reg = registry();

    // Original benchmark — name preserved for CodSpeed history.
    let g10 = chain(10, 64);
    c.bench_function("compile_chain_10", |b| {
        b.iter(|| {
            let prog = compile(black_box(&g10), black_box(&reg)).expect("compile");
            black_box(prog);
        })
    });

    for total in [50u32, 100] {
        let g = chain(total, 128);
        c.bench_function(&format!("compile_chain_{total}"), |b| {
            b.iter(|| {
                let prog = compile(black_box(&g), black_box(&reg)).expect("compile");
                black_box(prog);
            })
        });
    }

    let gf = fanout(32, 128);
    c.bench_function("compile_fanout_32", |b| {
        b.iter(|| {
            let prog = compile(black_box(&gf), black_box(&reg)).expect("compile");
            black_box(prog);
        })
    });

    let gd = diamond(128);
    c.bench_function("compile_diamond", |b| {
        b.iter(|| {
            let prog = compile(black_box(&gd), black_box(&reg)).expect("compile");
            black_box(prog);
        })
    });
}

fn engine_for(g: &OjGraph, reg: &PluginRegistry) -> Engine {
    Engine::new(compile(g, reg).expect("compile"))
}

fn bench_process_block(c: &mut Criterion) {
    let reg = registry();

    // Original benchmark — name preserved for CodSpeed history.
    {
        let mut engine = engine_for(&chain(10, 64), &reg);
        let mut out = vec![0.0f32; 64];
        c.bench_function("process_block_64", |b| {
            b.iter(|| engine.process_block(black_box(&mut out), 64))
        });
    }

    // Block-size scaling on the 10-node chain. The graph's block_size must match
    // the render nframes so the pre-allocated scratch is exactly sized.
    for block in [32u32, 128, 256, 512] {
        let nb = block as usize;
        let mut engine = engine_for(&chain(10, block), &reg);
        let mut out = vec![0.0f32; nb];
        c.bench_function(&format!("process_block_{block}"), |b| {
            b.iter(|| engine.process_block(black_box(&mut out), nb))
        });
    }

    // Heavy fan-in: 32 sources summed into the master each block.
    {
        let block = 128usize;
        let mut engine = engine_for(&fanout(32, block as u32), &reg);
        let mut out = vec![0.0f32; block];
        c.bench_function("process_wide_mix_32", |b| {
            b.iter(|| engine.process_block(black_box(&mut out), block))
        });
    }

    // Worst-case schedule length: a 100-deep chain rendered per block.
    {
        let block = 128usize;
        let mut engine = engine_for(&chain(100, block as u32), &reg);
        let mut out = vec![0.0f32; block];
        c.bench_function("process_deep_chain_100", |b| {
            b.iter(|| engine.process_block(black_box(&mut out), block))
        });
    }

    // Metering ON: the same 10-node/64-frame render as `process_block_64`, but
    // with the per-node RMS/peak accumulate path live — the delta is metering's
    // real cost on the hot loop.
    {
        let mut engine = engine_for(&chain(10, 64), &reg);
        engine.set_metering(true);
        let mut out = vec![0.0f32; 64];
        c.bench_function("process_metering_64", |b| {
            b.iter(|| engine.process_block(black_box(&mut out), 64))
        });
    }
}

criterion_group!(benches, bench_compile, bench_process_block);
criterion_main!(benches);
