#![cfg(feature = "std")]

use ojcore::capture::Capture;
use ojcore::{compile, Engine, GainLoader, PluginRegistry, TempoMapRt, TimelineRt, GAIN_ID};
use ojproto::{
    capture_mark_kind, transport_flag, CaptureArm, ConnectionType, IrEdge, IrNode, NodeIdx,
    OjGraph, PrimitiveKind, RtCommand, TimedCommand, Timeline,
};

fn engine() -> Engine {
    let mut graph = OjGraph::empty(48_000, 16);
    graph.nodes = vec![
        IrNode {
            id: NodeIdx(1),
            manifest_id: GAIN_ID.into(),
            kind: PrimitiveKind::GraphIn,
            params: vec![],
            assets: vec![],
            n_in: 0,
            n_out: 1,
        },
        IrNode {
            id: NodeIdx(2),
            manifest_id: GAIN_ID.into(),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        },
    ];
    graph.edges.push(IrEdge {
        from_node: NodeIdx(1),
        from_port: 0,
        to_node: NodeIdx(2),
        to_port: 0,
        kind: ConnectionType::Audio,
    });
    let mut registry = PluginRegistry::new();
    registry.register(Box::new(GainLoader::new()));
    Engine::new(compile(&graph, &registry).unwrap())
}

fn install(engine: &mut Engine, loop_range: Option<(u64, u64)>, punch: Option<(u64, u64)>) {
    let map = TempoMapRt::one_point(48_000, 120.0, 4, 4);
    engine.install_timeline(TimelineRt::from_wire(
        &Timeline {
            sample_rate: 48_000,
            events: vec![],
            loop_range,
            punch_range: punch,
            armed_tracks: vec![CaptureArm {
                node: NodeIdx(1),
                align: 1,
            }],
            count_in_beats: 0,
            end: 64,
        },
        &map,
    ));
}

#[test]
fn punch_boundaries_are_exact_to_the_sample() {
    let mut engine = engine();
    install(&mut engine, None, Some((2, 6)));
    let (mut capture, sink) = Capture::new(128);
    engine.attach_capture_sink(Some(sink));
    engine.apply_rt(RtCommand::TransportSet {
        flag: transport_flag::PUNCH_ENABLE,
        on: true,
    });
    engine.apply_rt(RtCommand::TransportSet {
        flag: transport_flag::RECORD_ARM,
        on: true,
    });
    engine.apply_rt(RtCommand::TransportPlay);
    engine.input_mut(NodeIdx(1), 0).unwrap()[..8]
        .copy_from_slice(&[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
    engine.process_block(&mut [0.0; 8], 8);
    assert_eq!(capture.take(1, 0).unwrap(), vec![2.0, 3.0, 4.0, 5.0]);
    let marks: Vec<_> = core::iter::from_fn(|| capture.pop_mark()).collect();
    assert_eq!(
        marks
            .iter()
            .map(|m| (m.kind, m.at_frame))
            .collect::<Vec<_>>(),
        vec![
            (capture_mark_kind::PUNCH_IN, 2),
            (capture_mark_kind::PUNCH_OUT, 6)
        ]
    );
}

#[test]
fn loop_wrap_segments_and_live_notes_are_stamped() {
    let mut engine = engine();
    install(&mut engine, Some((2, 6)), None);
    let (mut capture, sink) = Capture::new(256);
    engine.attach_capture_sink(Some(sink));
    engine.apply_rt(RtCommand::Seek { samples: 2 });
    engine.apply_rt(RtCommand::TransportSet {
        flag: transport_flag::LOOP_ENABLE,
        on: true,
    });
    engine.apply_rt(RtCommand::TransportSet {
        flag: transport_flag::RECORD_ARM,
        on: true,
    });
    engine.apply_rt(RtCommand::TransportPlay);
    assert!(engine.enqueue_timed(TimedCommand {
        at: 4,
        cmd: RtCommand::NoteOn {
            node: NodeIdx(1),
            note: 64,
            vel: 99,
        },
    }));
    engine.input_mut(NodeIdx(1), 0).unwrap()[..8]
        .copy_from_slice(&[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
    engine.process_block(&mut [0.0; 8], 8);
    let marks: Vec<_> = core::iter::from_fn(|| capture.pop_mark()).collect();
    assert!(marks
        .iter()
        .any(|m| m.kind == capture_mark_kind::LOOP_WRAP && m.at_frame == 6));
    assert!(marks.iter().any(|m| {
        m.kind == capture_mark_kind::NOTE_ON && m.at_frame == 4 && m.payload == 64 | (99 << 8)
    }));
    assert_eq!(ojcore::exec::accumulated_capture_frame(10, 8, 8, 3), 13);
}

#[test]
fn pdc_capture_marks_are_placed_on_the_timeline_clock() {
    let mut engine = engine();
    engine.program_mut().preroll = 5;
    engine.program_mut().to_master.fill(0);
    install(&mut engine, None, None);
    let (mut capture, sink) = Capture::new(128);
    engine.attach_capture_sink(Some(sink));
    engine.apply_rt(RtCommand::Seek { samples: 10 });
    engine.apply_rt(RtCommand::TransportSet {
        flag: transport_flag::RECORD_ARM,
        on: true,
    });
    engine.apply_rt(RtCommand::TransportPlay);
    engine.process_block(&mut [0.0; 4], 4);

    let mark = capture.pop_mark().expect("record-start mark");
    assert_eq!(mark.kind, capture_mark_kind::RECORD_START);
    assert_eq!(mark.at_frame, 10, "E=15 is placed at timeline T=10");
    assert_eq!(ojcore::exec::capture_timeline_frame(15, 5), 10);
}
