//! CodSpeed Ring 1 macro benchmarks over the real scheduled arrangement path.
//!
//! The input is the committed First Light authoring fixture shared with browser
//! journeys. Setup (JSON lowering, graph compile, and timeline publication) is
//! excluded from `render_first_light`, leaving complete scheduled block render
//! throughput. `render_first_light_bounce_wav24` deliberately includes fresh
//! compilation, the same render path, 24-bit quantization, WAV I/O, and durable
//! finalize because that is the user-visible bounce operation.

use std::time::Duration;

use codspeed_criterion_compat::{
    black_box, criterion_group, criterion_main, BatchSize, Criterion, Throughput,
};
use ojcore::{compile, Engine, PluginRegistry, TempoMapRt, TimelineRt};
use ojcore_native::{bounce_to_file, BitDepth, BounceSpec, ExportFormat, TailSpec};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::RtCommand;

#[path = "../../ojcore/benches/support/mod.rs"]
mod fixture;

fn registry() -> PluginRegistry {
    let mut registry = PluginRegistry::new();
    register_all(&mut registry, RegisterOpts::full());
    registry
}

fn prepared_engine(
    graph: &ojproto::OjGraph,
    tempo_map: &ojproto::TempoMap,
    timeline: &ojproto::Timeline,
    registry: &PluginRegistry,
) -> Engine {
    let program = compile(graph, registry).expect("compile First Light");
    let mut engine = Engine::new(program);
    let tempo = TempoMapRt::from_wire(tempo_map);
    engine.install_tempo_map(tempo);
    engine.install_timeline(TimelineRt::from_wire(
        timeline,
        &TempoMapRt::from_wire(tempo_map),
    ));
    engine.apply(RtCommand::TransportPlay);
    engine
}

fn bench_first_light(c: &mut Criterion) {
    let fixture = fixture::first_light();
    assert!(fixture.timeline.events.len() > 1_000);
    let registry = registry();
    let block = fixture.graph.block_size as usize;
    let blocks = fixture.timeline.end.div_ceil(block as u64);
    let mut group = c.benchmark_group("render_first_light");
    group.throughput(Throughput::Elements(blocks));
    group.bench_function("scheduled_blocks", |b| {
        b.iter_batched(
            || {
                prepared_engine(
                    &fixture.graph,
                    &fixture.tempo_map,
                    &fixture.timeline,
                    &registry,
                )
            },
            |mut engine| {
                let mut left = vec![0.0_f32; block];
                let mut right = vec![0.0_f32; block];
                let mut checksum = 0.0_f32;
                for _ in 0..blocks {
                    let mut outs: [&mut [f32]; 2] = [&mut left, &mut right];
                    engine.process_block_into(black_box(&mut outs), block);
                    checksum += left[0] + right[0];
                }
                black_box(checksum)
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
}

fn bench_first_light_bounce(c: &mut Criterion) {
    let fixture = fixture::first_light();
    let block = fixture.graph.block_size as u64;
    let blocks = fixture.timeline.end.div_ceil(block);
    let spec = BounceSpec {
        sample_rate: fixture.graph.sample_rate,
        bit_depth: BitDepth::Pcm24,
        format: ExportFormat::Wav,
        tail: TailSpec::Fixed { seconds: 0.0 },
    };
    let path = std::env::temp_dir().join(format!(
        "openjammer-codspeed-first-light-{}.wav",
        std::process::id()
    ));
    let mut group = c.benchmark_group("render_first_light_bounce_wav24");
    group.throughput(Throughput::Elements(blocks));
    group.bench_function("render_and_encode", |b| {
        b.iter_batched(
            || {
                (
                    fixture.graph.clone(),
                    fixture.timeline.clone(),
                    fixture.tempo_map.clone(),
                )
            },
            |(graph, timeline, tempo_map)| {
                let stats =
                    bounce_to_file(graph, timeline, tempo_map, spec, black_box(&path), |_| {})
                        .expect("First Light WAV24 bounce");
                black_box(stats.frames)
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
    let _ = std::fs::remove_file(path);
}

criterion_group! {
    name = macro_benches;
    config = Criterion::default()
        .sample_size(10)
        .warm_up_time(Duration::from_millis(250))
        .measurement_time(Duration::from_secs(2));
    targets = bench_first_light, bench_first_light_bounce
}
criterion_main!(macro_benches);
