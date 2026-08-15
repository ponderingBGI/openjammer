//! Offline render — the device-free AUDITION tool. "Play this graph and tell me
//! what it sounds like", for an agent, CI, or a human, with NO audio device.
//!
//! Two modes share the one engine + the one [`OfflineDriver`] ("two clocks",
//! `docs/BOUNDARY.md` §9):
//!
//!   * DEMO (no `--graph`): a built-in C-major arpeggio through
//!     `Osc -> Biquad -> Delay -> Pan -> SpeakerOut`, panned across the field. This
//!     is the deterministic CI gate (kept byte-stable).
//!   * GRAPH (`--graph g.json`): compile + render an ARBITRARY `OjGraph` (the exact
//!     JSON the UI's `emitOjGraph` emits), driven by an optional note/param
//!     `--schedule s.json`. This is how an agent auditions its own creations.
//!
//! Both write a stereo WAV (listen to it) AND an [`AudioReport`] (assert on it):
//!
//!   cargo run -p ojcore-native --bin render --features demo -- [out.wav] [seconds]
//!   cargo run -p ojcore-native --bin render --features demo -- \
//!       --graph patch.json --schedule notes.json --secs 2 \
//!       --out take.wav --report verdict.json --assert 'is_stereo' --assert 'rms>0.02'
//!
//! `--dump-graph demo.json` writes the demo graph as JSON (a worked example of the
//! `OjGraph` shape to hand to `--graph`). Exit code is 0 when every assertion (or
//! the default non-silent band) holds, else 1 — so it is a real test gate.

use ojcore::effects::{biquad_param, delay_param};
use ojcore::{
    compile, compile_with_assets, pan_param, AssetPcm, AssetResolver, Engine, PluginRegistry,
    TempoMapRt, TimelineRt, BIQUAD_ID, DELAY_ID, PAN_ID, SPEAKER_OUT_ID,
};
use ojcore_native::{analyze_stereo, AssetStore, AudioReport, OfflineDriver, Pcm};
use ojinstrument::{param as ip, register_all, RegisterOpts, OSC_ID};
use ojproto::{
    AssetId, AssetRef, ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, Param, PrimitiveKind,
    RtCommand, TempoMap, Timeline,
};
use serde::Deserialize;

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

/// The built-in demo graph: Osc -> Biquad(lowpass 3 kHz) -> Delay -> Pan -> Speaker.
fn demo_graph() -> OjGraph {
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
    g.nodes.push(node(5, PAN_ID, PrimitiveKind::Pan, 1, 1, &[]));
    g.edges.push(edge(1, 2));
    g.edges.push(edge(2, 3));
    g.edges.push(edge(3, 5));
    g.edges.push(edge(5, 4));
    g
}

fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    register_all(&mut reg, RegisterOpts::full());
    reg
}

/// The plugin registry for an arbitrary-graph render, optionally extended with
/// agent-authored faust code nodes (`--code-node ID=src.dsp`) — the agent's PRIMARY
/// creative mode, made audible device-free: each source compiles to a native `.dll`
/// hosted as a real `WasmHost` loader under its id (the SAME loader the live engine
/// uses), so the render plays the agent's OWN instrument instead of a silent gain
/// fallback. The kernel runs through ojwasm's permanent OutputGuard chain.
#[cfg(feature = "author-host")]
fn make_registry(code_nodes: &[(String, String)]) -> PluginRegistry {
    use ojcore::{DspKind, PluginManifest, PortDecl, UiKind};
    use ojwasm::{compile_faust_to_dll, native_dll_arity, WasmHostLoader};

    let mut reg = registry();
    let root = std::env::temp_dir().join("oj_render_code_nodes");
    for (id, path) in code_nodes {
        let src = std::fs::read_to_string(path)
            .unwrap_or_else(|e| fail(&format!("--code-node {id}: read {path}: {e}")));
        let safe: String = id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let dir = root.join(safe);
        std::fs::create_dir_all(&dir)
            .unwrap_or_else(|e| fail(&format!("--code-node {id}: mkdir {dir:?}: {e}")));
        let dll = compile_faust_to_dll(&src, &dir).unwrap_or_else(|| {
            fail(&format!(
                "--code-node {id}: faust -> .dll compile failed (need faust + MSVC cl.exe)"
            ))
        });
        // Match the manifest ports to the DSP's REAL arity so a generator (0-in) and
        // an effect (1-in) each host correctly.
        let (audio_in, audio_out) = native_dll_arity(&dll).unwrap_or((1, 1));
        let manifest = PluginManifest {
            abi: None,
            id: id.clone(),
            name: format!("Authored {id}"),
            kind: PrimitiveKind::WasmHost,
            dsp: DspKind::Wasm,
            ui: UiKind::Auto,
            params: Vec::new(),
            ports: PortDecl {
                audio_in: audio_in as u8,
                audio_out: audio_out as u8,
                control_in: 0,
                control_out: 0,
                audio_in_channels: if audio_in > 0 { 1 } else { 0 },
                audio_out_channels: if audio_out > 0 { 1 } else { 0 },
            },
        };
        reg.register(Box::new(WasmHostLoader::new_native(manifest, dll)));
        eprintln!("  code-node {id}: registered ({audio_in}-in {audio_out}-out native faust .dll)");
    }
    reg
}

#[cfg(not(feature = "author-host"))]
fn make_registry(code_nodes: &[(String, String)]) -> PluginRegistry {
    if !code_nodes.is_empty() {
        fail("--code-node requires building with `--features author-host`");
    }
    registry()
}

/// Render the built-in demo: a C-major arpeggio swept across the stereo field, with
/// a delay/release tail. The schedule lives in this per-block hook (the second
/// clock's transport). Returns the planar L/R buffers.
fn render_demo(seconds: f32) -> (Vec<f32>, Vec<f32>, u32) {
    let engine = Engine::new(compile(&demo_graph(), &registry()).expect("compile demo graph"));
    let mut driver = OfflineDriver::new(engine, BLOCK);

    let notes: [u8; 6] = [60, 64, 67, 72, 67, 64];
    let note_frames = SR as usize / 4;
    let play_frames = (seconds * SR as f32) as usize;
    let tail_frames = SR as usize / 2;

    let mut playing: Option<u8> = None;
    let (left, right) = driver.render_stereo(play_frames + tail_frames, |engine, frame| {
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
        // Equal-power pan sweep left -> right, so the bounce is genuinely stereo.
        let pos = (frame as f32 / play_frames.max(1) as f32) * 2.0 - 1.0;
        engine.apply(RtCommand::SetParam {
            node: NodeIdx(5),
            param: pan_param::PAN,
            value: pos.clamp(-1.0, 1.0),
        });
    });
    (left, right, SR)
}

// ---------------------------------------------------------------------------
// Arbitrary-graph audition: load an `OjGraph` + a note/param schedule, render.
// ---------------------------------------------------------------------------

/// One scheduled control event at a wall-clock time (`at`, seconds). Internally
/// tagged by `cmd` so the JSON is flat and obvious:
///   {"at":0.0,"cmd":"noteOn","node":1,"note":60,"vel":112}
///   {"at":1.5,"cmd":"noteOff","node":1,"note":60}
///   {"at":0.0,"cmd":"setParam","node":5,"param":0,"value":-1.0}
#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum SchedCmd {
    NoteOn { node: u32, note: u8, vel: u8 },
    NoteOff { node: u32, note: u8 },
    SetParam { node: u32, param: u16, value: f32 },
}

#[derive(Deserialize)]
struct SchedEvent {
    at: f32,
    #[serde(flatten)]
    cmd: SchedCmd,
}

/// Load + frame-sort a schedule into `(frame, RtCommand)` pairs.
fn load_schedule(path: Option<&str>, sample_rate: u32) -> Vec<(usize, RtCommand)> {
    let Some(p) = path else {
        return Vec::new();
    };
    let json =
        std::fs::read_to_string(p).unwrap_or_else(|e| fail(&format!("read schedule {p}: {e}")));
    let events: Vec<SchedEvent> =
        serde_json::from_str(&json).unwrap_or_else(|e| fail(&format!("parse schedule {p}: {e}")));
    let mut out: Vec<(usize, RtCommand)> = events
        .into_iter()
        .map(|e| {
            let frame = (e.at.max(0.0) * sample_rate as f32) as usize;
            let cmd = match e.cmd {
                SchedCmd::NoteOn { node, note, vel } => RtCommand::NoteOn {
                    node: NodeIdx(node),
                    note,
                    vel,
                },
                SchedCmd::NoteOff { node, note } => RtCommand::NoteOff {
                    node: NodeIdx(node),
                    note,
                },
                SchedCmd::SetParam { node, param, value } => RtCommand::SetParam {
                    node: NodeIdx(node),
                    param,
                    value,
                },
            };
            (frame, cmd)
        })
        .collect();
    out.sort_by_key(|&(f, _)| f);
    out
}

/// Resolver for `--asset` CLI samples: the AssetId is the index into `pcms` (the
/// load order), so the i-th `--asset` flag binds AssetId(i). Borrows the decoded
/// interleaved PCM zero-copy — a stereo WAV keeps both channels (the Sampler splits
/// them; a mono-only consumer downmixes itself), so this drives the real stereo
/// Sampler path device-free.
struct CliAssets {
    pcms: Vec<Pcm>,
}

impl AssetResolver for CliAssets {
    fn resolve(&self, id: AssetId) -> Option<AssetPcm<'_>> {
        self.pcms
            .get(id.0 as usize)
            .map(|p| AssetPcm::from_interleaved(&p.samples, p.channels, p.sample_rate as f32))
    }
}

fn render_graph(
    path: &str,
    schedule: Option<&str>,
    timeline_path: Option<&str>,
    tempo_map_path: Option<&str>,
    seconds: f32,
    assets: &[(u32, String)],
    code_nodes: &[(String, String)],
) -> (Vec<f32>, Vec<f32>, u32) {
    let json =
        std::fs::read_to_string(path).unwrap_or_else(|e| fail(&format!("read graph {path}: {e}")));
    let mut g: OjGraph =
        serde_json::from_str(&json).unwrap_or_else(|e| fail(&format!("parse graph {path}: {e}")));

    // Decode each `--asset NODE=path.wav` and bind it to that node via an AssetRef,
    // so `compile_with_assets` installs the PCM through `DspInstance::load_asset`.
    let mut pcms: Vec<Pcm> = Vec::new();
    for (node_id, wav) in assets {
        let pcm = AssetStore
            .decode_wav_file(wav)
            .unwrap_or_else(|e| fail(&format!("decode asset {wav}: {e}")));
        let asset = AssetId(pcms.len() as u32);
        let target = g
            .nodes
            .iter_mut()
            .find(|n| n.id == NodeIdx(*node_id))
            .unwrap_or_else(|| fail(&format!("--asset: no node with id {node_id} in {path}")));
        target.assets.push(AssetRef { slot: 0, asset });
        pcms.push(pcm);
    }

    let sample_rate = g.sample_rate.max(1);
    let block = (g.block_size as usize).max(1);
    let resolver = CliAssets { pcms };
    let reg = make_registry(code_nodes);
    let program = if resolver.pcms.is_empty() {
        compile(&g, &reg)
    } else {
        compile_with_assets(&g, &reg, &resolver)
    }
    .unwrap_or_else(|e| fail(&format!("compile graph: {e:?}")));
    let engine = Engine::new(program);
    let mut driver = OfflineDriver::new(engine, block);

    if let Some(path) = tempo_map_path {
        let bytes =
            std::fs::read(path).unwrap_or_else(|e| fail(&format!("read tempo map {path}: {e}")));
        let map: TempoMap = serde_json::from_slice(&bytes)
            .unwrap_or_else(|e| fail(&format!("parse tempo map {path}: {e}")));
        driver
            .engine_mut()
            .install_tempo_map(TempoMapRt::from_wire(&map));
    }
    if let Some(path) = timeline_path {
        let bytes =
            std::fs::read(path).unwrap_or_else(|e| fail(&format!("read timeline {path}: {e}")));
        let timeline: Timeline = serde_json::from_slice(&bytes)
            .unwrap_or_else(|e| fail(&format!("parse timeline {path}: {e}")));
        // The timeline is already in absolute frames. A one-point map is enough
        // when no explicit map was supplied; with a map, the engine has already
        // installed the matching publication above.
        let compile_map = tempo_map_path.map_or_else(
            || TempoMapRt::one_point(sample_rate, 120.0, 4, 4),
            |map_path| {
                let bytes = std::fs::read(map_path)
                    .unwrap_or_else(|e| fail(&format!("read tempo map {map_path}: {e}")));
                let map: TempoMap = serde_json::from_slice(&bytes)
                    .unwrap_or_else(|e| fail(&format!("parse tempo map {map_path}: {e}")));
                TempoMapRt::from_wire(&map)
            },
        );
        driver
            .engine_mut()
            .install_timeline(TimelineRt::from_wire(&timeline, &compile_map));
        driver.engine_mut().apply(RtCommand::TransportPlay);
    }

    let events = load_schedule(schedule, sample_rate);
    let frames = (seconds.max(0.0) * sample_rate as f32) as usize;
    let mut idx = 0usize;
    let (left, right) = driver.render_stereo(frames, |engine, frame| {
        // Apply every not-yet-applied event whose frame falls in this block.
        while idx < events.len() && events[idx].0 < frame + block {
            engine.apply(events[idx].1);
            idx += 1;
        }
    });
    (left, right, sample_rate)
}

// ---------------------------------------------------------------------------
// CLI + verdict.
// ---------------------------------------------------------------------------

struct Opts {
    out: Option<String>,
    secs: Option<f32>,
    graph: Option<String>,
    schedule: Option<String>,
    timeline: Option<String>,
    tempo_map: Option<String>,
    report: Option<String>,
    dump_graph: Option<String>,
    asserts: Vec<String>,
    assets: Vec<(u32, String)>,
    /// Agent-authored faust code nodes: (manifest_id, faust_source_path). Each is
    /// compiled to a native .dll and hosted as a real WasmHost node (author-host).
    code_nodes: Vec<(String, String)>,
    quiet: bool,
}

fn parse_args() -> Opts {
    let mut o = Opts {
        out: None,
        secs: None,
        graph: None,
        schedule: None,
        timeline: None,
        tempo_map: None,
        report: None,
        dump_graph: None,
        asserts: Vec::new(),
        assets: Vec::new(),
        code_nodes: Vec::new(),
        quiet: false,
    };
    let mut positional: Vec<String> = Vec::new();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--graph" => o.graph = it.next(),
            "--schedule" => o.schedule = it.next(),
            "--timeline" => o.timeline = it.next(),
            "--tempo-map" => o.tempo_map = it.next(),
            "--out" => o.out = it.next(),
            "--report" => o.report = it.next(),
            "--dump-graph" => o.dump_graph = it.next(),
            "--secs" => o.secs = it.next().and_then(|s| s.parse().ok()),
            "--assert" => {
                if let Some(e) = it.next() {
                    o.asserts.push(e);
                }
            }
            "--asset" => {
                if let Some(v) = it.next() {
                    match v.split_once('=') {
                        Some((n, p)) => match n.trim().parse::<u32>() {
                            Ok(id) => o.assets.push((id, p.to_string())),
                            Err(_) => fail(&format!(
                                "--asset: bad node id in {v:?} (want NODE=path.wav)"
                            )),
                        },
                        None => fail(&format!("--asset: want NODE=path.wav, got {v:?}")),
                    }
                }
            }
            "--code-node" => {
                if let Some(v) = it.next() {
                    match v.split_once('=') {
                        Some((id, p)) => o.code_nodes.push((id.trim().to_string(), p.to_string())),
                        None => fail(&format!("--code-node: want ID=path.dsp, got {v:?}")),
                    }
                }
            }
            "--quiet" => o.quiet = true,
            other => positional.push(other.to_string()),
        }
    }
    // Back-compat positional form `render [out.wav] [seconds]` (the CI gate).
    if o.out.is_none() {
        o.out = positional.first().cloned();
    }
    if o.secs.is_none() {
        o.secs = positional.get(1).and_then(|s| s.parse().ok());
    }
    o
}

fn fail(msg: &str) -> ! {
    eprintln!("render: {msg}");
    std::process::exit(2);
}

fn print_summary(out: &str, rep: &AudioReport) {
    println!("ojcore offline render -> {out}");
    println!(
        "  {:.2}s @ {} Hz stereo, {} frames",
        rep.seconds, rep.sample_rate, rep.frames
    );
    println!(
        "  rms={:.4}  peak={:.4}  non-silent={:.1}%  finite={}",
        rep.rms, rep.peak, rep.nonsilent_pct, rep.finite
    );
    println!(
        "  L: rms={:.4} ~{:.0}Hz    R: rms={:.4} ~{:.0}Hz",
        rep.left.rms, rep.left.freq_est, rep.right.rms, rep.right.freq_est
    );
    println!(
        "  stereo: correlation={:.3}  is_stereo={}  clipped={}",
        rep.stereo_correlation, rep.is_stereo, rep.clipped
    );
}

/// The verdict for one `--assert`. `Unknown` is an HONEST "I cannot grade that" — a
/// typo'd or not-yet-implemented field errors LOUDLY with a field menu instead of
/// silently reading as a FAIL. The agent's ear must never lie by omission.
enum AssertOutcome {
    Pass,
    Fail,
    Unknown(String),
}

/// The menu of gradeable fields, shown when an assert can't be graded.
const ASSERT_FIELDS: &str = "bool: finite, is_stereo, clipped (optionally !-negated); \
numeric (ops > >= < <= ==): rms, peak, nonsilent_pct, correlation, left_rms, right_rms, \
left_freq, right_freq, seconds";

/// Evaluate one `--assert` expression against the report. Supports bool fields
/// (`finite`, `is_stereo`, `clipped`, optionally `!`-negated) and numeric
/// comparisons (`rms>0.01`, `peak<=1.5`, `correlation<0.9`, `left_rms>0.1`, …). An
/// unrecognized field or malformed expression returns `Unknown` (graded loudly),
/// NEVER a silent `false` that hides a typo or an unimplemented metric.
fn check_assert(rep: &AudioReport, expr: &str) -> AssertOutcome {
    let e = expr.trim();
    let (neg, name) = match e.strip_prefix('!') {
        Some(s) => (true, s.trim()),
        None => (false, e),
    };
    let as_bool = match name {
        "finite" => Some(rep.finite),
        "is_stereo" | "stereo" => Some(rep.is_stereo),
        "clipped" => Some(rep.clipped),
        _ => None,
    };
    if let Some(b) = as_bool {
        return if b ^ neg {
            AssertOutcome::Pass
        } else {
            AssertOutcome::Fail
        };
    }
    for op in [">=", "<=", "==", ">", "<"] {
        if let Some(pos) = e.find(op) {
            let field = e[..pos].trim();
            let lhs = match field {
                "rms" => rep.rms,
                "peak" => rep.peak,
                "nonsilent_pct" | "nonsilent" => rep.nonsilent_pct,
                "correlation" | "stereo_correlation" => rep.stereo_correlation,
                "left_rms" => rep.left.rms,
                "right_rms" => rep.right.rms,
                "left_freq" => rep.left.freq_est,
                "right_freq" => rep.right.freq_est,
                "seconds" => rep.seconds,
                _ => return AssertOutcome::Unknown(format!("field {field:?}")),
            };
            let Ok(rhs) = e[pos + op.len()..].trim().parse::<f32>() else {
                return AssertOutcome::Unknown(format!("number in {expr:?}"));
            };
            let pass = match op {
                ">=" => lhs >= rhs,
                "<=" => lhs <= rhs,
                "==" => (lhs - rhs).abs() < 1e-6,
                ">" => lhs > rhs,
                "<" => lhs < rhs,
                _ => false,
            };
            return if pass {
                AssertOutcome::Pass
            } else {
                AssertOutcome::Fail
            };
        }
    }
    AssertOutcome::Unknown(format!(
        "expression {expr:?} (not a known bool field, and no comparison operator)"
    ))
}

fn finish(left: &[f32], right: &[f32], sample_rate: u32, opts: &Opts, default_out: &str) -> ! {
    let out = opts.out.clone().unwrap_or_else(|| default_out.to_string());

    // Interleave L/R for the WAV.
    let total = left.len().min(right.len());
    let mut buf = vec![0.0f32; total * 2];
    for (i, (&lv, &rv)) in left.iter().zip(right.iter()).enumerate() {
        buf[i * 2] = lv;
        buf[i * 2 + 1] = rv;
    }
    let pcm = Pcm {
        samples: buf,
        channels: 2,
        sample_rate,
    };
    AssetStore
        .write_wav_file(&out, &pcm)
        .unwrap_or_else(|e| fail(&format!("write wav {out}: {e}")));

    let report = analyze_stereo(left, right, sample_rate);
    if !opts.quiet {
        print_summary(&out, &report);
    }
    if let Some(rp) = &opts.report {
        let json = serde_json::to_string_pretty(&report).expect("serialize report");
        std::fs::write(rp, json).unwrap_or_else(|e| fail(&format!("write report {rp}: {e}")));
        if !opts.quiet {
            println!("  report -> {rp}");
        }
    }

    let ok = if opts.asserts.is_empty() {
        // Default band (preserves the CI gate): non-silent, bounded, finite.
        report.finite && report.rms > 0.01 && report.peak <= 1.5 && report.nonsilent_pct > 20.0
    } else {
        let mut all = true;
        for a in &opts.asserts {
            match check_assert(&report, a) {
                AssertOutcome::Pass => {
                    if !opts.quiet {
                        println!("  assert {a:?}: PASS");
                    }
                }
                AssertOutcome::Fail => {
                    if !opts.quiet {
                        println!("  assert {a:?}: FAIL");
                    }
                    all = false;
                }
                // An ungradeable assert is a LOUD error (exit 2), never a silent FAIL
                // that hides a typo or a not-yet-implemented metric from the agent.
                AssertOutcome::Unknown(what) => {
                    eprintln!("render: cannot grade assert {a:?}: unknown {what}.");
                    eprintln!("  gradeable fields — {ASSERT_FIELDS}");
                    std::process::exit(2);
                }
            }
        }
        all
    };
    if !opts.quiet {
        println!(
            "  {}",
            if ok {
                "PASS — engine produced the expected audio"
            } else {
                "FAIL — output did not meet the assertions"
            }
        );
    }
    std::process::exit(if ok { 0 } else { 1 });
}

fn main() {
    let opts = parse_args();

    // `--dump-graph`: write the demo graph JSON (a worked `OjGraph` example) + exit.
    if let Some(dp) = &opts.dump_graph {
        let json = serde_json::to_string_pretty(&demo_graph()).expect("serialize demo graph");
        std::fs::write(dp, json).unwrap_or_else(|e| fail(&format!("write {dp}: {e}")));
        println!("wrote demo graph -> {dp}");
        return;
    }

    let (left, right, sample_rate, default_out) = if let Some(gp) = opts.graph.clone() {
        let (l, r, sr) = render_graph(
            &gp,
            opts.schedule.as_deref(),
            opts.timeline.as_deref(),
            opts.tempo_map.as_deref(),
            opts.secs.unwrap_or(2.0),
            &opts.assets,
            &opts.code_nodes,
        );
        (l, r, sr, "openjammer-render.wav")
    } else {
        let (l, r, sr) = render_demo(opts.secs.unwrap_or(4.0));
        (l, r, sr, "openjammer-demo.wav")
    };
    finish(&left, &right, sample_rate, &opts, default_out);
}
