//! U6 STEP 1 end-to-end: a `RtCommand::NoteOn` routed through `Engine::apply`
//! reaches an instrument node's `note_on` and produces audible output at the
//! engine's master out — proving the note-plumbing added to ojcore is wired all
//! the way from the command seam to the DSP voice.
#![cfg(feature = "std")]

use ojcore::{compile, Engine, GainLoader, PluginRegistry};
use ojinstrument::OscLoader;
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};

const SR: u32 = 48_000;
const BLOCK: u32 = 256;
const NB: usize = BLOCK as usize;

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

fn audio_edge(from: u32, fp: u16, to: u32, tp: u16) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: fp,
        to_node: NodeIdx(to),
        to_port: tp,
        kind: ConnectionType::Audio,
    }
}

/// Osc(1) -> SpeakerOut(2). SpeakerOut reuses the gain manifest only so it
/// resolves; its `kind` (a sink) is what the executor keys on.
fn osc_to_speaker() -> OjGraph {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes
        .push(node(1, "builtin.osc", PrimitiveKind::Osc, 0, 1));
    g.nodes
        .push(node(2, "builtin.gain", PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 0, 2, 0));
    g
}

fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(OscLoader::new()));
    reg.register(Box::new(GainLoader::new()));
    reg
}

#[test]
fn note_on_command_drives_instrument_to_master_out() {
    let reg = registry();
    let prog = compile(&osc_to_speaker(), &reg).expect("compile osc graph");
    let mut engine = Engine::new(prog);

    let mut out = vec![0.0f32; NB];

    // Before any note: master out is silent.
    engine.process_block(&mut out, NB);
    let silent_peak = out.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
    assert!(silent_peak < 1e-6, "idle instrument was not silent");

    // Route a NoteOn through the SAME apply() path the command ring uses.
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 69, // A4
        vel: 110,
    });

    // Render several blocks; the note must now produce audible output.
    let mut peak = 0.0f32;
    for _ in 0..16 {
        engine.process_block(&mut out, NB);
        for &x in &out {
            peak = peak.max(x.abs());
        }
    }
    assert!(
        peak > 0.01,
        "NoteOn did not reach the instrument (master peak {peak})"
    );

    // Note-off then long decay (~1.7 s at this block size) -> back to silence.
    engine.apply(RtCommand::NoteOff {
        node: NodeIdx(1),
        note: 69,
    });
    for _ in 0..320 {
        engine.process_block(&mut out, NB);
    }
    let tail = out.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
    assert!(
        tail < 1e-3,
        "note did not release at master out (tail {tail})"
    );
}

#[test]
fn note_to_unknown_node_is_ignored() {
    let reg = registry();
    let prog = compile(&osc_to_speaker(), &reg).expect("compile");
    let mut engine = Engine::new(prog);
    // A NoteOn for a node id absent from the program must be a harmless no-op.
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(999),
        note: 60,
        vel: 100,
    });
    let mut out = vec![0.0f32; NB];
    engine.process_block(&mut out, NB);
    let peak = out.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
    assert!(peak < 1e-6, "note to unknown node produced sound");
}
