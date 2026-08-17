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
use std::time::Duration;

use ojcore::{DspInstance, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx};
use ojcore::{DspKind, ExtId, LatencyExt, StateSave, TailExt, UiKind};
use ojproto::PrimitiveKind;

use crate::backend::{self, HostedBackend, HostedEvent, ParamGesture};
use crate::descriptor::PluginDescriptor;
use crate::error::HostError;

/// Historical/base hosted-plugin id prefix. Concrete hosted plugins register
/// under `host.plugin.<format>.<hash>` so multiple scanned plugins coexist in the
/// registry instead of overwriting each other.
pub const PLUGIN_HOST_ID: &str = "host.plugin";

/// Build the stable manifest id for one scanned hosted plugin.
pub fn hosted_plugin_id(desc: &PluginDescriptor) -> String {
    let key = format!("{}\0{}\0{}", desc.format.slug(), desc.uid, desc.path);
    format!(
        "{PLUGIN_HOST_ID}.{}.{}",
        desc.format.slug(),
        fnv1a32_hex(key.as_bytes())
    )
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
/// backend-specific implementation. Construct via [`HostedPlugin::load`].
pub struct HostedPlugin {
    backend: Box<dyn HostedBackend>,
    descriptor: PluginDescriptor,
    output_faulted: bool,
}

/// Opaque plugin state paired with a deterministic content address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostedStateBlob {
    pub bytes: Vec<u8>,
    pub content_hash: String,
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
    /// Load and activate on a disposable control worker, bounded by `timeout`.
    /// The audio thread never waits for main-thread plugin work. Rust cannot
    /// safely kill a thread stuck in foreign activation code, so a timed-out
    /// worker is detached and its instance is discarded if it eventually
    /// returns; process isolation is required to reclaim a permanently wedged
    /// activation call.
    pub fn load_with_activation_timeout(
        desc: &PluginDescriptor,
        sample_rate: f32,
        max_block: usize,
        timeout: Duration,
    ) -> Result<Self, HostError> {
        let descriptor = desc.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("ojhost-activate".into())
            .spawn(move || {
                let result = Self::load(&descriptor, sample_rate, max_block).map(|mut plugin| {
                    plugin.activate(sample_rate, max_block);
                    plugin
                });
                let _ = tx.send(result);
            })
            .map_err(|error| HostError::Load {
                message: format!("failed to spawn activation worker: {error}"),
            })?;
        rx.recv_timeout(timeout).map_err(|_| HostError::Load {
            message: format!("plugin activation exceeded {} ms", timeout.as_millis()),
        })?
    }

    /// Instantiate the plugin described by `desc`, leaving it inactive so state
    /// can be restored before [`HostedPlugin::activate`]. Returns
    /// [`HostError::Unavailable`] in the scaffold build (no
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
            output_faulted: false,
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

    pub fn activate(&mut self, sample_rate: f32, max_block: usize) {
        self.backend.activate(sample_rate, max_block);
    }

    pub fn start_processing(&mut self) {
        self.backend.start_processing();
    }

    pub fn stop_processing(&mut self) {
        self.backend.stop_processing();
    }

    pub fn deactivate(&mut self) {
        self.backend.deactivate();
    }

    pub fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
        self.backend.process(inputs, outputs, nframes);
        for output in outputs {
            let n = nframes.min(output.len());
            self.output_faulted |= ojcore::sanitize(&mut output[..n]);
        }
    }

    /// Consume the OutputGuard fault latch.
    pub fn take_output_fault(&mut self) -> bool {
        core::mem::take(&mut self.output_faulted)
    }

    pub fn queue_event(&mut self, event: HostedEvent) {
        self.backend.queue_event(event);
    }

    pub fn set_param(&mut self, id: u16, value: f32) {
        self.backend.set_param(id, value);
    }

    pub fn param_value_to_text(&mut self, id: u16, value: f64) -> Option<String> {
        self.backend.param_value_to_text(id, value)
    }

    pub fn param_text_to_value(&mut self, id: u16, text: &str) -> Option<f64> {
        self.backend.param_text_to_value(id, text)
    }

    pub fn take_param_gestures(&mut self) -> Vec<ParamGesture> {
        self.backend.take_param_gestures()
    }

    pub fn take_output_events(&mut self) -> Vec<HostedEvent> {
        self.backend.take_output_events()
    }

    pub fn take_descriptor_rescan_request(&self) -> bool {
        self.backend.take_descriptor_rescan_request()
    }

    pub fn tail_samples(&self) -> Option<u32> {
        self.backend.tail_samples()
    }

    pub fn save_state_blob(&self) -> HostedStateBlob {
        let bytes = self.backend.save_state();
        HostedStateBlob {
            content_hash: sha256_hex(&bytes),
            bytes,
        }
    }

    pub fn restore_state(&mut self, bytes: &[u8]) {
        self.backend.restore_state(bytes);
    }

    pub fn restore_state_checked(&mut self, bytes: &[u8]) -> bool {
        self.backend.restore_state_checked(bytes)
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(7 + hash.len() * 2);
    encoded.push_str("sha256:");
    for byte in hash {
        use std::fmt::Write;
        write!(&mut encoded, "{byte:02x}").expect("writing to String is infallible");
    }
    encoded
}

/// An [`ojcore::DspInstance`] backed by a hosted third-party plugin.
///
/// The engine activates this with the run's sample rate + block size, then calls
/// `process` per block on the audio thread. The wrapped backend pre-allocated
/// all scratch at load/activate, so `process` is allocation-free.
pub struct PluginHostNode {
    plugin: HostedPlugin,
    latency: LatencyExt,
    tail: TailExt,
    /// Latched `true` once the plugin faults (a segfault caught at the foreign-code
    /// boundary). From then on `process` runs a dry passthrough and never re-enters
    /// the plugin — the crash latch (mirrors `ojwasm`'s `bypassed`). Cleared only by
    /// a fresh `instantiate` on the next off-RT graph swap.
    faulted: bool,
    /// The host-boundary OutputGuard had to scrub or clamp foreign audio.
    output_faulted: bool,
}

impl PluginHostNode {
    /// Wrap an already-loaded [`HostedPlugin`] as a DSP node.
    pub fn new(plugin: HostedPlugin) -> Self {
        let latency = LatencyExt::new(plugin.latency_samples());
        let tail = TailExt::new(plugin.tail_samples());
        Self {
            plugin,
            latency,
            tail,
            faulted: false,
            output_faulted: false,
        }
    }

    /// Whether this instance has latched into the crash-fault passthrough. Off-RT
    /// diagnostic; the RT path reads the field directly (mirror of
    /// `WasmHostNode::is_bypassed`).
    pub fn is_faulted(&self) -> bool {
        self.faulted
    }

    /// Plugin-reported latency in samples (for PDC budget enforcement).
    pub fn latency_samples(&self) -> u32 {
        self.plugin.latency_samples()
    }
}

impl DspInstance for PluginHostNode {
    fn activate(&mut self, sample_rate: f32, max_block: usize) {
        self.plugin.backend.activate(sample_rate, max_block);
        self.latency = LatencyExt::new(self.plugin.latency_samples());
        self.tail = TailExt::new(self.plugin.tail_samples());
    }

    fn start_processing(&mut self) {
        self.plugin.backend.start_processing();
    }

    fn stop_processing(&mut self) {
        self.plugin.backend.stop_processing();
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Already crashed once -> never touch the foreign plugin again; hold a
        // guarded dry passthrough so the rest of the graph keeps playing.
        if self.faulted {
            dry_passthrough(ctx);
            return;
        }
        // Forward through the per-node fault boundary. The backend copies into its
        // pre-allocated scratch internally (RT-safe). A `true` return means the
        // plugin FAULTED this block: latch the crash, and hold a clean passthrough
        // for this block too (its output can't be trusted) — a held note beats a
        // glitch. We never re-enter the plugin this session (latch-and-quarantine).
        let faulted = self
            .plugin
            .backend
            .process_guarded(ctx.inputs, ctx.outputs, ctx.nframes);
        if faulted {
            self.faulted = true;
            dry_passthrough(ctx);
        } else {
            // The guard lives here, at the last point foreign samples exist
            // before joining the graph. NaN/Inf and denormals become zero;
            // excessive finite output is hard-clamped to +/-4 headroom.
            for output in ctx.outputs.iter_mut() {
                let n = ctx.nframes.min(output.len());
                if ojcore::sanitize(&mut output[..n]) {
                    self.output_faulted = true;
                }
            }
        }
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

    fn runtime_degraded(&self) -> bool {
        self.faulted
    }

    fn runtime_fault(&self) -> Option<ojproto::FaultKind> {
        self.output_faulted.then_some(ojproto::FaultKind::NonFinite)
    }

    /// Provide the `oj.state` capability (save half): a caller downcasts the
    /// returned `Any` to `&PluginHostNode` and calls [`StateSave::save`]. A faulted
    /// node keeps providing it (its last good state is still the backend's).
    fn extension(&self, id: ExtId) -> Option<&dyn core::any::Any> {
        match id {
            ExtId::Latency => Some(&self.latency),
            ExtId::State => Some(self),
            ExtId::Tail => Some(&self.tail),
            _ => None,
        }
    }

    /// Restore half of `oj.state`: push a prior session's blob into the plugin at
    /// construction (off-RT), so a reloaded project comes up exactly as left.
    fn restore_state(&mut self, blob: &[u8]) {
        self.plugin.backend.restore_state(blob);
    }

    fn deactivate(&mut self) {
        self.plugin.backend.deactivate();
    }
}

impl StateSave for PluginHostNode {
    fn save(&self) -> Vec<u8> {
        self.plugin.backend.save_state()
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
/// an internal passthrough node so the graph still compiles and runs — the engine never
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
                    module: String::new(),
                    unit: String::new(),
                    flags: 0,
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
                    module: p.module.clone(),
                    unit: p.unit.clone(),
                    flags: p.flags,
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
        match HostedPlugin::load_with_activation_timeout(
            &self.descriptor,
            sample_rate,
            max_block,
            Duration::from_millis(500),
        ) {
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

/// Copy each input channel to the matching output channel, silencing outputs with
/// no matching input. RT-safe (no alloc/lock): the dry passthrough used both when a
/// hosted plugin can't LOAD (the [`PassthroughNode`] fallback) and when one FAULTS
/// at runtime (the [`PluginHostNode`] crash latch).
fn dry_passthrough(ctx: &mut ProcessCtx<'_, '_>) {
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

/// A do-nothing node: copies input to output (or silences when channel counts
/// mismatch). Used as the fallback when a hosted plugin can't be loaded, so the
/// engine still runs.
struct PassthroughNode;

impl DspInstance for PassthroughNode {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        dry_passthrough(ctx);
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
            features: vec!["instrument".into()],
            has_gui: false,
            ports: PortCounts {
                audio_in: 0,
                audio_out: 2,
            },
            audio_ports: Vec::new(),
            port_configs: Vec::new(),
            note_ports: PortCounts::default(),
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
        assert_eq!(
            m.ports.audio_out_channels, 2,
            "carrying the plugin's 2 channels"
        );
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

    /// A backend that reports a guarded-process FAULT starting at its `fault_at`-th
    /// `process_guarded` call, standing in for a real crashing plugin so the crash
    /// latch is provable in the device-free sandbox. (The real-segfault path — the
    /// SEH/signal boundary actually catching a `processBlock` crash — is exercised
    /// by the `OJHOST_FAULT_INJECT=1` harness (env-gated, see build.rs): it compiles
    /// a one-shot null-deref into the guard, armed via `ojhost::arm_fault`, so the
    /// boundary can be PROVEN on a provisioned machine. That build still can't run
    /// here, hence this device-free stand-in.)
    struct FaultingBackend {
        calls: usize,
        fault_at: usize,
    }

    impl HostedBackend for FaultingBackend {
        fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

        fn process(&mut self, _inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
            // A healthy block writes a recognizable constant the test can detect.
            for out in outputs.iter_mut() {
                for s in out.iter_mut().take(nframes) {
                    *s = 0.5;
                }
            }
        }

        fn process_guarded(
            &mut self,
            inputs: &[&[f32]],
            outputs: &mut [&mut [f32]],
            nframes: usize,
        ) -> bool {
            self.calls += 1;
            if self.calls >= self.fault_at {
                // Simulate the foreign-code boundary catching a crash: the output is
                // garbage the latch MUST discard, and the fault is reported.
                for out in outputs.iter_mut() {
                    for s in out.iter_mut().take(nframes) {
                        *s = f32::NAN;
                    }
                }
                true
            } else {
                self.process(inputs, outputs, nframes);
                false
            }
        }

        fn set_param(&mut self, _id: u16, _value: f32) {}

        fn latency_samples(&self) -> u32 {
            0
        }
    }

    #[test]
    fn a_faulting_plugin_latches_to_passthrough_without_crashing_the_graph() {
        // The node hosts a backend that faults on its 2nd block. The fault must
        // latch the node to a dry passthrough — the app and the rest of the graph
        // keep running, and no garbage escapes ("a held note beats a glitch").
        let plugin = HostedPlugin {
            backend: Box::new(FaultingBackend {
                calls: 0,
                fault_at: 2,
            }),
            descriptor: sample_desc(0),
            output_faulted: false,
        };
        let mut node = PluginHostNode::new(plugin);
        node.activate(48_000.0, 64);

        let input: Vec<f32> = (0..64).map(|i| i as f32 * 0.01 - 0.3).collect();
        let run = |node: &mut PluginHostNode, input: &[f32]| -> Vec<f32> {
            let mut out = vec![0.0f32; 64];
            {
                let ins: [&[f32]; 1] = [input];
                let mut outs: [&mut [f32]; 1] = [&mut out];
                let mut ctx = ProcessCtx {
                    inputs: &ins,
                    outputs: &mut outs,
                    nframes: 64,
                };
                node.process(&mut ctx);
            }
            out
        };

        // Block 1: healthy -> the plugin's signal passes through, not latched.
        let b1 = run(&mut node, &input);
        assert!(!node.is_faulted(), "a healthy block must not latch");
        assert!(
            b1.iter().all(|&s| (s - 0.5).abs() < 1e-6),
            "the plugin's output passed through cleanly"
        );

        // Block 2: the plugin faults -> latch, and the block holds a CLEAN dry
        // passthrough of the input (the faulting NaN output is discarded).
        let b2 = run(&mut node, &input);
        assert!(node.is_faulted(), "a fault must latch the node");
        assert!(
            node.runtime_degraded(),
            "the off-RT poll reports the degrade"
        );
        assert!(b2.iter().all(|s| s.is_finite()), "no NaN escapes the latch");
        assert_eq!(b2, input, "the fault block holds a dry passthrough");

        // Block 3: stays latched, never re-enters the plugin, stays a passthrough.
        let b3 = run(&mut node, &input);
        assert!(node.is_faulted());
        assert_eq!(b3, input, "still a dry passthrough after latching");
    }

    /// A backend that round-trips an opaque state blob, standing in for a real
    /// plugin's getStateInformation/setStateInformation (or the CLAP state ext).
    struct StatefulBackend {
        blob: Vec<u8>,
    }

    impl HostedBackend for StatefulBackend {
        fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}
        fn process(&mut self, _inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
            for out in outputs.iter_mut() {
                for s in out.iter_mut().take(nframes) {
                    *s = 0.0;
                }
            }
        }
        fn set_param(&mut self, _id: u16, _value: f32) {}
        fn latency_samples(&self) -> u32 {
            0
        }
        fn save_state(&self) -> Vec<u8> {
            self.blob.clone()
        }
        fn restore_state(&mut self, blob: &[u8]) {
            self.blob = blob.to_vec();
        }
    }

    #[test]
    fn hosted_plugin_provides_the_oj_state_save_restore_seam() {
        // SAVE via the engine's path: extension(State) -> downcast -> StateSave::save.
        let node = PluginHostNode::new(HostedPlugin {
            backend: Box::new(StatefulBackend {
                blob: vec![9, 8, 7],
            }),
            descriptor: sample_desc(0),
            output_faulted: false,
        });
        let any = node
            .extension(ExtId::State)
            .expect("a hosted plugin provides oj.state");
        let saver = any
            .downcast_ref::<PluginHostNode>()
            .expect("downcasts to the node");
        assert_eq!(StateSave::save(saver), vec![9, 8, 7]);
        assert_eq!(
            node.extension(ExtId::Latency)
                .and_then(|ext| ext.downcast_ref::<LatencyExt>())
                .map(LatencyExt::latency_samples),
            Some(0)
        );

        // RESTORE into a fresh node via the &mut seam (what compile applies at load).
        let mut fresh = PluginHostNode::new(HostedPlugin {
            backend: Box::new(StatefulBackend { blob: Vec::new() }),
            descriptor: sample_desc(0),
            output_faulted: false,
        });
        fresh.restore_state(&[1, 2, 3]);
        let restored = fresh.extension(ExtId::State).unwrap();
        assert_eq!(
            StateSave::save(restored.downcast_ref::<PluginHostNode>().unwrap()),
            vec![1, 2, 3],
            "the blob restored into the fresh instance"
        );
    }
}
