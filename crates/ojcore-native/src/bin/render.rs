//! Offline render — device-free proof that the ojcore engine produces correct
//! audio. Plays a short C-major arpeggio through `Osc -> Biquad -> Delay ->
//! SpeakerOut` and writes a WAV (no audio device required), printing an RMS/peak
//! summary. Listen to the file to confirm sound quality before the full
//! hardware test; CI/devs can assert on the summary.
//!
//!   cargo run -p ojcore-native --bin render -- [out.wav] [seconds]

use ojcore::effects::{biquad_param, delay_param};
use ojcore::{compile, Engine, PluginRegistry, BIQUAD_ID, DELAY_ID, SPEAKER_OUT_ID};
use ojcore_native::{AssetStore, OfflineDriver, Pcm};
use ojinstrument::{param as ip, register_all, RegisterOpts, OSC_ID};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, PrimitiveKind, RtCommand};

const SR: u32 = 48_000;
const BLOCK: usize = 256;

fn node(
    id: u32,
    manifest: &str,
    kind: PrimitiveKind,
    n_in: u8,
    n_out: u8,
    params: &[(u16, f32)],
) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: manifest.into(),
        kind,
        params: params
            .iter()
            .map(|&(id, value)| Param { id, value })
            .collect(),
        assets: Vec::new(),
        n_in,
        n_out,
    }
}

fn edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "openjammer-demo.wav".into());
    let seconds: f32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(4.0);

    // Osc -> Biquad(lowpass 3 kHz) -> Delay -> SpeakerOut.
    let mut g = OjGraph::empty(SR, BLOCK as u32);
    g.nodes.push(node(
        1,
        OSC_ID,
        PrimitiveKind::Osc,
        0,
        1,
        &[
            (ip::GAIN, 0.7),
            (ip::ATTACK, 0.005),
            (ip::DECAY, 0.08),
            (ip::SUSTAIN, 0.7),
            (ip::RELEASE, 0.25),
        ],
    ));
    g.nodes.push(node(
        2,
        BIQUAD_ID,
        PrimitiveKind::Biquad,
        1,
        1,
        &[(biquad_param::TYPE, 0.0), (biquad_param::FREQ, 3_000.0)],
    ));
    g.nodes.push(node(
        3,
        DELAY_ID,
        PrimitiveKind::Delay,
        1,
        1,
        &[
            (delay_param::TIME, 0.25),
            (delay_param::FEEDBACK, 0.35),
            (delay_param::MIX, 0.3),
        ],
    ));
    g.nodes.push(node(
        4,
        SPEAKER_OUT_ID,
        PrimitiveKind::SpeakerOut,
        1,
        0,
        &[],
    ));
    g.edges.push(edge(1, 2));
    g.edges.push(edge(2, 3));
    g.edges.push(edge(3, 4));

    let mut reg = PluginRegistry::new();
    register_all(&mut reg, RegisterOpts::full());
    let engine = Engine::new(compile(&g, &reg).expect("compile demo graph"));
    let mut driver = OfflineDriver::new(engine, BLOCK);

    // C-major arpeggio, ~0.25s per note, then a tail so the delay/release ring out.
    let notes: [u8; 6] = [60, 64, 67, 72, 67, 64];
    let note_frames = SR as usize / 4;
    let play_frames = (seconds * SR as f32) as usize;
    let tail_frames = SR as usize / 2;

    // The "second clock": the OfflineDriver owns the block loop + virtual transport;
    // this hook is the SCHEDULE, applying note edges at each block boundary frame.
    let mut playing: Option<u8> = None;
    let buf = driver.render_mono(play_frames + tail_frames, |engine, frame| {
        // Schedule notes only within the play region; the tail just rings out.
        let want = if frame < play_frames {
            Some(notes[(frame / note_frames) % notes.len()])
        } else {
            None
        };
        if want != playing {
            if let Some(n) = playing {
                engine.apply(RtCommand::NoteOff {
                    node: NodeIdx(1),
                    note: n,
                });
            }
            if let Some(n) = want {
                engine.apply(RtCommand::NoteOn {
                    node: NodeIdx(1),
                    note: n,
                    vel: 112,
                });
            }
            playing = want;
        }
    });
    let total = buf.len();

    let n = buf.len() as f64;
    let rms = (buf.iter().map(|&x| (x as f64) * (x as f64)).sum::<f64>() / n).sqrt();
    let peak = buf.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
    let nonzero = buf.iter().filter(|&&x| x.abs() > 1e-4).count();
    let finite = buf.iter().all(|x| x.is_finite());

    let pcm = Pcm {
        samples: buf,
        channels: 1,
        sample_rate: SR,
    };
    AssetStore.write_wav_file(&out, &pcm).expect("write wav");

    println!("ojcore offline render -> {out}");
    println!(
        "  {:.2}s @ {} Hz mono, {} frames",
        total as f32 / SR as f32,
        SR,
        total
    );
    println!(
        "  rms={rms:.4}  peak={peak:.4}  non-silent={:.1}%  finite={finite}",
        100.0 * nonzero as f64 / n
    );
    let ok = finite && rms > 0.01 && peak <= 1.5 && nonzero as f64 / n > 0.2;
    println!(
        "  {}",
        if ok {
            "PASS — engine produced correct, non-silent audio"
        } else {
            "WARN — output not in the expected band"
        }
    );
    std::process::exit(if ok { 0 } else { 1 });
}
