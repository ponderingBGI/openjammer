//! `ojwasm` — the native realtime host for OpenJammer **code nodes**.
//!
//! An AI- (or hand-) authored DSP code node is a single import-free `wasm32`
//! module obeying the `oj_*` ABI in `docs/code-node-abi.md`. This crate runs such
//! a module behind ojcore's [`ojcore::DspInstance`] trait so it is just another
//! node — minting a [`WasmHostLoader`] (a [`ojcore::PluginLoader`] that lowers to
//! [`ojproto::PrimitiveKind::WasmHost`]) whose `instantiate` produces a
//! [`WasmHostNode`]. The node funnels every output sample through the permanent
//! [`ojcore_dsp::guards::OutputGuard`] chain — *outside* the wasm sandbox, so an
//! untrusted kernel can never disable it — and bypasses to a guarded dry
//! passthrough if the kernel traps or blows its realtime deadline (never panics
//! on the audio thread).
//!
//! ## Native-only + feature-gated
//!
//! `wasmtime` is native-only and MUST NEVER enter the wasm32 AudioWorklet build
//! (`ojcore` / `ojcore-dsp` / `ojcore-wasm` stay wasm-clean). It is gated behind
//! the `wasmtime-host` feature; the default build is a dependency-free SCAFFOLD in
//! which `instantiate` yields a guarded passthrough. The loader/registry bridge,
//! the content-addressed [`WasmStore`], and the RT transpose + guard + bypass
//! logic are all present and unit-tested in the scaffold via a synthetic
//! [`Kernel`]; only the wasmtime instance that runs a real `.wasm` is gated.
//!
//! ## RT contract
//!
//! [`DspInstance::process`](ojcore::DspInstance::process) runs on the audio thread
//! and never allocates, locks, or blocks: all scratch is sized in `activate`, the
//! wasm instance is built off-RT, and a trap is handled as ordinary control flow.

mod node;
mod store;

pub use node::{register_wasm, WasmHostLoader, WasmHostNode};
pub use store::{fnv1a_hex, wasm_id_for, WasmStore, WasmStoreError};

/// An off-RT-constructed, RT-driven DSP kernel: one instance of an import-free
/// `oj_*`-ABI wasm module. Abstracted behind a trait so the host's RT logic (the
/// channel-major ↔ interleaved transpose, the [`OutputGuard`](ojcore_dsp::guards::OutputGuard)
/// chain, and trap bypass) is exercised in tests WITHOUT wasmtime, and so an
/// alternate backend could supply a different kernel.
///
/// Buffers are HOST-side **interleaved** `f32` (frame-major index
/// `frame * channels + channel`), `n` frames long. The kernel copies them in and
/// out of its own linear memory.
pub trait Kernel: Send {
    /// Off-RT: initialize DSP state for `sample_rate` + `max_block` (the wasm
    /// `oj_init`). Grows linear memory once to the worst case; never again.
    fn init(&mut self, sample_rate: f32, max_block: usize);

    /// RT hot path: read `n` interleaved input frames from `input`
    /// (`n * audio_in` samples) and write `n` interleaved output frames into
    /// `output` (`n * audio_out` samples). MUST NOT allocate. Returns
    /// [`KernelTrap`] if the kernel trapped or exceeded its realtime epoch
    /// deadline — the host then bypasses to a guarded dry passthrough.
    fn process(&mut self, input: &[f32], output: &mut [f32], n: usize) -> Result<(), KernelTrap>;

    /// Control-rate parameter write (the wasm `oj_param`): set parameter `idx`
    /// (its declared [`ojcore::ParamDecl::id`]) to `value`.
    fn param(&mut self, idx: u16, value: f32);
}

/// The kernel trapped or exceeded its realtime epoch deadline during `process`.
/// Carried as ordinary control flow — the audio thread NEVER panics on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KernelTrap;
