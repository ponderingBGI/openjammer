//! Intrinsic engine latency: how long after a note-on does sound appear?
//!
//! This is the companion to `benches/latency.rs`. The bench measures the CPU cost
//! per block (the real-time deadline); this measures the engine's OWN algorithmic
//! delay from `NoteOn` to the first audible sample — the part of "latency" that is
//! the engine's to own, separate from the device buffer and driver.
//!
//! The chain here is deliberately Osc -> SpeakerOut with NO effects: a Delay node
//! would add its line time and confound the floor. The result documents that the
//! engine adds essentially nothing — sound starts inside the FIRST block after the
//! note — so the ~111 ms a user once saw was never the engine; it was the browser
//! AudioContext being read on the native path (fixed by the unified latency seam).

use ojcore::{compile, BuiltinOpts, Engine, PluginRegistry, SPEAKER_OUT_ID};
use ojinstrument::{register_all, RegisterOpts, OSC_ID};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};

const SR: u32 = 48_000;
const BLOCK: u32 = 64; // the production buffer the native engine requests
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

fn audio_edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

#[test]
fn note_on_is_audible_within_one_block() {
    // Osc -> SpeakerOut: isolates the engine's own note->sound delay.
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(1, OSC_ID, PrimitiveKind::Osc, 0, 1));
    g.nodes
        .push(node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(audio_edge(1, 2));

    let mut reg = PluginRegistry::new();
    register_all(
        &mut reg,
        RegisterOpts {
            builtins: BuiltinOpts::full(),
            instruments: true,
            sf2: false,
        },
    );
    let program = compile(&g, &reg).expect("compile");
    assert_eq!(
        program.preroll, 0,
        "a graph with no latency extensions retains the bit-identical zero-PDC path"
    );
    assert!(program.edge_delay.iter().all(|delay| *delay == 0));
    let mut engine = Engine::new(program);

    // Silent before any note: nothing should leak out of an un-gated oscillator.
    let mut warmup = vec![0.0f32; NB];
    engine.process_block(&mut warmup, NB);
    assert!(
        warmup.iter().all(|s| s.abs() < 1e-6),
        "engine must be silent before note-on"
    );

    // Note on, applied synchronously BEFORE the next render, then locate the onset.
    engine.apply(RtCommand::NoteOn {
        node: NodeIdx(1),
        note: 69,
        vel: 110,
    });

    // 1e-4 catches the envelope the instant it lifts off zero — the true onset,
    // not an arbitrary loudness. We search a generous 16 blocks so a slow attack
    // can never make this flake; the assertion below is what pins the floor.
    const THRESHOLD: f32 = 1e-4;
    let mut onset_sample: Option<usize> = None;
    'outer: for block_idx in 0..16 {
        let mut buf = vec![0.0f32; NB];
        engine.process_block(&mut buf, NB);
        for (i, &s) in buf.iter().enumerate() {
            if s.abs() >= THRESHOLD {
                onset_sample = Some(block_idx * NB + i);
                break 'outer;
            }
        }
    }

    let onset = onset_sample.expect("note must become audible");
    let onset_ms = onset as f32 / SR as f32 * 1000.0;
    println!("intrinsic note->sound latency: {onset} samples ({onset_ms:.3} ms @ {SR} Hz)");

    // The engine adds essentially nothing of its own: sound starts inside the
    // FIRST block after the note. All real latency is buffer + driver, not engine.
    assert!(
        onset < NB,
        "intrinsic note->sound delay was {onset} samples ({onset_ms:.3} ms); \
         expected < one block ({NB} samples) — the engine should add ~0 latency"
    );
}
