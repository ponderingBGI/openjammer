#![cfg(feature = "clap-host")]

//! P4 nightly real-world matrix. The test is compiled on every CLAP-host run but
//! performs no I/O unless `OJ_REALWORLD_PLUGINS=1`, keeping default CI hermetic.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ojhost::{HostedEvent, HostedPlugin, PluginDescriptor};
use serde::Deserialize;

const RATE: f32 = 48_000.0;
const BLOCK: usize = 64;
const BLOCKS: usize = 64;

#[derive(Debug, Deserialize)]
struct Matrix {
    schema: u32,
    plugin: Vec<MatrixPlugin>,
}

#[derive(Debug, Deserialize)]
struct MatrixPlugin {
    id: String,
    name: String,
    version: String,
    vendor: String,
    source_license: String,
    binary_license: String,
    kind: String,
    plugin_file: String,
    assertion: String,
    #[serde(default)]
    fingerprint: Vec<f64>,
    #[serde(default = "default_tolerance")]
    tolerance: f64,
}

fn default_tolerance() -> f64 {
    0.0005
}

fn manifest() -> Matrix {
    let text = include_str!("fixtures/realworld-plugins.toml");
    let matrix: Matrix = toml::from_str(text).expect("real-world plugin manifest parses");
    assert_eq!(matrix.schema, 1, "known real-world manifest schema");
    matrix
}

fn cache_root() -> PathBuf {
    std::env::var_os("OJ_PLUGIN_CACHE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .join(".cache/oj-plugins")
        })
}

fn find_named(root: &Path, wanted: &str) -> Option<PathBuf> {
    let mut pending = vec![root.to_owned()];
    while let Some(path) = pending.pop() {
        if path.file_name().is_some_and(|name| name == wanted) {
            return Some(path);
        }
        if let Ok(entries) = std::fs::read_dir(path) {
            pending.extend(entries.flatten().map(|entry| entry.path()));
        }
    }
    None
}

fn descriptor_for(path: &Path, expected_name: &str) -> PluginDescriptor {
    let parent = path.parent().expect("plugin has a parent");
    let descriptors = ojhost::scan(&[parent.to_owned()]).expect("real plugin scan succeeds");
    descriptors
        .into_iter()
        // A single CLAP bundle may expose multiple descriptors. Surge XT, for
        // example, exposes both the synth and its effect under the same path;
        // selecting by path alone can silently choose the effect descriptor.
        .find(|desc| desc.name == expected_name && Path::new(&desc.path) == path)
        .unwrap_or_else(|| {
            panic!(
                "scan did not return {} from {}",
                expected_name,
                path.display()
            )
        })
}

fn seeded_param_ids(desc: &PluginDescriptor) -> Vec<usize> {
    let count = desc.params.len();
    if count == 0 {
        return Vec::new();
    }
    let target = count.min(10);
    let mut state = 0x4f4a_5034_5eed_u64;
    let mut ids = BTreeSet::new();
    while ids.len() < target {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        ids.insert(state as usize % count);
    }
    ids.into_iter().collect()
}

fn configure_seeded_params(plugin: &mut HostedPlugin, desc: &PluginDescriptor) {
    for index in seeded_param_ids(desc) {
        let param = &desc.params[index];
        let unit = ((index * 37 + 11) % 101) as f64 / 100.0;
        let requested = param.min + (param.max - param.min) * unit;
        let text = plugin
            .param_value_to_text(index as u16, requested)
            .unwrap_or_else(|| panic!("{} param {} has no value-to-text", desc.name, param.name));
        let round_tripped = plugin
            .param_text_to_value(index as u16, &text)
            .unwrap_or_else(|| panic!("{} param {} rejected `{text}`", desc.name, param.name));
        assert!(round_tripped.is_finite());
        assert!(round_tripped >= param.min - 1e-9 && round_tripped <= param.max + 1e-9);
        plugin.set_param(index as u16, round_tripped as f32);
    }
}

fn scheduled_render(plugin: &mut HostedPlugin, desc: &PluginDescriptor) -> Vec<f32> {
    let in_channels = usize::from(desc.ports.audio_in);
    let out_channels = usize::from(desc.ports.audio_out.max(1));
    let mut rendered = Vec::with_capacity(BLOCKS * BLOCK * out_channels);
    plugin.activate(RATE, BLOCK);
    plugin.start_processing();
    for block in 0..BLOCKS {
        if desc.is_instrument {
            match block {
                0 | 32 => plugin.queue_event(HostedEvent::NoteOn {
                    at_frame: 0,
                    port: 0,
                    channel: 0,
                    key: if block == 0 { 60 } else { 67 },
                    note_id: block as i32 + 1,
                    velocity: 0.8,
                }),
                24 | 56 => plugin.queue_event(HostedEvent::NoteOff {
                    at_frame: 0,
                    port: 0,
                    channel: 0,
                    key: if block == 24 { 60 } else { 67 },
                    note_id: if block == 24 { 1 } else { 33 },
                    velocity: 0.0,
                }),
                _ => {}
            }
        }
        if block % 6 == 3 {
            if let Some(&index) = seeded_param_ids(desc).get((block / 6) % 10) {
                let param = &desc.params[index];
                let value = param.min + (param.max - param.min) * ((block % 17) as f64 / 16.0);
                plugin.queue_event(HostedEvent::Param {
                    at_frame: 17,
                    id: index as u16,
                    value,
                });
            }
        }
        let inputs: Vec<Vec<f32>> = (0..in_channels)
            .map(|channel| {
                (0..BLOCK)
                    .map(|frame| {
                        let absolute = block * BLOCK + frame;
                        let phase = ((absolute + channel * 43) % 257) as f32 / 128.0 - 1.0;
                        phase * 0.2
                    })
                    .collect()
            })
            .collect();
        let input_refs: Vec<&[f32]> = inputs.iter().map(Vec::as_slice).collect();
        let mut outputs = vec![vec![0.0; BLOCK]; out_channels];
        let mut output_refs: Vec<&mut [f32]> = outputs.iter_mut().map(Vec::as_mut_slice).collect();
        plugin.process(&input_refs, &mut output_refs, BLOCK);
        assert!(
            !plugin.take_output_fault(),
            "{} tripped OutputGuard",
            desc.name
        );
        assert!(outputs.iter().flatten().all(|sample| sample.is_finite()));
        rendered.extend(outputs.into_iter().flatten());
    }
    plugin.stop_processing();
    plugin.deactivate();
    rendered
}

fn rms_windows(samples: &[f32]) -> Vec<f64> {
    let width = (samples.len() / 8).max(1);
    samples
        .chunks(width)
        .take(8)
        .map(|window| {
            (window
                .iter()
                .map(|sample| f64::from(*sample).powi(2))
                .sum::<f64>()
                / window.len() as f64)
                .sqrt()
        })
        .collect()
}

#[test]
fn oss_plugin_matrix_obeys_the_reliability_contract() {
    if std::env::var("OJ_REALWORLD_PLUGINS").as_deref() != Ok("1") {
        eprintln!("real-world matrix skipped (set OJ_REALWORLD_PLUGINS=1)");
        return;
    }
    let cache = cache_root().join("plugins");
    let selected = std::env::var("OJ_PLUGIN_IDS").ok();
    for entry in manifest().plugin {
        if selected
            .as_ref()
            .is_some_and(|ids| !ids.split(',').any(|id| id == entry.id))
        {
            continue;
        }
        let root = cache.join(&entry.id).join(&entry.version);
        let path = find_named(&root, &entry.plugin_file)
            .unwrap_or_else(|| panic!("{} is not fetched under {}", entry.id, root.display()));
        eprintln!(
            "realworld: {} {} by {} (source {}, binary {})",
            entry.name, entry.version, entry.vendor, entry.source_license, entry.binary_license
        );
        let desc = descriptor_for(&path, &entry.name);
        assert_eq!(desc.is_instrument, entry.kind == "synth");
        let mut plugin = HostedPlugin::load(&desc, RATE, BLOCK).expect("instantiate real plugin");
        configure_seeded_params(&mut plugin, &desc);
        let rendered = scheduled_render(&mut plugin, &desc);
        let envelope = rms_windows(&rendered);
        assert!(
            rendered.iter().any(|sample| sample.abs() > 1e-7),
            "{} was silent",
            desc.name
        );
        let saved = plugin.save_state_blob();
        assert!(!saved.bytes.is_empty(), "{} did not save state", desc.name);
        if let Some(param) = desc.params.first() {
            plugin.set_param(0, param.min as f32);
        }
        assert!(
            plugin.restore_state_checked(&saved.bytes),
            "{} rejected its own state",
            desc.name
        );
        assert_eq!(
            plugin.save_state_blob(),
            saved,
            "{} state was not byte-faithful",
            desc.name
        );
        let _latency = plugin.latency_samples();
        let _tail = plugin.tail_samples();
        drop(plugin);

        if entry.assertion == "fingerprint" {
            if entry.fingerprint.is_empty() {
                panic!(
                    "{} fingerprint not calibrated; observed {envelope:?}",
                    entry.id
                );
            }
            assert_eq!(envelope.len(), entry.fingerprint.len());
            for (actual, expected) in envelope.iter().zip(&entry.fingerprint) {
                assert!(
                    (actual - expected).abs() <= entry.tolerance,
                    "{} fingerprint {actual} outside {expected} ± {}",
                    entry.id,
                    entry.tolerance
                );
            }
        } else {
            let mut repeat = HostedPlugin::load(&desc, RATE, BLOCK).expect("repeat instantiate");
            configure_seeded_params(&mut repeat, &desc);
            let repeated = rms_windows(&scheduled_render(&mut repeat, &desc));
            assert!(
                envelope
                    .iter()
                    .zip(repeated)
                    .all(|(a, b)| (a - b).abs() <= 0.002),
                "{} RMS envelope was unstable: {envelope:?}",
                entry.id
            );
        }
    }
}
