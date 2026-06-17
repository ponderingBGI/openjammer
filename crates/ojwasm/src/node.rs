//! The code-node host as an ojcore node — "everything is a plugin".
//!
//! [`WasmHostLoader`] is the [`PluginLoader`] registered under an `ai.wasm.<hash>`
//! manifest id (lowering to [`PrimitiveKind::WasmHost`]); its `instantiate` mints
//! a [`WasmHostNode`], the [`DspInstance`] that drives one wasm [`Kernel`] and
//! wraps its output in the permanent guard chain. When execution is unavailable
//! (the scaffold build) or the module can't be built, `instantiate` falls back to
//! a guarded passthrough so the graph still compiles and runs — never a panic.

use std::path::PathBuf;

use ojcore::{DspInstance, DspKind, PluginLoader, PluginManifest, ProcessCtx, UiKind};
use ojcore_dsp::guards::OutputGuard;
use ojproto::PrimitiveKind;

use crate::Kernel;

/// A [`DspInstance`] backed by one wasm code-node [`Kernel`] (or a guarded
/// passthrough when `kernel` is `None`).
///
/// `process` deinterleaves the engine's channel-major input into the kernel's
/// interleaved scratch, runs the kernel, interleaves the result back, and then —
/// ALWAYS, in every path — funnels each output channel through its own
/// [`OutputGuard`] (scrub → DC-block → soft-limit). A kernel trap flips the node
/// to a guarded dry passthrough for the rest of this instance's life (recovery is
/// off-RT: a fresh `instantiate` on the next graph swap starts clean).
pub struct WasmHostNode {
    /// `None` => no executable kernel (scaffold build / failed build): passthrough.
    kernel: Option<Box<dyn Kernel>>,
    audio_in: usize,
    audio_out: usize,
    /// Interleaved input scratch, sized `max_block * audio_in` in `activate`.
    in_scratch: Vec<f32>,
    /// Interleaved output scratch, sized `max_block * audio_out` in `activate`.
    out_scratch: Vec<f32>,
    /// One guard per output channel (the DC blocker is stateful).
    guards: Vec<OutputGuard>,
    /// Latched true when the kernel traps; cleared only by a fresh `activate`.
    bypassed: bool,
}

impl WasmHostNode {
    /// Build a node around an optional kernel and its declared audio port counts.
    /// Scratch + guards are sized later in [`DspInstance::activate`].
    pub fn new(kernel: Option<Box<dyn Kernel>>, audio_in: usize, audio_out: usize) -> Self {
        Self {
            kernel,
            audio_in,
            audio_out,
            in_scratch: Vec::new(),
            out_scratch: Vec::new(),
            guards: Vec::new(),
            bypassed: false,
        }
    }

    /// Whether this instance has latched into bypass (kernel trapped). Off-RT
    /// diagnostic; the RT path reads the field directly.
    pub fn is_bypassed(&self) -> bool {
        self.bypassed
    }
}

impl DspInstance for WasmHostNode {
    fn activate(&mut self, sample_rate: f32, max_block: usize) {
        // All allocation happens HERE (off-RT). `process` never grows these.
        self.in_scratch = vec![0.0; max_block * self.audio_in];
        self.out_scratch = vec![0.0; max_block * self.audio_out];
        self.guards = (0..self.audio_out).map(|_| OutputGuard::new()).collect();
        self.bypassed = false;
        if let Some(kernel) = self.kernel.as_mut() {
            kernel.init(sample_rate, max_block);
        }
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Disjoint &mut borrows of the fields so we can touch the kernel and the
        // scratch buffers in the same block without a self-aliasing conflict.
        let Self {
            kernel,
            audio_in,
            audio_out,
            in_scratch,
            out_scratch,
            guards,
            bypassed,
        } = &mut *self;
        let n = ctx.nframes;
        let in_ch = *audio_in;
        let out_ch = *audio_out;
        let mut produced = false;

        if !*bypassed {
            if let Some(kernel) = kernel.as_mut() {
                // Deinterleave channel-major engine inputs → interleaved scratch.
                let in_len = (n * in_ch).min(in_scratch.len());
                let in_buf = &mut in_scratch[..in_len];
                for f in 0..n {
                    for ch in 0..in_ch {
                        let idx = f * in_ch + ch;
                        if idx < in_len {
                            in_buf[idx] = ctx
                                .inputs
                                .get(ch)
                                .and_then(|s| s.get(f))
                                .copied()
                                .unwrap_or(0.0);
                        }
                    }
                }
                let out_len = (n * out_ch).min(out_scratch.len());
                let out_buf = &mut out_scratch[..out_len];
                match kernel.process(in_buf, out_buf, n) {
                    Ok(()) => {
                        // Interleaved kernel output → channel-major engine outputs.
                        for (ch, out) in ctx.outputs.iter_mut().enumerate() {
                            let m = n.min(out.len());
                            if ch < out_ch {
                                for f in 0..m {
                                    let idx = f * out_ch + ch;
                                    out[f] = if idx < out_len { out_buf[idx] } else { 0.0 };
                                }
                            } else {
                                for s in out[..m].iter_mut() {
                                    *s = 0.0;
                                }
                            }
                        }
                        produced = true;
                    }
                    // Trap / deadline = control flow, NOT a panic: latch bypass.
                    Err(_) => *bypassed = true,
                }
            }
        }

        if !produced {
            // Guarded dry passthrough: copy matching input channels, silence the
            // rest (a generator with no inputs is silenced).
            for (ch, out) in ctx.outputs.iter_mut().enumerate() {
                let m = n.min(out.len());
                if let Some(input) = ctx.inputs.get(ch) {
                    let k = m.min(input.len());
                    out[..k].copy_from_slice(&input[..k]);
                    for s in out[k..m].iter_mut() {
                        *s = 0.0;
                    }
                } else {
                    for s in out[..m].iter_mut() {
                        *s = 0.0;
                    }
                }
            }
        }

        // ALWAYS guard the output, in every path, OUTSIDE the wasm sandbox.
        for (ch, guard) in guards.iter_mut().enumerate() {
            if let Some(out) = ctx.outputs.get_mut(ch) {
                let m = n.min(out.len());
                guard.process_buffer(&mut out[..m]);
            }
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        if let Some(kernel) = self.kernel.as_mut() {
            kernel.param(id, value);
        }
    }

    fn reset(&mut self) {
        // Reset the stateful guards so no DC tail bleeds across a (re)load. A
        // latched bypass is NOT cleared here: a trapped kernel stays bypassed
        // until a fresh `instantiate` (off-RT) replaces this instance.
        for guard in self.guards.iter_mut() {
            guard.reset();
        }
    }
}

/// A [`PluginLoader`] for ONE authored code node: it owns the node's
/// [`PluginManifest`] (id `ai.wasm.<hash>`, kind [`PrimitiveKind::WasmHost`]) and
/// its `.wasm` bytes, and mints [`WasmHostNode`]s.
///
/// `instantiate` builds the wasm kernel off the RT thread; if execution is
/// unavailable (scaffold build) or the module is rejected, it returns a guarded
/// passthrough node so the graph still compiles + runs.
pub struct WasmHostLoader {
    manifest: PluginManifest,
    wasm: Vec<u8>,
    /// `Some(dsp_struct_size)` when `wasm` is a `faust -lang wasm` module driven
    /// via faust's NATIVE ABI (see [`crate`] docs); `None` for an `oj_*` module.
    /// The size is faust's `-json` `"size"` (the dsp struct the host allocates).
    faust_dsp_size: Option<usize>,
    /// `Some(path)` when this node is backed by a compiled native faust `.dll`
    /// (the `native-host` path); takes precedence over the wasm sources.
    faust_dll: Option<PathBuf>,
}

impl WasmHostLoader {
    /// Build a loader for an `oj_*`-ABI module + its frozen-v1 manifest. The
    /// manifest's `kind` should be [`PrimitiveKind::WasmHost`] and `dsp`
    /// [`DspKind::Wasm`]; the audio port counts drive the host's scratch sizing.
    pub fn new(manifest: PluginManifest, wasm: Vec<u8>) -> Self {
        Self {
            manifest,
            wasm,
            faust_dsp_size: None,
            faust_dll: None,
        }
    }

    /// Build a loader for a `faust -lang wasm` module, driven via faust's native
    /// ABI by a `FaustWasmKernel`. `dsp_size` is faust's `-json` `"size"`.
    pub fn new_faust(manifest: PluginManifest, wasm: Vec<u8>, dsp_size: usize) -> Self {
        Self {
            manifest,
            wasm,
            faust_dsp_size: Some(dsp_size),
            faust_dll: None,
        }
    }

    /// Build a loader for a compiled native faust `.dll` (the `native-host` path:
    /// faust → C++ → cl.exe). Driven by a `NativeKernel`. NOT sandboxed — see
    /// `src/native.rs`.
    pub fn new_native(manifest: PluginManifest, dll_path: PathBuf) -> Self {
        Self {
            manifest,
            wasm: Vec::new(),
            faust_dsp_size: None,
            faust_dll: Some(dll_path),
        }
    }

    /// The `.wasm` bytes this loader hosts (off-RT diagnostics / re-hashing).
    pub fn wasm_bytes(&self) -> &[u8] {
        &self.wasm
    }
}

impl PluginLoader for WasmHostLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        let audio_in = self.manifest.ports.audio_in as usize;
        let audio_out = self.manifest.ports.audio_out as usize;
        // The kernel is built here (off-RT); buffer sizing + init run in activate.
        let kernel = if let Some(dll) = &self.faust_dll {
            build_native_kernel(dll)
        } else if let Some(dsp_size) = self.faust_dsp_size {
            build_faust_kernel(&self.wasm, dsp_size)
        } else {
            build_kernel(&self.wasm, audio_in, audio_out)
        };
        Box::new(WasmHostNode::new(kernel, audio_in, audio_out))
    }
}

/// Register a code-node loader for `manifest` + its `.wasm` `bytes` into `reg`.
/// Lowers to [`PrimitiveKind::WasmHost`]. Returns the displaced loader (same id),
/// if any (an identical re-authoring replaces it).
pub fn register_wasm(
    reg: &mut ojcore::PluginRegistry,
    manifest: PluginManifest,
    bytes: Vec<u8>,
) -> Option<Box<dyn PluginLoader>> {
    debug_assert_eq!(manifest.kind, PrimitiveKind::WasmHost);
    debug_assert_eq!(manifest.dsp, DspKind::Wasm);
    debug_assert_eq!(manifest.ui, UiKind::Auto);
    reg.register(Box::new(WasmHostLoader::new(manifest, bytes)))
}

/// Build a wasm [`Kernel`] from module `bytes`. The scaffold build has no wasmtime
/// and always returns `None` (→ guarded passthrough); the `wasmtime-host` feature
/// builds a real epoch-interruptible instance.
#[cfg(not(feature = "wasmtime-host"))]
fn build_kernel(_bytes: &[u8], _audio_in: usize, _audio_out: usize) -> Option<Box<dyn Kernel>> {
    None
}

#[cfg(feature = "wasmtime-host")]
fn build_kernel(bytes: &[u8], audio_in: usize, audio_out: usize) -> Option<Box<dyn Kernel>> {
    crate::backend::build_kernel(bytes, audio_in, audio_out)
}

/// Build a [`Kernel`] from a faust-native wasm module + its dsp struct size.
/// Scaffold build (no wasmtime) → `None` (guarded passthrough).
#[cfg(not(feature = "wasmtime-host"))]
fn build_faust_kernel(_bytes: &[u8], _dsp_size: usize) -> Option<Box<dyn Kernel>> {
    None
}

#[cfg(feature = "wasmtime-host")]
fn build_faust_kernel(bytes: &[u8], dsp_size: usize) -> Option<Box<dyn Kernel>> {
    crate::backend::build_faust_kernel(bytes, dsp_size)
}

/// Build a [`Kernel`] from a compiled native faust `.dll`. Scaffold build (no
/// `native-host`) → `None` (guarded passthrough).
#[cfg(not(feature = "native-host"))]
fn build_native_kernel(_dll: &std::path::Path) -> Option<Box<dyn Kernel>> {
    None
}

#[cfg(feature = "native-host")]
fn build_native_kernel(dll: &std::path::Path) -> Option<Box<dyn Kernel>> {
    crate::native::build_native_kernel(dll)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::KernelTrap;
    use ojcore::{ParamDecl, PortDecl};

    // -- synthetic kernels standing in for a real wasm instance ---------------

    /// Scales each interleaved sample by `gain` (mono in == mono out path).
    struct GainKernel {
        gain: f32,
    }
    impl Kernel for GainKernel {
        fn init(&mut self, _sr: f32, _mb: usize) {}
        fn process(
            &mut self,
            input: &[f32],
            output: &mut [f32],
            _n: usize,
        ) -> Result<(), KernelTrap> {
            let k = input.len().min(output.len());
            for i in 0..k {
                output[i] = input[i] * self.gain;
            }
            for s in output[k..].iter_mut() {
                *s = 0.0;
            }
            Ok(())
        }
        fn param(&mut self, _idx: u16, value: f32) {
            self.gain = value;
        }
    }

    /// Always traps — the host must bypass without panicking.
    struct TrapKernel;
    impl Kernel for TrapKernel {
        fn init(&mut self, _sr: f32, _mb: usize) {}
        fn process(&mut self, _i: &[f32], _o: &mut [f32], _n: usize) -> Result<(), KernelTrap> {
            Err(KernelTrap)
        }
        fn param(&mut self, _idx: u16, _value: f32) {}
    }

    /// Emits a poison value the guard chain must neutralize.
    struct PoisonKernel {
        value: f32,
    }
    impl Kernel for PoisonKernel {
        fn init(&mut self, _sr: f32, _mb: usize) {}
        fn process(&mut self, _i: &[f32], output: &mut [f32], _n: usize) -> Result<(), KernelTrap> {
            for s in output.iter_mut() {
                *s = self.value;
            }
            Ok(())
        }
        fn param(&mut self, _idx: u16, _value: f32) {}
    }

    fn mono_manifest(bytes: &[u8]) -> PluginManifest {
        PluginManifest {
            id: crate::wasm_id_for(bytes),
            name: "Test Code Node".into(),
            kind: PrimitiveKind::WasmHost,
            dsp: DspKind::Wasm,
            ui: UiKind::Auto,
            params: vec![ParamDecl {
                id: 0,
                name: "gain".into(),
                min: 0.0,
                max: 2.0,
                default: 1.0,
            }],
            ports: PortDecl {
                audio_in: 1,
                audio_out: 1,
                control_in: 0,
                control_out: 0,
            },
        }
    }

    /// Run one mono block through `node`, returning the output channel.
    fn run_block(node: &mut dyn DspInstance, input: &[f32]) -> Vec<f32> {
        let n = input.len();
        let mut out = vec![0.0f32; n];
        {
            let ins: [&[f32]; 1] = [input];
            let mut outs: [&mut [f32]; 1] = [&mut out];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: n,
            };
            node.process(&mut ctx);
        }
        out
    }

    /// A mid-band test tone — above the DC blocker's ~tens-of-Hz cutoff and below
    /// the soft-limit knee — so the permanent guard chain is near-transparent to
    /// it (a constant or very-low-freq signal would be high-passed away, which is
    /// correct guard behavior but useless for asserting host logic).
    fn tone(n: usize, amp: f32) -> Vec<f32> {
        (0..n).map(|i| libm::sinf(i as f32 * 0.7) * amp).collect()
    }

    fn energy(buf: &[f32]) -> f32 {
        buf.iter().map(|s| s * s).sum()
    }

    #[test]
    fn loader_manifest_lowers_to_wasm_host() {
        let bytes = b"\x00asm\x01\x00\x00\x00".to_vec();
        let loader = WasmHostLoader::new(mono_manifest(&bytes), bytes.clone());
        assert_eq!(loader.manifest().kind, PrimitiveKind::WasmHost);
        assert_eq!(loader.manifest().dsp, DspKind::Wasm);
        assert!(loader.manifest().id.starts_with("ai.wasm."));
        assert_eq!(loader.wasm_bytes(), bytes.as_slice());
    }

    #[test]
    fn scaffold_instantiate_is_guarded_passthrough() {
        // No wasmtime in the scaffold build → instantiate yields a node with no
        // kernel that passes the dry signal through (guarded), never silence/panic.
        let bytes = b"\x00asm".to_vec();
        let loader = WasmHostLoader::new(mono_manifest(&bytes), bytes);
        let mut node = loader.instantiate(48_000.0, 64);
        node.activate(48_000.0, 64);
        let input = tone(64, 0.3);
        let out = run_block(node.as_mut(), &input);
        assert!(out.iter().all(|s| s.is_finite()), "output finite");
        assert!(
            out.iter().all(|&s| s.abs() <= 0.999),
            "output guarded (limited)"
        );
        // The dry signal passes through (not silenced); the guard chain is
        // near-transparent to a mid-band tone, so energy is largely preserved.
        assert!(
            energy(&out) > 0.5 * energy(&input),
            "scaffold must pass the signal, not silence it",
        );
    }

    #[test]
    fn gain_kernel_scales_the_signal() {
        let input = tone(64, 0.2);
        let mut unity = WasmHostNode::new(Some(Box::new(GainKernel { gain: 1.0 })), 1, 1);
        unity.activate(48_000.0, 64);
        let mut doubled = WasmHostNode::new(Some(Box::new(GainKernel { gain: 2.0 })), 1, 1);
        doubled.activate(48_000.0, 64);

        let o1 = run_block(&mut unity, &input);
        let o2 = run_block(&mut doubled, &input);

        assert!(!doubled.is_bypassed());
        assert!(energy(&o1) > 0.0, "the kernel ran (output is non-silent)");
        // 2× amplitude ≈ 4× energy; assert a robust >2.5× to allow the soft knee.
        assert!(
            energy(&o2) > 2.5 * energy(&o1),
            "2× gain must raise output energy: e1={} e2={}",
            energy(&o1),
            energy(&o2),
        );
    }

    #[test]
    fn set_param_reaches_the_kernel() {
        let mut node = WasmHostNode::new(Some(Box::new(GainKernel { gain: 1.0 })), 1, 1);
        node.activate(48_000.0, 64);
        let loud = run_block(&mut node, &tone(64, 0.2));
        node.set_param(0, 0.25); // lower the gain via the param seam
        let quiet = run_block(&mut node, &tone(64, 0.2));
        assert!(
            energy(&quiet) < energy(&loud),
            "lowering gain via set_param must reduce output: loud={} quiet={}",
            energy(&loud),
            energy(&quiet),
        );
    }

    #[test]
    fn a_trapping_kernel_bypasses_to_passthrough_without_panic() {
        let mut node = WasmHostNode::new(Some(Box::new(TrapKernel)), 1, 1);
        node.activate(48_000.0, 64);
        let input = tone(64, 0.3);
        let out = run_block(&mut node, &input);
        // The trap is control flow, not a panic; bypass latches and the dry signal
        // passes through (guarded, finite) rather than emitting garbage.
        assert!(node.is_bypassed(), "a trap must latch bypass");
        assert!(
            out.iter().all(|s| s.is_finite()),
            "no NaN/garbage after a trap"
        );
        assert!(
            energy(&out) > 0.0,
            "bypass passes the dry signal, not silence"
        );
        // Still bypassed + finite on the next block.
        let out2 = run_block(&mut node, &input);
        assert!(node.is_bypassed());
        assert!(out2.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn output_guards_neutralize_nan_and_clamp_loudness() {
        // NaN in → 0 out (scrubbed); finite everywhere.
        let mut nan_node =
            WasmHostNode::new(Some(Box::new(PoisonKernel { value: f32::NAN })), 1, 1);
        nan_node.activate(48_000.0, 64);
        let out = run_block(&mut nan_node, &vec![0.0f32; 64]);
        assert!(out.iter().all(|s| s.is_finite()), "NaN must be scrubbed");

        // +2.0 in → soft-limited within ±0.999.
        let mut loud_node = WasmHostNode::new(Some(Box::new(PoisonKernel { value: 2.0 })), 1, 1);
        loud_node.activate(48_000.0, 64);
        let loud = run_block(&mut loud_node, &vec![0.0f32; 64]);
        assert!(
            loud.iter().all(|&s| s.abs() <= 0.999),
            "output must be limited"
        );
    }
}
