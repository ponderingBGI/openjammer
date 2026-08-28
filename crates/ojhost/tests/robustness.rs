#![cfg(feature = "clap-host")]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use ojcore::{
    compile, register_builtins, BuiltinOpts, Engine, EventRing, PluginRegistry, Watchdog,
};
use ojhost::{Blacklist, HostedPlugin};
use ojproto::{
    ConnectionType, FaultKind, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand, RtEvent,
};

fn probe_binary() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        assert!(Command::new(env!("CARGO"))
            .current_dir(&workspace)
            .args(["build", "-p", "ojhost-probes"])
            .status()
            .unwrap()
            .success());
        let dylib = workspace.join("target/debug").join(if cfg!(windows) {
            "ojhost_probes.dll"
        } else if cfg!(target_os = "macos") {
            "libojhost_probes.dylib"
        } else {
            "libojhost_probes.so"
        });
        let dir = std::env::temp_dir().join(format!("ojhost-robustness-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let clap = dir.join("openjammer-hostile.clap");
        std::fs::copy(dylib, &clap).unwrap();
        clap
    })
}

fn descriptors() -> Vec<ojhost::PluginDescriptor> {
    ojhost::probe_candidate(probe_binary()).expect("probe hostile dylib")
}

fn descriptor(name: &str) -> ojhost::PluginDescriptor {
    descriptors().into_iter().find(|d| d.name == name).unwrap()
}

fn process(plugin: &mut HostedPlugin, value: f32) -> Vec<f32> {
    let input = vec![value; 64];
    let mut output = vec![0.0; 64];
    plugin.process(&[&input], &mut [&mut output], 64);
    output
}

#[test]
fn output_guard_scrubs_nan_inf_denormal_and_clamps() {
    for name in ["probe-nan", "probe-denormal"] {
        let d = descriptor(name);
        let mut plugin = HostedPlugin::load(&d, 48_000.0, 64).unwrap();
        plugin.activate(48_000.0, 64);
        plugin.start_processing();
        let output = process(&mut plugin, 0.25);
        assert!(output.iter().all(|sample| *sample == 0.0));
        assert!(plugin.take_output_fault(), "{name} raises its guard fault");
        assert!(!plugin.take_output_fault(), "fault latch is consumable");
    }
    let mut block = [3.5, 8.0, -9.0];
    assert!(ojcore::sanitize(&mut block));
    assert_eq!(block, [3.5, 4.0, -4.0]);
}

#[test]
fn slow_activation_times_out_while_an_existing_stream_keeps_flowing() {
    let slow = descriptor("probe-slow-activate");
    let gain = descriptor("probe-gain");
    let mut live = HostedPlugin::load(&gain, 48_000.0, 64).unwrap();
    live.activate(48_000.0, 64);
    live.start_processing();
    let worker = std::thread::spawn(move || {
        HostedPlugin::load_with_activation_timeout(&slow, 48_000.0, 64, Duration::from_millis(80))
    });
    let start = Instant::now();
    let mut blocks = 0;
    while start.elapsed() < Duration::from_millis(100) {
        assert!(process(&mut live, 0.25).iter().all(|&v| v == 0.25));
        blocks += 1;
    }
    assert!(blocks > 1);
    assert!(
        worker.join().unwrap().is_err(),
        "slow activation is abandoned"
    );
}

#[test]
fn finite_block_stall_is_measurable_after_the_call_and_state_liar_is_detected() {
    let hang = descriptor("probe-block-hang");
    let mut plugin = HostedPlugin::load(&hang, 48_000.0, 64).unwrap();
    plugin.activate(48_000.0, 64);
    plugin.start_processing();
    let _ = process(&mut plugin, 0.0);
    let start = Instant::now();
    let _ = process(&mut plugin, 0.0);
    assert!(start.elapsed() >= Duration::from_millis(40));

    let liar = descriptor("probe-state-liar");
    let mut liar = HostedPlugin::load(&liar, 48_000.0, 64).unwrap();
    let own = liar.save_state_blob();
    assert!(!liar.restore_state_checked(&own.bytes));
}

#[test]
fn event_flood_is_bounded_and_host_remains_usable() {
    let flood = descriptor("probe-event-flood");
    let mut plugin = HostedPlugin::load(&flood, 48_000.0, 64).unwrap();
    plugin.activate(48_000.0, 64);
    plugin.start_processing();
    let output = process(&mut plugin, 0.125);
    assert!(output.iter().all(|&v| v == 0.125));
    assert!(plugin.take_param_gestures().len() <= 256);
    assert!(
        !plugin.save_state_blob().bytes.is_empty(),
        "project state still saves"
    );
}

fn graph_node(id: u32, manifest: &str, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: manifest.into(),
        kind,
        params: vec![],
        assets: vec![],
        n_in,
        n_out,
    }
}

fn edge(from: u32, from_port: u16, to: u32, to_port: u16) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port,
        to_node: NodeIdx(to),
        to_port,
        kind: ConnectionType::Audio,
    }
}

fn render_three_tracks(
    desc: &ojhost::PluginDescriptor,
    watchdog: bool,
) -> (Vec<f32>, Vec<RtEvent>) {
    let mut registry = PluginRegistry::new();
    register_builtins(&mut registry, BuiltinOpts::full());
    ojhost::register_scanned(&mut registry, std::slice::from_ref(desc));
    let hosted_id = ojhost::hosted_plugin_id(desc);
    let mut graph = OjGraph::empty(48_000, 64);
    graph.nodes.extend([
        graph_node(1, ojcore::GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1),
        graph_node(2, ojcore::GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1),
        graph_node(3, ojcore::GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1),
        graph_node(4, ojcore::GAIN_ID, PrimitiveKind::Gain, 1, 1),
        graph_node(5, ojcore::GAIN_ID, PrimitiveKind::Gain, 1, 1),
        graph_node(6, &hosted_id, PrimitiveKind::PluginHost, 1, 1),
        graph_node(7, ojcore::ADD_ID, PrimitiveKind::Add, 2, 1),
        graph_node(8, ojcore::ADD_ID, PrimitiveKind::Add, 2, 1),
        graph_node(9, ojcore::SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0),
    ]);
    graph.edges.extend([
        edge(1, 0, 4, 0),
        edge(2, 0, 5, 0),
        edge(3, 0, 6, 0),
        edge(4, 0, 7, 0),
        edge(5, 0, 7, 1),
        edge(7, 0, 8, 0),
        edge(6, 0, 8, 1),
        edge(8, 0, 9, 0),
    ]);
    let mut engine = Engine::new(compile(&graph, &registry).expect("three-track graph compiles"));
    if watchdog {
        engine.set_watchdog(Some(Watchdog::new(5_000_000, true).with_consecutive(1)));
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(6),
            note: 60,
            vel: 100,
        });
        assert_ne!(engine.held_notes_mask(NodeIdx(6)), 0);
    }
    let ring = Arc::new(EventRing::new());
    engine.attach_event_ring(Some(Arc::clone(&ring)));
    let a: Vec<f32> = (0..64).map(|i| i as f32 / 256.0).collect();
    let b: Vec<f32> = (0..64).map(|i| (63 - i) as f32 / 512.0).collect();
    let silence = [0.0f32; 64];
    let mut rendered = Vec::new();
    for _ in 0..2 {
        engine.input_mut(NodeIdx(1), 0).unwrap()[..64].copy_from_slice(&a);
        engine.input_mut(NodeIdx(2), 0).unwrap()[..64].copy_from_slice(&b);
        engine.input_mut(NodeIdx(3), 0).unwrap()[..64].copy_from_slice(&silence);
        let mut block = [0.0f32; 64];
        engine.process_block(&mut block, 64);
        rendered.extend(block);
    }
    if watchdog {
        assert_eq!(
            engine.held_notes_mask(NodeIdx(6)),
            0,
            "watchdog releases the failed node's held notes via note-off"
        );
    }
    let mut events = Vec::new();
    let mut frame = [0u8; ojcore::meter::event_frame::MAX_LEN];
    while let Some(n) = ring.pop(&mut frame) {
        if let Some(event) = ojcore::meter::event_frame::decode(&frame[..n]) {
            events.push(event);
        }
    }
    (rendered, events)
}

#[test]
fn reliability_contract_three_track_unaffected_fingerprint_is_bit_identical() {
    let control = descriptor("probe-gain");
    let (expected, _) = render_three_tracks(&control, false);
    for (name, fault, watchdog) in [
        ("probe-nan", FaultKind::NonFinite, false),
        ("probe-denormal", FaultKind::NonFinite, false),
        ("probe-block-hang", FaultKind::AutoBypassed, true),
    ] {
        let hostile = descriptor(name);
        let (actual, events) = render_three_tracks(&hostile, watchdog);
        assert_eq!(
            actual, expected,
            "{name} changed unaffected track contribution"
        );
        assert!(
            events.iter().any(|event| matches!(event,
                RtEvent::NodeFault { node: NodeIdx(6), fault: got } if *got == fault
            )),
            "{name} surfaced its calm fault: {events:?}"
        );
        let plugin = HostedPlugin::load(&hostile, 48_000.0, 64).unwrap();
        assert!(
            !plugin.save_state_blob().bytes.is_empty(),
            "{name} state still saves"
        );
    }
}

#[test]
fn scan_crash_isolated_with_reason_then_benched_and_pardonable() {
    let source = probe_binary();
    let crash = source.parent().unwrap().join("probe-crash-on-scan.clap");
    std::fs::copy(source, &crash).unwrap();
    let store = source.parent().unwrap().join("quarantine.tsv");
    let helper = env!("CARGO_BIN_EXE_ojhost-scan-helper");
    std::env::set_var("OJHOST_SCAN_HELPER", helper);
    let mut quarantine = Blacklist::load(&store);
    let found = ojhost::scan_with(
        &[source.parent().unwrap().to_owned()],
        &mut quarantine,
        None,
    )
    .expect("scanner parent survives child abort");
    std::env::remove_var("OJHOST_SCAN_HELPER");
    assert!(found.iter().any(|d| d.name == "probe-gain"));
    let path = crash.to_string_lossy();
    let first = quarantine.entries().find(|e| e.path == path).unwrap();
    assert_eq!(first.crash_count, 1);
    assert!(!first.reason.is_empty());
    quarantine.allow_rescan(&path).unwrap();
    std::env::set_var("OJHOST_SCAN_HELPER", helper);
    let _ = ojhost::scan_with(
        &[source.parent().unwrap().to_owned()],
        &mut quarantine,
        None,
    )
    .unwrap();
    std::env::remove_var("OJHOST_SCAN_HELPER");
    assert!(quarantine
        .entries()
        .find(|e| e.path == path)
        .unwrap()
        .benched());
    quarantine.pardon(&path).unwrap();
    assert!(!quarantine.contains(&path));
}

#[test]
fn abort_child() {
    let Ok(path) = std::env::var("OJHOST_ABORT_PROBE") else {
        return;
    };
    let all = ojhost::probe_candidate(Path::new(&path)).unwrap();
    let d = all.iter().find(|d| d.name == "probe-abort").unwrap();
    let mut plugin = HostedPlugin::load(d, 48_000.0, 64).unwrap();
    plugin.activate(48_000.0, 64);
    plugin.start_processing();
    let _ = process(&mut plugin, 0.0);
    let _ = process(&mut plugin, 0.0);
}

#[test]
fn abort_is_recovered_into_quarantine_on_next_launch() {
    let dir = probe_binary().parent().unwrap();
    let marker = dir.join("runtime-crash.marker");
    let store = dir.join("runtime-quarantine.tsv");
    let path = probe_binary().to_string_lossy().into_owned();
    ojhost::write_crash_marker(&marker, &path).unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "abort_child", "--nocapture"])
        .env("OJHOST_ABORT_PROBE", &path)
        .status()
        .unwrap();
    assert!(
        !status.success(),
        "abort must terminate only the disposable test process"
    );
    let mut quarantine = Blacklist::load(&store);
    assert_eq!(
        ojhost::recover_crash_marker(&marker, &mut quarantine).unwrap(),
        Some(path.clone())
    );
    assert!(quarantine.contains(&path));
}
