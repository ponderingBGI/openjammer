//! Host-provided structural node loaders.
//!
//! `ojcore` ships exactly one reference DSP loader ([`ojcore::GainLoader`]). To
//! bootstrap a VALID engine, the wasm host needs at minimum a master-output node
//! to satisfy `compile`'s single-master-output rule. Rather than special-casing
//! it, this module provides one tiny [`StructuralLoader`] that mints a no-op
//! [`StructuralNode`] for any of the no-DSP "structural" primitive kinds
//! (`SpeakerOut`, `GraphOut`, `GraphIn`, `MicIn`, `Add`, `Passthrough`).
//!
//! These nodes carry no parameters and no DSP: the executor renders the I/O
//! kinds specially (it never calls their `process`), and for `Add`/`Passthrough`
//! the node simply forwards input 0 to output 0. Keeping them here (not in
//! `ojcore`) honours this unit's lane: it is the HOST that decides which
//! structural primitives its boundary exposes.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore::{DspInstance, PluginLoader, ProcessCtx};
use ojcore::{DspKind, PluginManifest, PortDecl, UiKind};
use ojproto::PrimitiveKind;

/// Manifest id of the host's master speaker-output sink.
pub const SPEAKER_OUT_ID: &str = "host.speaker_out";

/// Factory for a [`StructuralNode`] of a fixed [`PrimitiveKind`]. One loader
/// instance is registered per structural primitive the host exposes.
pub struct StructuralLoader {
    manifest: PluginManifest,
}

impl StructuralLoader {
    /// Build a loader for `kind` registered under `id`, declaring `audio_in` /
    /// `audio_out` ports. No params (structural nodes are not parameterized).
    pub fn new(id: &str, name: &str, kind: PrimitiveKind, audio_in: u8, audio_out: u8) -> Self {
        Self {
            manifest: PluginManifest {
                id: String::from(id),
                name: String::from(name),
                kind,
                dsp: DspKind::None,
                ui: UiKind::Auto,
                params: vec![],
                ports: PortDecl { audio_in, audio_out, control_in: 0, control_out: 0 },
            },
        }
    }

    /// The host's master speaker-output sink: one audio in, no audio out. Its
    /// resolved input becomes the engine's mono master output.
    pub fn speaker_out() -> Self {
        Self::new(SPEAKER_OUT_ID, "Speaker Out", PrimitiveKind::SpeakerOut, 1, 0)
    }
}

impl PluginLoader for StructuralLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(StructuralNode)
    }
}

/// A stateless no-op node. For the I/O kinds the executor handles specially this
/// `process` is never reached; for `Add`/`Passthrough` it forwards input 0 to
/// output 0. Allocation-free and panic-free on any channel arrangement.
pub struct StructuralNode;

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

    fn set_param(&mut self, _id: u16, _value: f32) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojcore::{compile, Engine, PluginRegistry};
    use ojproto::{IrEdge, IrNode, NodeIdx, OjGraph};

    /// A lone host `SpeakerOut` node compiles to a valid (silent) program — this
    /// is exactly what `init` relies on to start the engine before any graph.
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

    /// Gain feeding the speaker sink: the sink's resolved input is the master
    /// output, so the engine emits gain(input). Proves a real two-node graph
    /// using a host structural sink runs end to end.
    #[test]
    fn gain_into_speaker_out_routes_to_master() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(ojcore::GainLoader::new()));
        reg.register(Box::new(StructuralLoader::new(
            "host.graph_in",
            "Graph In",
            PrimitiveKind::GraphIn,
            0,
            1,
        )));
        reg.register(Box::new(StructuralLoader::speaker_out()));

        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: String::from("host.graph_in"),
                    kind: PrimitiveKind::GraphIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: String::from(ojcore::GAIN_ID),
                    kind: PrimitiveKind::Gain,
                    params: vec![ojproto::Param { id: ojcore::GAIN_PARAM, value: 2.0 }],
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

        // Inject a constant into the GraphIn source buffer, then render.
        if let Some(buf) = engine.input_mut(NodeIdx(0), 0) {
            for s in buf.iter_mut() {
                *s = 0.5;
            }
        }
        let mut out = vec![0.0f32; 64];
        engine.process_block(&mut out, 64);
        for &s in out.iter() {
            assert!((s - 1.0).abs() < 1e-3, "0.5 * gain(2.0) == 1.0, got {s}");
        }
    }
}
