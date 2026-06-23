//! The hosted plugin as an ojcore node — "everything is a plugin".
//!
//! [`HostedPlugin`] is the safe Rust handle to a loaded third-party plugin.
//! [`PluginHostNode`] wraps it as an [`ojcore::DspInstance`] so the engine drives
//! a VST3/CLAP/AU plugin through the exact same `activate / process / set_param /
//! note_on / note_off` surface as a built-in node. [`PluginHostLoader`] is the
//! [`ojcore::PluginLoader`] registered under manifest id `host.plugin`, lowering
//! to [`ojproto::PrimitiveKind::PluginHost`].
//!
//! Latency: the plugin's reported [`HostedPlugin::latency_samples`] is exposed so
//! a later PDC / Live-Monitoring unit can enforce a budget; it is authoritative
//! after [`DspInstance::activate`].

use std::sync::Mutex;

use ojcore::{DspInstance, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx};
use ojcore::{DspKind, UiKind};
use ojproto::PrimitiveKind;

use crate::backend::{self, HostedBackend};
use crate::descriptor::PluginDescriptor;
use crate::error::HostError;

/// Historical/base hosted-plugin id prefix. Concrete hosted plugins register
/// under `host.plugin.<format>.<hash>` so multiple scanned plugins coexist in the
/// registry instead of overwriting each other.
pub const PLUGIN_HOST_ID: &str = "host.plugin";

/// Build the stable manifest id for one scanned hosted plugin.
pub fn hosted_plugin_id(desc: &PluginDescriptor) -> String {
    let key = format!("{}\0{}\0{}", desc.format.slug(), desc.uid, desc.path);
    format!("{PLUGIN_HOST_ID}.{}.{}", desc.format.slug(), fnv1a32_hex(key.as_bytes()))
}

fn fnv1a32_hex(bytes: &[u8]) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for b in bytes {
        hash ^= u32::from(*b);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// A loaded, processable third-party plugin. The safe wrapper over a
/// backend-specific [`HostedBackend`]. Construct via [`HostedPlugin::load`].
pub struct HostedPlugin {
    backend: Box<dyn HostedBackend>,
    descriptor: PluginDescriptor,
}

/// A native top-level editor window for a hosted plugin. This is control/UI-rate
/// only and intentionally separate from the audio-thread DSP instance.
pub struct PluginEditor {
    backend: Box<dyn backend::EditorBackend>,
}

impl PluginEditor {
    pub fn open(desc: &PluginDescriptor) -> Result<Self, HostError> {
        Ok(Self {
            backend: backend::open_editor(desc)?,
        })
    }

    pub fn focus(&mut self) {
        self.backend.focus();
    }

    pub fn close(&mut self) {
        self.backend.close();
    }
}

impl HostedPlugin {
    /// Load and activate the plugin described by `desc` at `sample_rate` /
    /// `max_block`. Returns [`HostError::Unavailable`] in the scaffold build (no
    /// hosting backend compiled in).
    pub fn load(
        desc: &PluginDescriptor,
        sample_rate: f32,
        max_block: usize,
    ) -> Result<Self, HostError> {
        let backend = backend::open(desc, sample_rate, max_block)?;
        Ok(Self {
            backend,
            descriptor: desc.clone(),
        })
    }

    /// The static descriptor this plugin was loaded from.
    pub fn descriptor(&self) -> &PluginDescriptor {
        &self.descriptor
    }

    /// The plugin's reported processing latency in samples (for PDC). Valid
    /// after load (which activates the backend).
    pub fn latency_samples(&self) -> u32 {
        self.backend.latency_samples()
    }
}

/// An [`ojcore::DspInstance`] backed by a hosted third-party plugin.
///
/// The engine activates this with the run's sample rate + block size, then calls
/// `process` per block on the audio thread. The wrapped backend pre-allocated
/// all scratch at load/activate, so `process` is allocation-free.
pub struct PluginHostNode {
    plugin: HostedPlugin,
}

impl PluginHostNode {
    /// Wrap an already-loaded [`HostedPlugin`] as a DSP node.
    pub fn new(plugin: HostedPlugin) -> Self {
        Self { plugin }
    }

    /// Plugin-reported latency in samples (for PDC budget enforcement).
    pub fn latency_samples(&self) -> u32 {
        self.plugin.latency_samples()
    }
}

impl DspInstance for PluginHostNode {
    fn activate(&mut self, sample_rate: f32, max_block: usize) {
        self.plugin.backend.activate(sample_rate, max_block);
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Forward the engine's channel-major buffers straight through; the
        // backend copies into its pre-allocated scratch internally (RT-safe).
        self.plugin
            .backend
            .process(ctx.inputs, ctx.outputs, ctx.nframes);
    }

    fn set_param(&mut self, id: u16, value: f32) {
        self.plugin.backend.set_param(id, value);
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        self.plugin.backend.note_on(note, vel);
    }

    fn note_off(&mut self, note: u8) {
        self.plugin.backend.note_off(note);
    }

    fn deactivate(&mut self) {
        self.plugin.backend.deactivate();
    }
}

/// A [`PluginLoader`] that mints [`PluginHostNode`]s for ONE scanned plugin.
///
/// Each scanned [`PluginDescriptor`] produces one loader under a stable unique
/// manifest id (`host.plugin.<format>.<hash>`) and lowers to
/// [`PrimitiveKind::PluginHost`] (the closed kind), per "everything is a plugin".
/// The manifest's name/ports reflect the specific plugin so the UI can label and
/// wire it.
///
/// `instantiate` loads the real plugin off the RT thread. If loading fails (no
/// backend in the scaffold build, or a bad plugin), it falls back to a silent
/// [`PassthroughNode`] so the graph still compiles and runs — the engine never
/// panics on a missing plugin.
pub struct PluginHostLoader {
    manifest: PluginManifest,
    descriptor: PluginDescriptor,
    /// Captures the last load error for diagnostics (off-RT only).
    last_error: Mutex<Option<String>>,
}

impl PluginHostLoader {
    /// Build a loader for a specific scanned plugin.
    pub fn new(descriptor: PluginDescriptor) -> Self {
        // Prefer the detailed param list (real names + the plugin's own ranges)
        // the backend captured at scan; fall back to generic index-named params
        // when only a count is known (the JUCE backend, or an older scan cache).
        let params: Vec<ParamDecl> = if descriptor.params.is_empty() {
            (0..descriptor.param_count.min(u16::MAX as u32) as u16)
                .map(|i| ParamDecl {
                    id: i,
                    name: alloc_param_name(i),
                    min: 0.0,
                    max: 1.0,
                    default: 0.0,
                })
                .collect()
        } else {
            descriptor
                .params
                .iter()
                .take(u16::MAX as usize)
                .enumerate()
                .map(|(i, p)| ParamDecl {
                    id: i as u16,
                    name: p.name.clone(),
                    min: p.min as f32,
                    max: p.max as f32,
                    default: p.default as f32,
                })
                .collect()
        };
        let manifest = PluginManifest {
            abi: None,
            id: hosted_plugin_id(&descriptor),
            name: descriptor.name.clone(),
            kind: PrimitiveKind::PluginHost,
            dsp: DspKind::None, // hosting is native-only; not one of builtin/faust/wasm
            ui: UiKind::Auto,
            params,
            ports: PortDecl {
                // ONE audio port per side that carries the plugin's channel count
                // (docs/CHANNELS.md model B: a stereo cable is one connection of N
                // channels, not N mono ports). A stereo reverb is one stereo-in +
                // one stereo-out port. The compiler multiplies `audio_*_channels`
                // into render lanes (`compile.rs`: lanes = n_out × out_channels),
                // and the JUCE/CLAP backends already copy exactly that many planar
                // channels from the descriptor's layout — so the reshape is the only
                // change needed to host a real stereo plugin in stereo.
                audio_in: (descriptor.ports.audio_in > 0) as u8,
                audio_out: (descriptor.ports.audio_out > 0) as u8,
                control_in: 0,
                control_out: 0,
                audio_in_channels: descriptor.ports.audio_in.min(u8::MAX as u16) as u8,
                audio_out_channels: descriptor.ports.audio_out.min(u8::MAX as u16) as u8,
            },
        };
        Self {
            manifest,
            descriptor,
            last_error: Mutex::new(None),
        }
    }

    /// The descriptor this loader hosts.
    pub fn descriptor(&self) -> &PluginDescriptor {
        &self.descriptor
    }

    /// The last load error string, if any (off-RT diagnostics).
    pub fn last_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|g| g.clone())
    }
}

impl PluginLoader for PluginHostLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, max_block: usize) -> Box<dyn DspInstance> {
        match HostedPlugin::load(&self.descriptor, sample_rate, max_block) {
            Ok(plugin) => Box::new(PluginHostNode::new(plugin)),
            Err(e) => {
                if let Ok(mut slot) = self.last_error.lock() {
                    *slot = Some(e.to_string());
                }
                // Graceful degradation: a silent passthrough keeps the graph
                // runnable when the plugin can't load (scaffold build / bad
                // plugin), instead of panicking on the audio path.
                Box::new(PassthroughNode)
            }
        }
    }
}

/// Build a `name` for an automatable param the host exposes only by index.
fn alloc_param_name(i: u16) -> String {
    format!("param{i}")
}

/// A do-nothing node: copies input to output (or silences when channel counts
/// mismatch). Used as the fallback when a hosted plugin can't be loaded, so the
/// engine still runs.
struct PassthroughNode;

impl DspInstance for PassthroughNode {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        for (out_idx, out) in ctx.outputs.iter_mut().enumerate() {
            if let Some(input) = ctx.inputs.get(out_idx) {
                let out_len = out.len();
                let n = ctx.nframes.min(input.len()).min(out_len);
                out[..n].copy_from_slice(&input[..n]);
                let tail = ctx.nframes.min(out_len);
                for s in out[n..tail].iter_mut() {
                    *s = 0.0;
                }
            } else {
                for s in out.iter_mut().take(ctx.nframes) {
                    *s = 0.0;
                }
            }
        }
    }

    fn set_param(&mut self, _id: u16, _value: f32) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::descriptor::{PluginFormat, PortCounts};

    fn sample_desc(params: u32) -> PluginDescriptor {
        PluginDescriptor {
            uid: "com.acme.synth".into(),
            name: "Acme Synth".into(),
            vendor: "Acme".into(),
            path: "/plugins/AcmeSynth.clap".into(),
            format: PluginFormat::Clap,
            is_instrument: true,
            ports: PortCounts {
                audio_in: 0,
                audio_out: 2,
            },
            param_count: params,
            params: Vec::new(),
            latency_samples: 128,
        }
    }

    #[test]
    fn loader_manifest_lowers_to_plugin_host() {
        let desc = sample_desc(3);
        let expected_id = hosted_plugin_id(&desc);
        let loader = PluginHostLoader::new(desc);
        let m = loader.manifest();
        assert_eq!(m.id, expected_id);
        assert_eq!(m.kind, PrimitiveKind::PluginHost);
        assert_eq!(m.name, "Acme Synth");
        // A 2-out instrument is ONE stereo output port carrying 2 channels (model
        // B), not two mono ports — so the compiler derives 1 × 2 = 2 output lanes.
        assert_eq!(m.ports.audio_out, 1, "one audio-out port per side");
        assert_eq!(m.ports.audio_out_channels, 2, "carrying the plugin's 2 channels");
        assert_eq!(m.ports.audio_in, 0, "an instrument has no audio input");
        assert_eq!(m.params.len(), 3);
    }

    #[test]
    fn instantiate_in_scaffold_falls_back_to_passthrough() {
        // With no hosting backend (scaffold build), instantiate must NOT panic:
        // it returns a silent passthrough and records the load error.
        let loader = PluginHostLoader::new(sample_desc(0));
        let mut node = loader.instantiate(48_000.0, 64);
        node.activate(48_000.0, 64);

        // Process a block through the fallback: instrument has 0 inputs -> out
        // is silenced.
        let mut out_l = vec![1.0f32; 64];
        let mut out_r = vec![1.0f32; 64];
        {
            let ins: [&[f32]; 0] = [];
            let mut outs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: 64,
            };
            node.process(&mut ctx);
        }
        assert!(out_l.iter().all(|&s| s == 0.0), "fallback silences output");

        // The load error was captured (only meaningful in the scaffold build).
        #[cfg(not(any(feature = "clap-host", feature = "juce")))]
        {
            let err = loader.last_error().expect("scaffold records Unavailable");
            assert!(err.contains("unavailable"), "got: {err}");
        }
    }

    #[test]
    fn passthrough_copies_input_to_output() {
        let mut node = PassthroughNode;
        let input: Vec<f32> = (0..64).map(|i| i as f32 * 0.01).collect();
        let mut out = vec![0.0f32; 64];
        {
            let ins: [&[f32]; 1] = [&input];
            let mut outs: [&mut [f32]; 1] = [&mut out];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: 64,
            };
            node.process(&mut ctx);
        }
        assert_eq!(out, input);
    }

    #[test]
    fn hosted_plugin_load_is_unavailable_in_scaffold() {
        // Gated load behind the real backend; in the scaffold this returns
        // Unavailable rather than instantiating anything.
        #[cfg(not(any(feature = "clap-host", feature = "juce")))]
        {
            let res = HostedPlugin::load(&sample_desc(0), 48_000.0, 64);
            assert!(matches!(res, Err(HostError::Unavailable)));
        }
    }
}
