//! CodSpeed benchmarks for the native plugin-host control plane.
//!
//! The original scaffold control-plane ring remains available without features.
//! With `--features clap-host`, four hermetic CLAP probe benches add the P4 host
//! ring: parameter flush, event translation, 1 MiB state, and full lifecycle.

#[cfg(feature = "clap-host")]
use codspeed_criterion_compat::BatchSize;
use codspeed_criterion_compat::{black_box, criterion_group, criterion_main, Criterion};
use ojcore::PluginRegistry;
use ojhost::{
    hosted_plugin_id, register_scanned, scan, HostedParam, PluginDescriptor, PluginFormat,
    PortCounts, ScanCache,
};
use std::path::PathBuf;
#[cfg(feature = "clap-host")]
use std::{path::Path, process::Command, sync::OnceLock};

#[cfg(feature = "clap-host")]
fn probe_binary() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        assert!(Command::new(env!("CARGO"))
            .current_dir(&workspace)
            .args(["build", "-p", "ojhost-probes", "--release"])
            .status()
            .expect("cargo builds benchmark probes")
            .success());
        let dylib = workspace.join("target/release").join(if cfg!(windows) {
            "ojhost_probes.dll"
        } else if cfg!(target_os = "macos") {
            "libojhost_probes.dylib"
        } else {
            "libojhost_probes.so"
        });
        let dir = std::env::temp_dir().join(format!("ojhost-bench-probes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create probe bench staging dir");
        let clap = dir.join("openjammer-bench.clap");
        std::fs::copy(dylib, &clap).expect("stage benchmark CLAP");
        clap
    })
}

#[cfg(feature = "clap-host")]
fn probe(name: &str) -> PluginDescriptor {
    ojhost::probe_candidate(probe_binary())
        .expect("probe benchmark CLAP")
        .into_iter()
        .find(|descriptor| descriptor.name == name)
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn desc(index: usize) -> PluginDescriptor {
    PluginDescriptor {
        uid: format!("com.acme.plugin.{index}"),
        name: format!("Acme Plugin {index}"),
        vendor: "Acme".into(),
        path: format!("/plugins/Acme{index}.vst3"),
        format: PluginFormat::Vst3,
        is_instrument: index.is_multiple_of(2),
        features: Vec::new(),
        has_gui: false,
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
    // Descriptor v2 carries CLAP feature/UI/bus/config/note-port metadata and
    // richer parameter module/unit/flags. That is materially more data than the
    // historical workload, so keep it under a versioned CodSpeed identity rather
    // than comparing its required storage/cloning cost to the smaller v1 schema.
    c.bench_function("register_scanned_64_descriptor_v2", |b| {
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
    // The serialized schema grew with the same descriptor-v2 fields described
    // above. Version the group once so serialize and deserialize both establish
    // honest like-for-like baselines; neither benchmark is removed or detuned.
    let mut group = c.benchmark_group("scan_cache_descriptor_v2");
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

fn bench_param_flush_500(c: &mut Criterion) {
    #[cfg(not(feature = "clap-host"))]
    let _ = c;
    #[cfg(feature = "clap-host")]
    {
        let descriptor = probe("probe-params-500");
        c.bench_function("param_flush_500", |b| {
            b.iter_batched(
                || {
                    ojhost::HostedPlugin::load(&descriptor, 48_000.0, 64)
                        .expect("load params probe")
                },
                |mut plugin| {
                    for id in 0..500 {
                        plugin.set_param(id, black_box((id % 101) as f32 / 100.0));
                    }
                },
                BatchSize::SmallInput,
            )
        });
    }
}

fn bench_event_translate_flood(c: &mut Criterion) {
    #[cfg(not(feature = "clap-host"))]
    let _ = c;
    #[cfg(feature = "clap-host")]
    {
        let descriptor = probe("probe-gain");
        c.bench_function("event_translate_flood_10k", |b| {
            b.iter_batched(
                || ojhost::HostedPlugin::load(&descriptor, 48_000.0, 64).expect("load gain probe"),
                |mut plugin| {
                    for index in 0..10_000 {
                        plugin.queue_event(ojhost::HostedEvent::Param {
                            at_frame: (index % 64) as u32,
                            id: 0,
                            value: black_box((index % 100) as f64 / 100.0),
                        });
                    }
                },
                BatchSize::SmallInput,
            )
        });
    }
}

fn bench_state_roundtrip_1mb(c: &mut Criterion) {
    #[cfg(not(feature = "clap-host"))]
    let _ = c;
    #[cfg(feature = "clap-host")]
    {
        let descriptor = probe("probe-state-heavy");
        let mut plugin =
            ojhost::HostedPlugin::load(&descriptor, 48_000.0, 64).expect("load state probe");
        let state = plugin.save_state_blob();
        assert_eq!(state.bytes.len(), 1_048_576);
        c.bench_function("state_roundtrip_1mb", |b| {
            b.iter(|| {
                plugin.restore_state(black_box(&state.bytes));
                black_box(plugin.save_state_blob())
            })
        });
    }
}

fn bench_conformance_lifecycle(c: &mut Criterion) {
    #[cfg(not(feature = "clap-host"))]
    let _ = c;
    #[cfg(feature = "clap-host")]
    {
        let descriptor = probe("probe-gain");
        c.bench_function("conformance_lifecycle", |b| {
            b.iter(|| {
                let mut plugin = ojhost::HostedPlugin::load(black_box(&descriptor), 48_000.0, 64)
                    .expect("instantiate probe-gain");
                plugin.activate(48_000.0, 64);
                plugin.start_processing();
                let input = [0.25f32; 64];
                let mut output = [0.0f32; 64];
                plugin.process(&[&input], &mut [&mut output], 64);
                plugin.stop_processing();
                plugin.deactivate();
                black_box(output)
            })
        });
    }
}

criterion_group!(
    benches,
    bench_identity,
    bench_register,
    bench_scan_cache,
    bench_safe_empty_scan,
    bench_param_flush_500,
    bench_event_translate_flood,
    bench_state_roundtrip_1mb,
    bench_conformance_lifecycle
);
criterion_main!(benches);
