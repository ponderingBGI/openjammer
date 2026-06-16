//! OpenJammer plugin/extensibility ABI — the "everything is a plugin" seam.
//!
//! This crate defines the ONE [`PluginManifest`] every node type is described
//! by and the ONE CLAP-shaped [`DspInstance`] runtime trait every node type is
//! driven through. Built-in Rust DSP, Faust nodes, AI-WASM nodes, and hosted
//! plugins all implement these same two surfaces, so the engine treats them
//! uniformly:
//!
//! ```text
//!   PluginManifest (open id  ->  closed PrimitiveKind)   [manifest]
//!   PluginLoader   (manifest + factory)                  [loader]
//!   PluginRegistry (id -> loader, + lower(id))           [registry]
//!   DspInstance    (activate/process/set_param/...)      [dsp]
//!   GainLoader/GainNode  (reference built-in)            [builtin]
//! ```
//!
//! `no_std + alloc` so the very same ABI compiles into the native engine and
//! the `wasm32` AudioWorklet. A later unit (U4) ADDS `compile.rs` / `exec.rs` /
//! `command.rs` / `swap.rs` to this crate — keep the module list below as the
//! single wiring point so that lands as pure additions.
#![cfg_attr(not(test), no_std)]

extern crate alloc;

// The `std` feature pulls in host-side RT plumbing that needs real OS
// facilities (`Instant` for the U16 watchdog, threads/atomics for the rings).
// The crate is `no_std` by default, so link `std` explicitly when that feature
// is on; the `not(test)` guard avoids a double-link warning under `cargo test`,
// where `std` is already present.
#[cfg(all(feature = "std", not(test)))]
extern crate std;

pub mod builtin;
pub mod dsp;
pub mod loader;
pub mod manifest;
pub mod registry;

// --- U-COVERAGE built-in node set -------------------------------------------
// `effects` (biquad / waveshaper / delay / convolution) and `structural`
// (GraphIn / MicIn / GraphOut / SpeakerOut / Add / Passthrough) bring the
// built-in node set to PARITY across both engine targets. `register` is the ONE
// shared registration path both the native host and the wasm worklet call (via
// `ojinstrument::register_all`) — no hand-listed loaders, zero duplication. All
// stay `no_std` (alloc only) so they compile unchanged for the `wasm32` worklet.
pub mod effects;
pub mod register;
pub mod structural;

// --- U-STATEFUL: the built-in Looper -----------------------------------------
// `looper` is a stateful audio thru-node (record / play / overdub / clear) whose
// loop buffer is pre-allocated in `activate`; its `process` is allocation-free.
// It is `no_std` (alloc only) so it compiles unchanged for the `wasm32` worklet
// and is registered through the SAME shared `register_builtins` path.
pub mod looper;

// --- U4 engine core ---------------------------------------------------------
// `compile` + `exec` are the engine proper and stay `no_std` (alloc only) so
// they compile unchanged for the `wasm32` AudioWorklet. `command` (rtrb ring)
// and `swap` (basedrop + arc-swap graph hot-swap) need host atomics/threads and
// sit behind the `std` feature.
pub mod compile;
pub mod exec;

// --- U12/U15/U16 engine extensions ------------------------------------------
// `transport` (musical clock), `meter` (RMS/peak + return-frame codec), and
// `resilience` (NaN guard / coalescing / budget flags) are ADDITIVE and stay
// `no_std` (alloc only) so they compile for the `wasm32` worklet. The watchdog
// (`resilience::Watchdog`) and the meter return RING (`meter::MeterRing`) are
// the only `std`-gated pieces (they need `Instant` / host atomics).
pub mod meter;
pub mod resilience;
pub mod transport;

#[cfg(feature = "std")]
pub mod command;
#[cfg(feature = "std")]
pub mod swap;

// Re-export the CLOSED primitive set so downstream code lowers against a single
// path and never has to depend on `ojproto` directly just for `PrimitiveKind`.
pub use ojproto::PrimitiveKind;

pub use builtin::{GainLoader, GainNode, GAIN_ID, GAIN_PARAM};
pub use compile::{
    compile, compile_with_assets, AssetPcm, AssetResolver, CompileError, CompiledProgram, NoAssets,
    NodeRouting, Source,
};
pub use dsp::{DspInstance, ProcessCtx};
pub use exec::Engine;
pub use loader::PluginLoader;
pub use manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};
pub use registry::PluginRegistry;

// --- U-COVERAGE built-in set: effects, structural, and the shared registrar --
pub use effects::{
    BiquadLoader, BiquadNode, ConvolutionLoader, ConvolutionNode, DelayLoader, DelayNode,
    WaveshaperLoader, WaveshaperNode, BIQUAD_ID, CONVOLUTION_ID, DELAY_ID, WAVESHAPER_ID,
};
pub use register::{register_builtins, BuiltinOpts};

// --- U-STATEFUL: looper surface ---
pub use looper::{LooperLoader, LooperNode, LooperState, LOOPER_ID, MAX_LOOP_SECS};

pub use structural::{
    master_param, StructuralLoader, StructuralNode, ADD_ID, GRAPH_IN_ID, GRAPH_OUT_ID, MIC_IN_ID,
    PASSTHROUGH_ID, SPEAKER_OUT_ID,
};

// --- U12/U15/U16 additive surface ---
pub use meter::{Meter, MeterBank};
pub use resilience::{sanitize, CommandCoalescer, NodeBudget};
pub use transport::{Transport, TransportPos};

#[cfg(feature = "std")]
pub use command::{CommandConsumer, CommandProducer, CommandQueue};
#[cfg(feature = "std")]
pub use meter::MeterRing;
#[cfg(feature = "std")]
pub use resilience::Watchdog;
#[cfg(feature = "std")]
pub use swap::ProgramSwap;

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::boxed::Box;
    use alloc::vec;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 64;

    /// End-to-end proof: register the built-in gain, look it up, instantiate,
    /// process a block, and assert output == input * gain.
    #[test]
    fn gain_plugin_end_to_end() {
        let mut reg = PluginRegistry::new();
        reg.register(Box::new(GainLoader::new()));

        assert!(reg.contains(GAIN_ID));
        assert_eq!(reg.lower(GAIN_ID), Some(PrimitiveKind::Gain));

        let loader = reg.get(GAIN_ID).expect("gain registered");
        let mut node = loader.instantiate(SR, BLOCK);
        node.activate(SR, BLOCK);

        // `reset` snaps the smoother onto the target, so output == input * G
        // exactly from the very first frame (no ramp to wait out).
        const G: f32 = 2.0;
        node.set_param(GAIN_PARAM, G);
        node.reset();

        let input: alloc::vec::Vec<f32> = (0..BLOCK).map(|i| (i as f32) * 0.01 - 0.3).collect();
        let mut out = vec![0.0f32; BLOCK];

        {
            let ins: [&[f32]; 1] = [&input];
            let mut outs: [&mut [f32]; 1] = [&mut out];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: BLOCK,
            };
            node.process(&mut ctx);
        }

        for (i, &x) in input.iter().enumerate() {
            let expected = x * G;
            assert!(
                (out[i] - expected).abs() < 1e-3,
                "frame {i}: got {}, expected {expected}",
                out[i]
            );
        }

        node.deactivate();
    }

    /// Unity gain is a true passthrough.
    #[test]
    fn gain_unity_is_passthrough() {
        let loader = GainLoader::new();
        let mut node = loader.instantiate(SR, BLOCK);
        node.activate(SR, BLOCK);
        node.set_param(GAIN_PARAM, 1.0);

        let input: alloc::vec::Vec<f32> =
            (0..BLOCK).map(|i| ((i % 8) as f32 - 4.0) * 0.1).collect();
        let mut out = vec![0.0f32; BLOCK];
        let ins: [&[f32]; 1] = [&input];
        let mut outs: [&mut [f32]; 1] = [&mut out];
        let mut ctx = ProcessCtx {
            inputs: &ins,
            outputs: &mut outs,
            nframes: BLOCK,
        };
        node.process(&mut ctx);

        for (i, &x) in input.iter().enumerate() {
            assert!((out[i] - x).abs() < 1e-4, "frame {i} not passthrough");
        }
    }

    /// `process` with no channels must not panic (graceful RT degradation).
    #[test]
    fn gain_tolerates_empty_buffers() {
        let mut node = GainNode::new();
        node.activate(SR, BLOCK);
        let ins: [&[f32]; 0] = [];
        let mut outs: [&mut [f32]; 0] = [];
        let mut ctx = ProcessCtx {
            inputs: &ins,
            outputs: &mut outs,
            nframes: 0,
        };
        node.process(&mut ctx);
    }

    /// The manifest is the open key; `kind` is the closed lowering target.
    #[test]
    fn manifest_open_id_closed_kind() {
        let loader = GainLoader::new();
        let m = loader.manifest();
        assert_eq!(m.id, GAIN_ID);
        assert_eq!(m.kind, PrimitiveKind::Gain);
        assert_eq!(m.dsp, DspKind::Builtin);
        assert_eq!(m.ui, UiKind::Auto);
        assert_eq!(m.ports.audio_in, 1);
        assert_eq!(m.ports.audio_out, 1);
        assert_eq!(m.params.len(), 1);
        assert_eq!(m.params[0].id, GAIN_PARAM);
    }

    /// Registering the same id twice returns the prior loader (last wins).
    #[test]
    fn register_replaces_and_reports_prior() {
        let mut reg = PluginRegistry::new();
        assert!(reg.is_empty());
        assert!(reg.register(Box::new(GainLoader::new())).is_none());
        assert_eq!(reg.len(), 1);
        let prior = reg.register(Box::new(GainLoader::new()));
        assert!(prior.is_some());
        assert_eq!(reg.len(), 1);
        let ids: alloc::vec::Vec<&str> = reg.ids().collect();
        assert_eq!(ids, vec![GAIN_ID]);
    }

    /// Unknown ids lower to `None`.
    #[test]
    fn lower_unknown_is_none() {
        let reg = PluginRegistry::new();
        assert_eq!(reg.lower("does.not.exist"), None);
        assert!(!reg.contains("does.not.exist"));
    }
}
