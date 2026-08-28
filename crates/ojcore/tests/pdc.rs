use ojcore::{
    compile, BuiltinOpts, DspInstance, ExtId, LatencyExt, PluginLoader, PluginManifest,
    PluginRegistry, ProcessCtx, SPEAKER_OUT_ID,
};
use ojcore::{DspKind, PortDecl, UiKind};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

const LATENCY_ID: &str = "test.latency";
const N: usize = 7;

struct LatencyNode {
    ext: LatencyExt,
    ring: Vec<f32>,
    pos: usize,
    delay: usize,
}

impl DspInstance for LatencyNode {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        let input = ctx.inputs.first().copied().unwrap_or(&[]);
        let Some(output) = ctx.outputs.first_mut() else {
            return;
        };
        for frame in 0..ctx.nframes.min(output.len()) {
            if self.delay == 0 {
                output[frame] = input.get(frame).copied().unwrap_or(0.0);
                continue;
            }
            output[frame] = self.ring[self.pos];
            self.ring[self.pos] = input.get(frame).copied().unwrap_or(0.0);
            self.pos = (self.pos + 1) % self.ring.len();
        }
    }

    fn set_param(&mut self, _id: u16, _value: f32) {}

    fn extension(&self, id: ExtId) -> Option<&dyn core::any::Any> {
        (id == ExtId::Latency).then_some(&self.ext)
    }
}

struct LatencyLoader {
    manifest: PluginManifest,
    samples: Arc<AtomicU32>,
}

impl LatencyLoader {
    fn new() -> Self {
        Self::with_samples(Arc::new(AtomicU32::new(N as u32)))
    }

    fn with_samples(samples: Arc<AtomicU32>) -> Self {
        Self {
            manifest: PluginManifest {
                abi: None,
                id: LATENCY_ID.into(),
                name: "Latency Stub".into(),
                kind: PrimitiveKind::Gain,
                dsp: DspKind::None,
                ui: UiKind::Auto,
                params: Vec::new(),
                ports: PortDecl {
                    audio_in: 1,
                    audio_out: 1,
                    control_in: 0,
                    control_out: 0,
                    audio_in_channels: 1,
                    audio_out_channels: 1,
                },
            },
            samples,
        }
    }
}

impl PluginLoader for LatencyLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        let delay = self.samples.load(Ordering::Acquire) as usize;
        Box::new(LatencyNode {
            ext: LatencyExt::new(delay as u32),
            ring: vec![0.0; delay.max(1)],
            pos: 0,
            delay,
        })
    }
}

#[test]
fn latency_change_recompile_publishes_new_pdc_program() {
    let reported = Arc::new(AtomicU32::new(0));
    let mut graph = OjGraph::empty(48_000, 32);
    graph.nodes = vec![
        node(0, ojcore::GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1),
        node(1, LATENCY_ID, PrimitiveKind::Gain, 1, 1),
        node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0),
    ];
    graph.edges = vec![edge(0, 1), edge(0, 2), edge(1, 2)];

    let mut registry = PluginRegistry::new();
    ojcore::register_builtins(&mut registry, BuiltinOpts::full());
    registry.register(Box::new(LatencyLoader::with_samples(Arc::clone(&reported))));
    let initial = compile(&graph, &registry).unwrap();
    assert_eq!(initial.preroll, 0);
    let mut engine = ojcore::Engine::new(initial);

    reported.store(11, Ordering::Release);
    let rescanned = compile(&graph, &registry).unwrap();
    assert_eq!(rescanned.preroll, 11);
    let swap = ojcore::ProgramSwap::new();
    swap.publish(rescanned);
    assert!(swap.install_into(&mut engine));
    assert_eq!(engine.program().preroll, 11);
    assert_eq!(engine.program().edge_delay.as_ref(), &[0, 11, 0]);
}

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

fn edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}

#[test]
fn parallel_latent_and_dry_paths_are_phase_aligned_at_master() {
    let mut graph = OjGraph::empty(48_000, 32);
    graph.nodes = vec![
        node(0, ojcore::GRAPH_IN_ID, PrimitiveKind::GraphIn, 0, 1),
        node(1, LATENCY_ID, PrimitiveKind::Gain, 1, 1),
        node(2, SPEAKER_OUT_ID, PrimitiveKind::SpeakerOut, 1, 0),
    ];
    graph.edges = vec![edge(0, 1), edge(0, 2), edge(1, 2)];

    let mut registry = PluginRegistry::new();
    ojcore::register_builtins(&mut registry, BuiltinOpts::full());
    registry.register(Box::new(LatencyLoader::new()));
    let program = compile(&graph, &registry).expect("parallel graph compiles");

    assert_eq!(program.preroll, N as u32);
    assert_eq!(program.edge_delay.as_ref(), &[0, N as u32, 0]);
    assert_eq!(
        program.to_master[program.slot_of_id(NodeIdx(1)).unwrap()],
        N as u32
    );

    let mut engine = ojcore::Engine::new(program);
    let input = engine.input_mut(NodeIdx(0), 0).unwrap();
    input.fill(0.0);
    input[0] = 0.25;
    let mut output = [0.0; 32];
    engine.process_block(&mut output, 32);

    assert!(output[..N].iter().all(|sample| *sample == 0.0));
    assert!(
        (output[N] - 0.5).abs() < 1e-5,
        "both paths arrive on the same master sample: {}",
        output[N]
    );
    assert!(output[N + 1..].iter().all(|sample| *sample == 0.0));
}
