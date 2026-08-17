#![cfg(feature = "clap-host")]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use ojhost::{HostedEvent, HostedPlugin};

fn probe_binary() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let status = Command::new(env!("CARGO"))
            .current_dir(&workspace)
            .args(["build", "-p", "ojhost-probes"])
            .status()
            .expect("cargo builds CLAP probes");
        assert!(status.success(), "probe build failed");
        let library = workspace
            .join("target/debug")
            .join(if cfg!(target_os = "windows") {
                "ojhost_probes.dll"
            } else if cfg!(target_os = "macos") {
                "libojhost_probes.dylib"
            } else {
                "libojhost_probes.so"
            });
        let dir = std::env::temp_dir().join(format!("ojhost-probes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create probe staging directory");
        let clap = dir.join("openjammer-conformance.clap");
        std::fs::copy(&library, &clap).expect("stage dylib with CLAP extension");
        clap
    })
}

fn process(plugin: &mut HostedPlugin, channels: usize, input_value: f32) -> Vec<Vec<f32>> {
    let inputs = vec![vec![input_value; 64]; channels];
    let input_refs: Vec<&[f32]> = inputs.iter().map(Vec::as_slice).collect();
    let mut outputs = vec![vec![0.0; 64]; channels];
    let mut output_refs: Vec<&mut [f32]> = outputs.iter_mut().map(Vec::as_mut_slice).collect();
    plugin.process(&input_refs, &mut output_refs, 64);
    outputs
}

#[test]
fn all_real_clap_probes_obey_the_host_contract() {
    let clap = probe_binary();
    // SAFETY: the path is the just-built probe library and the exported symbol
    // has the exact test-only ABI declared in ojhost-probes.
    let library = unsafe { libloading::Library::new(clap) }.expect("open probe counter ABI");
    let live: libloading::Symbol<unsafe extern "C" fn() -> usize> =
        unsafe { library.get(b"oj_probe_live_instances") }.expect("probe counter symbol");
    let descriptors = ojhost::scan(&[clap.parent().unwrap().to_owned()]).expect("scan probes");
    assert_eq!(descriptors.len(), 7);

    let by_name = |name: &str| descriptors.iter().find(|d| d.name == name).unwrap();
    assert_eq!(by_name("probe-params-500").param_count, 500);
    assert_eq!(
        by_name("probe-params-500").params[0].module,
        "Conformance/Probe"
    );
    assert_eq!(by_name("probe-params-500").params[0].unit, "dB");
    assert_eq!(by_name("probe-notes").note_ports.audio_in, 1);
    let weird = by_name("probe-ports-weird");
    assert_eq!((weird.ports.audio_in, weird.ports.audio_out), (3, 3));
    assert_eq!(weird.audio_ports.len(), 4);
    assert_eq!(weird.port_configs.len(), 2);

    for descriptor in &descriptors {
        let mut plugin = HostedPlugin::load(descriptor, 48_000.0, 64).expect("instantiate");
        assert_eq!(unsafe { live() }, 1, "exactly one live probe instance");

        // Restore is deliberately performed while inactive. The clack type-state
        // in the backend makes restore-before-activate the only constructible path.
        let initial = plugin.save_state_blob();
        plugin.restore_state(&initial.bytes);
        plugin.activate(48_000.0, 64);

        if descriptor.name == "probe-latency-N" {
            assert_eq!(plugin.latency_samples(), 257);
            let _ = ojhost::take_latency_rescan_request();
            plugin.restore_state(&513u32.to_le_bytes());
            assert!(ojhost::take_latency_rescan_request());
            plugin.deactivate();
            plugin.activate(48_000.0, 64);
            assert_eq!(plugin.latency_samples(), 513);
        }
        if descriptor.name == "probe-tail" {
            assert_eq!(plugin.tail_samples(), Some(48_000));
        }
        if descriptor.name == "probe-state-heavy" {
            assert_eq!(initial.bytes.len(), 1_048_576);
        }
        if descriptor.name == "probe-params-500" {
            plugin.restore_state(b"params-list-change");
            assert!(plugin.take_descriptor_rescan_request());
        }

        let text = plugin.param_value_to_text(0, 1.25).expect("value-to-text");
        assert_eq!(plugin.param_text_to_value(0, &text), Some(1.25));

        plugin.start_processing();
        if descriptor.name == "probe-gain" {
            plugin.queue_event(HostedEvent::Param {
                at_frame: 32,
                id: 0,
                value: 0.5,
            });
            let output = process(&mut plugin, 2, 1.0);
            assert!(output
                .iter()
                .all(|channel| channel[..32].iter().all(|&v| v == 1.0)));
            assert!(output
                .iter()
                .all(|channel| channel[32..].iter().all(|&v| v == 0.5)));
            let fingerprint =
                output
                    .iter()
                    .flatten()
                    .fold(0xcbf2_9ce4_8422_2325u64, |hash, sample| {
                        (hash ^ u64::from(sample.to_bits())).wrapping_mul(0x0000_0100_0000_01b3)
                    });
            assert_eq!(fingerprint, 0x0008_61e9_077c_ed25);
        } else if descriptor.name == "probe-params-500" {
            plugin.queue_event(HostedEvent::Param {
                at_frame: 7,
                id: 499,
                value: 1.5,
            });
            let _ = process(&mut plugin, 2, 0.25);
            let gestures = plugin.take_param_gestures();
            assert_eq!(gestures.len(), 3, "begin/adjust/end transaction");
        } else if descriptor.name == "probe-notes" {
            plugin.queue_event(HostedEvent::NoteOn {
                at_frame: 8,
                port: 0,
                channel: 0,
                key: 60,
                note_id: 42,
                velocity: 1.0,
            });
            plugin.queue_event(HostedEvent::NoteChoke {
                at_frame: 40,
                port: 0,
                channel: 0,
                key: 60,
                note_id: 42,
            });
            let output = process(&mut plugin, 2, 0.0);
            assert!(output[0][..8].iter().all(|&v| v == 0.0));
            assert!(output[0][8..40].iter().all(|&v| v == 0.25));
            assert!(output[0][40..].iter().all(|&v| v == 0.0));
            assert!(matches!(
                plugin.take_output_events().as_slice(),
                [HostedEvent::NoteEnd {
                    note_id: 42,
                    at_frame: 40,
                    ..
                }]
            ));
        } else {
            let channels = usize::from(descriptor.ports.audio_out.max(1));
            let _ = process(&mut plugin, channels, 0.25);
        }
        plugin.stop_processing();

        let saved = plugin.save_state_blob();
        plugin.restore_state(b"mutated");
        plugin.restore_state(&saved.bytes);
        assert_eq!(
            plugin.save_state_blob(),
            saved,
            "byte-faithful state round trip"
        );
        plugin.deactivate();
        drop(plugin); // destruction is explicit and must not leak clack's instance Arc.
        assert_eq!(unsafe { live() }, 0, "probe instance fully destroyed");
    }
}
