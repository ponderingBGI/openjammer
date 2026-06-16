//! Structural / routing built-ins: the no-DSP nodes that form a graph's I/O
//! boundary and its trivial signal plumbing.
//!
//! These were previously hand-rolled in the `ojcore-wasm` host. To reach PARITY
//! across BOTH engine targets (native + wasm) from a SINGLE source, the
//! [`StructuralLoader`] / [`StructuralNode`] pair now lives here and is shared
//! by every registry through [`crate::register_builtins`]. There is exactly one
//! implementation — no copy.
//!
//! Each structural node carries no parameters and no DSP:
//! * The I/O kinds (`GraphIn`, `MicIn`, `GraphOut`, `SpeakerOut`) are rendered
//!   specially by the executor — it never calls their `process` (sources keep
//!   their host-injected buffer; sinks have their resolved input emitted as the
//!   master output).
//! * `Add` and `Passthrough` simply forward input 0 to output 0 in `process`.
//!
//! Allocation-free and panic-free on any channel arrangement, so they satisfy
//! the RT contract uniformly with every other [`DspInstance`].

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojproto::PrimitiveKind;

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

/// Master-output parameter ids carried by the [`PrimitiveKind::SpeakerOut`] /
/// [`PrimitiveKind::GraphOut`] sink, so the host's "set speaker volume / mute"
/// control is a real `(NodeIdx, id)` [`ojproto::RtCommand::SetParam`] round-trip
/// rather than a no-op. The executor reads them back through
/// [`DspInstance::master_gain`] and scales the engine's master mix by the
/// result. Other structural kinds ignore these ids.
pub mod master_param {
    /// Master output volume, linear `0..`. Default `1.0` (unity). Clamped
    /// non-negative; the executor scales the final master mix by this.
    pub const VOLUME: u16 = 0;
    /// Master mute toggle (`!= 0` => muted, forcing the master gain to `0`).
    /// Carried as a float so it fits the one numeric param-addressing scheme.
    pub const MUTE: u16 = 1;
}

/// Manifest id of the host's master speaker-output sink.
pub const SPEAKER_OUT_ID: &str = "host.speaker_out";
/// Manifest id of the host's graph-output sink (off-line / sub-graph master).
pub const GRAPH_OUT_ID: &str = "host.graph_out";
/// Manifest id of the host's graph-input source (host-injected buffer).
pub const GRAPH_IN_ID: &str = "host.graph_in";
/// Manifest id of the host's microphone / capture input source.
pub const MIC_IN_ID: &str = "host.mic_in";
/// Manifest id of the built-in summing node (input 0 -> output 0; the executor
/// pre-mixes fan-in into input 0).
pub const ADD_ID: &str = "builtin.add";
/// Manifest id of the built-in passthrough (input 0 -> output 0).
pub const PASSTHROUGH_ID: &str = "builtin.passthrough";

/// Factory for a [`StructuralNode`] of a fixed [`PrimitiveKind`]. One loader
/// instance is registered per structural primitive the host exposes.
pub struct StructuralLoader {
    manifest: PluginManifest,
}

impl StructuralLoader {
    /// Build a loader for `kind` registered under `id`, declaring `audio_in` /
    /// `audio_out` ports. Master-output kinds ([`PrimitiveKind::SpeakerOut`] /
    /// [`PrimitiveKind::GraphOut`]) additionally declare the `volume` / `mute`
    /// master params (see [`master_param`]); the other kinds carry no params.
    pub fn new(id: &str, name: &str, kind: PrimitiveKind, audio_in: u8, audio_out: u8) -> Self {
        let params = if matches!(kind, PrimitiveKind::SpeakerOut | PrimitiveKind::GraphOut) {
            vec![
                ParamDecl {
                    id: master_param::VOLUME,
                    name: String::from("volume"),
                    min: 0.0,
                    max: 4.0,
                    default: 1.0,
                },
                ParamDecl {
                    id: master_param::MUTE,
                    name: String::from("mute"),
                    min: 0.0,
                    max: 1.0,
                    default: 0.0,
                },
            ]
        } else {
            vec![]
        };
        Self {
            manifest: PluginManifest {
                id: String::from(id),
                name: String::from(name),
                kind,
                dsp: DspKind::None,
                ui: UiKind::Auto,
                params,
                ports: PortDecl {
                    audio_in,
                    audio_out,
                    control_in: 0,
                    control_out: 0,
                },
            },
        }
    }

    /// The host's master speaker-output sink: one audio in, no audio out. Its
    /// resolved input becomes the engine's mono master output.
    pub fn speaker_out() -> Self {
        Self::new(
            SPEAKER_OUT_ID,
            "Speaker Out",
            PrimitiveKind::SpeakerOut,
            1,
            0,
        )
    }

    /// A graph-output sink (sub-graph / offline master): one audio in, no out.
    pub fn graph_out() -> Self {
        Self::new(GRAPH_OUT_ID, "Graph Out", PrimitiveKind::GraphOut, 1, 0)
    }

    /// A graph-input source: no audio in, one out (filled by the host via
    /// [`crate::Engine::input_mut`]).
    pub fn graph_in() -> Self {
        Self::new(GRAPH_IN_ID, "Graph In", PrimitiveKind::GraphIn, 0, 1)
    }

    /// A microphone / capture source: no audio in, one out (host-injected).
    pub fn mic_in() -> Self {
        Self::new(MIC_IN_ID, "Mic In", PrimitiveKind::MicIn, 0, 1)
    }

    /// A summing node: one (pre-mixed) audio in, one out.
    pub fn add() -> Self {
        Self::new(ADD_ID, "Add", PrimitiveKind::Add, 1, 1)
    }

    /// A passthrough: one audio in, one out.
    pub fn passthrough() -> Self {
        Self::new(
            PASSTHROUGH_ID,
            "Passthrough",
            PrimitiveKind::Passthrough,
            1,
            1,
        )
    }
}

impl PluginLoader for StructuralLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        // Carry the kind so a master sink honours its volume / mute params; every
        // other structural kind ignores them (their value is never read).
        Box::new(StructuralNode::new(self.manifest.kind))
    }
}

/// A near-stateless routing node. For the I/O kinds the executor handles
/// specially this `process` is never reached; for `Add` / `Passthrough` it
/// forwards input 0 to output 0. Allocation-free and panic-free on any channel
/// arrangement.
///
/// The only state it holds is the master sink's `volume` / `mute` (read by the
/// executor via [`DspInstance::master_gain`] when this node is the graph
/// master); for every other kind those fields sit at their unity defaults and
/// are never read.
pub struct StructuralNode {
    kind: PrimitiveKind,
    /// Master output volume (linear). Only meaningful on a master sink.
    volume: f32,
    /// Master mute flag. Only meaningful on a master sink.
    muted: bool,
}

impl StructuralNode {
    /// A node of the given primitive kind, with master volume at unity / unmuted.
    pub fn new(kind: PrimitiveKind) -> Self {
        Self {
            kind,
            volume: 1.0,
            muted: false,
        }
    }
}

impl DspInstance for StructuralNode {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Forward input 0 -> output 0 if both exist; otherwise leave outputs as
        // the engine pre-mixed them (silence). Tolerates any port count.
        if let (Some(input), Some(output)) = (ctx.inputs.first(), ctx.outputs.first_mut()) {
            let n = ctx.nframes.min(input.len()).min(output.len());
            output[..n].copy_from_slice(&input[..n]);
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        // Only the master sinks expose params; ignore on every other kind so a
        // stray SetParam can never alter routing behaviour.
        if !matches!(
            self.kind,
            PrimitiveKind::SpeakerOut | PrimitiveKind::GraphOut
        ) {
            return;
        }
        match id {
            master_param::VOLUME => self.volume = value.max(0.0),
            master_param::MUTE => self.muted = value != 0.0,
            _ => {}
        }
    }

    fn master_gain(&self) -> f32 {
        if self.muted {
            0.0
        } else {
            self.volume
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{compile, Engine, PluginRegistry};
    use ojproto::{IrEdge, IrNode, NodeIdx, OjGraph};

    /// A lone host `SpeakerOut` node compiles to a valid (silent) program — this
    /// is exactly what the wasm/native bootstrap relies on to start the engine
    /// before any graph.
    #[test]
    fn lone_speaker_out_compiles() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(StructuralLoader::speaker_out()));

        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 128,
            nodes: vec![IrNode {
                id: NodeIdx(0),
                manifest_id: String::from(SPEAKER_OUT_ID),
                kind: PrimitiveKind::SpeakerOut,
                params: vec![],
                assets: vec![],
                n_in: 1,
                n_out: 0,
            }],
            edges: vec![],
            schedule: vec![],
        };
        let prog = compile(&graph, &reg).expect("master-only graph compiles");
        let mut engine = Engine::new(prog);
        let mut out = vec![1.0f32; 128];
        engine.process_block(&mut out, 128);
        assert!(out.iter().all(|&s| s == 0.0), "no source -> silence");
    }

    /// GraphIn -> Passthrough -> SpeakerOut routes the injected input through to
    /// the master output unchanged. Proves the structural forwarding `process`
    /// and the I/O seam both work end to end against the shared loader.
    #[test]
    fn passthrough_routes_input_to_master() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(StructuralLoader::graph_in()));
        reg.register(Box::new(StructuralLoader::passthrough()));
        reg.register(Box::new(StructuralLoader::speaker_out()));

        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from(GRAPH_IN_ID),
                    kind: PrimitiveKind::GraphIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(PASSTHROUGH_ID),
                    kind: PrimitiveKind::Passthrough,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: String::from(SPEAKER_OUT_ID),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![
                IrEdge {
                    from_node: NodeIdx(0),
                    from_port: 0,
                    to_node: NodeIdx(1),
                    to_port: 0,
                    kind: ojproto::ConnectionType::Audio,
                },
                IrEdge {
                    from_node: NodeIdx(1),
                    from_port: 0,
                    to_node: NodeIdx(2),
                    to_port: 0,
                    kind: ojproto::ConnectionType::Audio,
                },
            ],
            schedule: vec![],
        };
        let prog = compile(&graph, &reg).expect("graph compiles");
        let mut engine = Engine::new(prog);
        if let Some(buf) = engine.input_mut(NodeIdx(0), 0) {
            for s in buf.iter_mut() {
                *s = 0.5;
            }
        }
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        for &s in out.iter() {
            assert!((s - 0.5).abs() < 1e-6, "passthrough should preserve input");
        }
    }

    /// A master sink honours its `volume` / `mute` params via `master_gain`; a
    /// non-master kind ignores the same param ids (its gain stays unity).
    #[test]
    fn master_sink_volume_and_mute_drive_master_gain() {
        let mut speaker = StructuralNode::new(PrimitiveKind::SpeakerOut);
        assert_eq!(speaker.master_gain(), 1.0, "default master gain is unity");

        speaker.set_param(master_param::VOLUME, 0.25);
        assert!((speaker.master_gain() - 0.25).abs() < 1e-9);

        speaker.set_param(master_param::MUTE, 1.0);
        assert_eq!(speaker.master_gain(), 0.0, "mute forces gain to zero");

        speaker.set_param(master_param::MUTE, 0.0);
        assert!(
            (speaker.master_gain() - 0.25).abs() < 1e-9,
            "unmute restores the prior volume"
        );

        // A negative volume clamps to zero rather than inverting phase.
        speaker.set_param(master_param::VOLUME, -1.0);
        assert_eq!(speaker.master_gain(), 0.0);

        // Non-master kinds ignore the master params entirely.
        let mut add = StructuralNode::new(PrimitiveKind::Add);
        add.set_param(master_param::VOLUME, 0.1);
        add.set_param(master_param::MUTE, 1.0);
        assert_eq!(add.master_gain(), 1.0, "non-master gain stays unity");
    }
}
