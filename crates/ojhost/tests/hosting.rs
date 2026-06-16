//! Integration tests for plugin hosting.
//!
//! The no-plugin-safe paths run unconditionally (no real plugin needed). Tests
//! that need an ACTUAL plugin on disk are `#[ignore]`d: this sandbox ships no
//! plugins, and even with a backend feature on there is nothing to open. To run
//! them, build with a backend feature, point `OJHOST_TEST_PLUGIN` at a real
//! plugin file, and pass `--ignored`:
//!
//! ```text
//! OJHOST_TEST_PLUGIN=/path/to/Synth.clap \
//!   cargo test -p ojhost --features clap-host -- --ignored
//! ```

use std::path::PathBuf;

use ojhost::{scan, HostedPlugin, HostingBackend, PluginDescriptor};

/// Scanning a non-existent directory is always safe and empty.
#[test]
fn scan_nonexistent_dir_is_empty() {
    let got = scan(&[PathBuf::from("/definitely/not/a/plugin/dir")]).expect("scan ok");
    assert!(got.is_empty());
}

/// In the scaffold build, scanning even a populated dir finds nothing (no
/// backend). With a backend on, it finds whatever is really there.
#[test]
fn scan_reports_backend_consistent_results() {
    let dirs = [std::env::temp_dir()];
    let got = scan(&dirs).expect("scan ok");
    match HostingBackend::current() {
        HostingBackend::None => assert!(got.is_empty(), "scaffold finds nothing"),
        // A real backend may or may not find plugins in tempdir; just ensure no
        // panic and well-formed descriptors.
        _ => {
            for d in &got {
                assert!(!d.path.is_empty());
            }
        }
    }
}

/// Loading from a fabricated descriptor: in the scaffold this is Unavailable; a
/// real backend would fail to load a non-existent file (not panic).
#[test]
fn load_bogus_descriptor_errors_gracefully() {
    let desc = PluginDescriptor {
        uid: "com.nope.nothing".into(),
        name: "Nothing".into(),
        vendor: "Nobody".into(),
        path: "/no/such/plugin.clap".into(),
        format: ojhost::PluginFormat::Clap,
        is_instrument: false,
        ports: ojhost::PortCounts {
            audio_in: 2,
            audio_out: 2,
        },
        param_count: 0,
        latency_samples: 0,
    };
    let res = HostedPlugin::load(&desc, 48_000.0, 64);
    assert!(res.is_err(), "loading a bogus plugin must error, not panic");
}

/// Load + process a REAL plugin pointed to by `OJHOST_TEST_PLUGIN`. Ignored by
/// default (no plugin in the sandbox); requires a backend feature.
#[test]
#[ignore = "needs a real plugin via OJHOST_TEST_PLUGIN + a backend feature"]
fn load_and_process_real_plugin() {
    let path =
        std::env::var("OJHOST_TEST_PLUGIN").expect("set OJHOST_TEST_PLUGIN to a real plugin file");
    let dir = PathBuf::from(&path)
        .parent()
        .expect("plugin has a parent dir")
        .to_path_buf();

    let found = scan(&[dir]).expect("scan ok");
    let desc = found
        .into_iter()
        .find(|d| d.path == path)
        .expect("scanned the target plugin");

    let plugin = HostedPlugin::load(&desc, 48_000.0, 512).expect("load real plugin");
    // Latency is exposed for PDC; just assert it is queryable.
    let _latency = plugin.latency_samples();

    // Render one silent block through it and ensure no panic.
    let inputs: Vec<Vec<f32>> = vec![vec![0.0; 512]; desc.ports.audio_in as usize];
    let mut outputs: Vec<Vec<f32>> = vec![vec![0.0; 512]; desc.ports.audio_out.max(1) as usize];

    use ojcore::{DspInstance, ProcessCtx};
    let mut node = ojhost::PluginHostNode::new(plugin);
    node.activate(48_000.0, 512);
    let in_refs: Vec<&[f32]> = inputs.iter().map(|c| c.as_slice()).collect();
    let mut out_refs: Vec<&mut [f32]> = outputs.iter_mut().map(|c| c.as_mut_slice()).collect();
    let mut ctx = ProcessCtx {
        inputs: &in_refs,
        outputs: &mut out_refs,
        nframes: 512,
    };
    node.process(&mut ctx);
}
