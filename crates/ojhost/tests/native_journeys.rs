#![cfg(feature = "clap-host")]

//! Engine-facing evidence used by the Linux N4/N5 native journey wrapper.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use ojhost::{HostedEvent, HostedPlugin, PluginDescriptor};

fn probe_binary() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        assert!(Command::new(env!("CARGO"))
            .current_dir(&workspace)
            .args(["build", "-p", "ojhost-probes"])
            .status()
            .expect("cargo builds N4 probe")
            .success());
        let dylib = workspace.join("target/debug").join(if cfg!(windows) {
            "ojhost_probes.dll"
        } else if cfg!(target_os = "macos") {
            "libojhost_probes.dylib"
        } else {
            "libojhost_probes.so"
        });
        let dir = std::env::temp_dir().join(format!("openjammer-n4-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create N4 staging dir");
        let clap = dir.join("openjammer-n4.clap");
        std::fs::copy(dylib, &clap).expect("stage N4 probe");
        clap
    })
}

fn n4_descriptor() -> PluginDescriptor {
    if let Some(path) = std::env::var_os("OJ_N4_PLUGIN").map(PathBuf::from) {
        let parent = path.parent().expect("real N4 plugin has a parent");
        return ojhost::scan(&[parent.to_owned()])
            .expect("scan real N4 synth")
            .into_iter()
            .find(|descriptor| descriptor.is_instrument && Path::new(&descriptor.path) == path)
            .expect("OJ_N4_PLUGIN names a scanned instrument");
    }
    ojhost::probe_candidate(probe_binary())
        .expect("scan N4 probes")
        .into_iter()
        .find(|descriptor| descriptor.name == "probe-notes")
        .expect("probe-notes exists")
}

fn write_float_wav(path: &Path, samples: &[f32], channels: u16) {
    let mut bytes = Vec::with_capacity(44 + samples.len() * 4);
    let data_len = (samples.len() * 4) as u32;
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&3u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&48_000u32.to_le_bytes());
    bytes.extend_from_slice(&(48_000 * u32::from(channels) * 4).to_le_bytes());
    bytes.extend_from_slice(&(channels * 4).to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(path, bytes).expect("write N4 export");
}

#[test]
fn n4_timeline_synth_automation_state_reload_and_export() {
    let descriptor = n4_descriptor();
    // `probe-notes` deliberately advertises note input without the optional
    // CLAP instrument feature tag; a real OJ_N4_PLUGIN is required to be tagged.
    if std::env::var_os("OJ_N4_PLUGIN").is_some() {
        assert!(descriptor.is_instrument, "real N4 plugin must be a synth");
    }
    let channels = usize::from(descriptor.ports.audio_out.max(1));
    let mut plugin = HostedPlugin::load(&descriptor, 48_000.0, 64).expect("insert synth on track");
    plugin.activate(48_000.0, 64);
    plugin.start_processing();
    let mut rendered = Vec::new();
    for block in 0..128 {
        if block % 32 == 0 {
            plugin.queue_event(HostedEvent::NoteOn {
                at_frame: 0,
                port: 0,
                channel: 0,
                key: 60 + (block / 32) as i16,
                note_id: block,
                velocity: 0.8,
            });
        }
        if block % 32 == 24 {
            plugin.queue_event(HostedEvent::NoteOff {
                at_frame: 0,
                port: 0,
                channel: 0,
                key: 60 + (block / 32) as i16,
                note_id: block - 24,
                velocity: 0.0,
            });
        }
        if block == 16 && !descriptor.params.is_empty() {
            let param = &descriptor.params[0];
            let wanted = param.min + (param.max - param.min) * 0.61;
            let text = plugin
                .param_value_to_text(0, wanted)
                .expect("automation value formats");
            let value = plugin
                .param_text_to_value(0, &text)
                .expect("automation text parses");
            plugin.queue_event(HostedEvent::Param {
                at_frame: 7,
                id: 0,
                value,
            });
        }
        let mut outputs = vec![vec![0.0f32; 64]; channels];
        let mut refs: Vec<&mut [f32]> = outputs.iter_mut().map(Vec::as_mut_slice).collect();
        plugin.process(&[], &mut refs, 64);
        assert!(!plugin.take_output_fault());
        rendered.extend(outputs.into_iter().flatten());
    }
    plugin.stop_processing();
    plugin.deactivate();
    assert!(rendered.iter().all(|sample| sample.is_finite()));
    let rms =
        (rendered.iter().map(|sample| sample.powi(2)).sum::<f32>() / rendered.len() as f32).sqrt();
    assert!(rms > 0.0001, "N4 timeline export was silent ({rms})");
    let saved = plugin.save_state_blob();
    assert!(!saved.bytes.is_empty());
    drop(plugin);

    let mut reloaded = HostedPlugin::load(&descriptor, 48_000.0, 64).expect("reload synth");
    assert!(reloaded.restore_state_checked(&saved.bytes));
    assert_eq!(
        reloaded.save_state_blob().content_hash,
        saved.content_hash,
        "state hash survives reload"
    );
    drop(reloaded);

    let export = std::env::temp_dir().join(format!("openjammer-n4-{}.wav", std::process::id()));
    write_float_wav(&export, &rendered, channels as u16);
    let metadata = std::fs::metadata(&export).expect("N4 export exists");
    assert!(metadata.len() > 44);
    let _ = std::fs::remove_file(export);
}
