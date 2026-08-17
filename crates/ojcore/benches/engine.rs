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
//!
//! Fast-path regression invariant: these plain, stopped graphs render as one
//! unsplit span with no timeline/tempo/capture/hosted-plugin work. The branch is
//! asserted by `exec::apply_rt_tests::plain_stopped_graph_takes_unsplit_fast_path`.

use std::time::Duration;

use codspeed_criterion_compat::{
    black_box, criterion_group, criterion_main, BatchSize, Criterion, Throughput,
};
use ojcore::{
    compile, register_builtins, BuiltinOpts, Engine, MetricCursor, PluginRegistry, TempoMapRt,
    TimedCommandConsumer, TimedCommandQueue, TimelineRt, GAIN_ID, GRAPH_IN_ID, SPEAKER_OUT_ID,
};
use ojproto::{
    transport_flag, CaptureArm, ConnectionType, IrEdge, IrNode, MeterPoint, NodeIdx, OjGraph,
    PrimitiveKind, RtCommand, TempoMap, TempoPoint, TimedCommand, Timeline,
};

#[path = "support/mod.rs"]
mod fixture;

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

fn bench_timeline_install(c: &mut Criterion) {
    let (tempo, timeline) = fixture::hundred_tracks_timeline();
    assert!(
        timeline.events.len() >= 80_000,
        "stress timeline lost its notes"
    );
    let tempo = TempoMapRt::from_wire(&tempo);
    let reg = registry();
    let graph = chain(2, 64);
    let mut group = c.benchmark_group("timeline_install_hundred_tracks");
    group.throughput(Throughput::Elements(timeline.events.len() as u64));
    group.bench_function("compile_and_install", |b| {
        b.iter_batched(
            || engine_for(&graph, &reg),
            |mut engine| {
                engine.install_timeline(TimelineRt::from_wire(
                    black_box(&timeline),
                    black_box(&tempo),
                ));
                black_box(engine.transport().sample_pos())
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
}

fn ramped_tempo_map() -> TempoMapRt {
    let mut tempos = Vec::with_capacity(64);
    for index in 0..64_u64 {
        let bpm = 72.0 + (index % 9) as f32 * 11.0;
        tempos.push(TempoPoint {
            tick: index * 960,
            sample: index * 24_000,
            bpm_start: bpm,
            bpm_end: 180.0 - (index % 7) as f32 * 9.0,
            continuing: false,
        });
    }
    TempoMapRt::from_wire(&TempoMap {
        ppq: 960,
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

fn bench_tempo_map_lookup(c: &mut Criterion) {
    const LOOKUPS: u64 = 4_000;
    let map = ramped_tempo_map();
    let ticks: Vec<u64> = (0..LOOKUPS).map(|index| index * 15).collect();
    let mut group = c.benchmark_group("tempo_map_lookup_ramped");
    group.throughput(Throughput::Elements(LOOKUPS));
    group.bench_function("hot_cursor", |b| {
        let mut cursor = MetricCursor::default();
        b.iter(|| {
            let mut sum = 0_u64;
            for &tick in &ticks {
                sum = sum.wrapping_add(
                    map.sample_at_tick_with_cursor(black_box(tick), black_box(&mut cursor)),
                );
            }
            black_box(sum)
        })
    });
    group.bench_function("cold", |b| {
        b.iter(|| {
            let mut sum = 0_u64;
            for &tick in &ticks {
                sum = sum.wrapping_add(map.sample_at_tick(black_box(tick)));
            }
            black_box(sum)
        })
    });
    group.finish();
}

fn timed_storm_engine(reg: &PluginRegistry) -> (Engine, TimedCommandConsumer) {
    let mut engine = engine_for(&chain(3, 64), reg);
    let (mut tx, rx) = TimedCommandQueue::split(1_001);
    for index in 0..1_000_u16 {
        tx.push(TimedCommand {
            at: 1,
            cmd: RtCommand::SetParam {
                node: NodeIdx(1),
                param: 0,
                value: f32::from(index) / 1_000.0,
            },
        })
        .expect("timed command ring capacity");
    }
    engine.apply(RtCommand::TransportPlay);
    (engine, rx)
}

fn bench_timed_ring_drain_storm(c: &mut Criterion) {
    let reg = registry();
    let mut group = c.benchmark_group("timed_ring_drain_storm");
    group.throughput(Throughput::Elements(1_000));
    group.bench_function("1k_due_commands_in_block", |b| {
        b.iter_batched(
            || timed_storm_engine(&reg),
            |(mut engine, mut rx)| {
                let mut out = [0.0_f32; 64];
                engine.drain_timed(black_box(&mut rx));
                engine.process_block(black_box(&mut out), 64);
                black_box(out[0])
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
}

fn armed_capture_engine(reg: &PluginRegistry) -> (Engine, ojcore::capture::Capture) {
    let mut engine = engine_for(&chain(2, 256), reg);
    let tempo = TempoMapRt::one_point(48_000, 120.0, 4, 4);
    engine.install_timeline(TimelineRt::from_wire(
        &Timeline {
            sample_rate: 48_000,
            events: vec![],
            loop_range: None,
            punch_range: None,
            armed_tracks: vec![CaptureArm {
                node: NodeIdx(0),
                align: 1,
            }],
            count_in_beats: 0,
            end: 256,
        },
        &tempo,
    ));
    let (capture, sink) = ojcore::capture::Capture::new(512);
    engine.attach_capture_sink(Some(sink));
    engine.apply(RtCommand::TransportSet {
        flag: transport_flag::RECORD_ARM,
        on: true,
    });
    engine.apply(RtCommand::TransportPlay);
    engine.input_mut(NodeIdx(0), 0).expect("graph input")[..256].fill(0.25);
    (engine, capture)
}

fn bench_capture_gate_block(c: &mut Criterion) {
    let reg = registry();
    let mut group = c.benchmark_group("capture_gate_block");
    group.throughput(Throughput::Elements(256));
    group.bench_function("armed_copy_path", |b| {
        b.iter_batched(
            || armed_capture_engine(&reg),
            |(mut engine, capture)| {
                let mut out = [0.0_f32; 256];
                engine.process_block(black_box(&mut out), 256);
                black_box((out[0], capture.accumulated(0)))
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
}

fn bench_macro_paths(c: &mut Criterion) {
    bench_timeline_install(c);
    bench_tempo_map_lookup(c);
    bench_timed_ring_drain_storm(c);
    bench_capture_gate_block(c);
}

criterion_group!(benches, bench_compile, bench_process_block);
criterion_group! {
    name = macro_benches;
    config = Criterion::default()
        .sample_size(10)
        .warm_up_time(Duration::from_millis(250))
        .measurement_time(Duration::from_secs(2));
    targets = bench_macro_paths
}
criterion_main!(benches, macro_benches);
