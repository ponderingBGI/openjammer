//! CodSpeed benchmarks for the native plugin-host control plane.
//!
//! These intentionally run in the scaffold backend: no plugin binaries are loaded
//! and no C++/JUCE toolchain is required. They track the hot *control-plane* work
//! that happens around hosted plugins — stable id derivation, manifest creation,
//! registry insertion, scan-cache JSON, and safe empty/missing scans. Real plugin
//! DSP cost is plugin/vendor-specific and belongs in manual founder hardware tests.

use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::PluginRegistry;
use ojhost::{
    hosted_plugin_id, register_scanned, scan, HostedParam, PluginDescriptor, PluginFormat,
    PortCounts, ScanCache,
};
use std::path::PathBuf;

fn desc(index: usize) -> PluginDescriptor {
    PluginDescriptor {
        uid: format!("com.acme.plugin.{index}"),
        name: format!("Acme Plugin {index}"),
        vendor: "Acme".into(),
        path: format!("/plugins/Acme{index}.vst3"),
        format: PluginFormat::Vst3,
        is_instrument: index.is_multiple_of(2),
        ports: PortCounts {
            audio_in: if index.is_multiple_of(2) { 0 } else { 2 },
            audio_out: 2,
        },
        audio_ports: Vec::new(),
        port_configs: Vec::new(),
        note_ports: PortCounts::default(),
        param_count: 16,
        params: (0..16)
            .map(|id| HostedParam {
                id,
                name: format!("param{id}"),
                module: String::new(),
                flags: 0,
                unit: String::new(),
                min: 0.0,
                max: 1.0,
                default: 0.5,
            })
            .collect(),
        latency_samples: 0,
    }
}

fn descriptors(n: usize) -> Vec<PluginDescriptor> {
    (0..n).map(desc).collect()
}

fn bench_identity(c: &mut Criterion) {
    let d = desc(42);
    c.bench_function("hosted_plugin_id", |b| {
        b.iter(|| hosted_plugin_id(black_box(&d)))
    });
}

fn bench_register(c: &mut Criterion) {
    let descs = descriptors(64);
    c.bench_function("register_scanned_64", |b| {
        b.iter(|| {
            let mut registry = PluginRegistry::new();
            register_scanned(black_box(&mut registry), black_box(&descs))
        })
    });
}

fn bench_scan_cache(c: &mut Criterion) {
    let cache = ScanCache {
        descriptors: descriptors(64),
    };
    let json = serde_json::to_string(&cache).expect("cache serializes");
    let mut group = c.benchmark_group("scan_cache");
    group.bench_function("serialize_64", |b| {
        b.iter(|| serde_json::to_string(black_box(&cache)).expect("cache serializes"))
    });
    group.bench_function("deserialize_64", |b| {
        b.iter(|| serde_json::from_str::<ScanCache>(black_box(&json)).expect("cache deserializes"))
    });
    group.finish();
}

fn bench_safe_empty_scan(c: &mut Criterion) {
    let missing = [PathBuf::from("/definitely/not/an/openjammer/plugin/dir")];
    c.bench_function("scan_missing_dir", |b| {
        b.iter(|| scan(black_box(&missing)).expect("missing scan is safe"))
    });
}

criterion_group!(
    benches,
    bench_identity,
    bench_register,
    bench_scan_cache,
    bench_safe_empty_scan
);
criterion_main!(benches);
