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

#[cfg(feature = "wasmtime-host")]
mod backend;

#[cfg(feature = "native-host")]
mod native;
#[cfg(feature = "native-host")]
pub use native::{compile_faust_to_dll, native_dll_arity};

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

// ===========================================================================
// Runaway-kernel epoch guard (consumed by the wasmtime backend; defined here so it
// compiles + is unit-tested under the DEFAULT build, without the wasmtime dep).
// Gated to exactly the builds that use it (the feature backend, or tests) so it is
// never dead code in the dependency-free scaffold build.
// ===========================================================================

/// The watchdog tick period. A background thread bumps the wasmtime epoch every
/// `WATCHDOG_PERIOD`, so a hung kernel is pre-empted with this granularity. 500 µs
/// is fine enough to pre-empt within roughly one audio block on modern
/// high-resolution timers, yet coarse enough that the wakeup cost is negligible
/// (and on a platform that rounds sub-ms sleeps up, the only effect is a slightly
/// MORE generous deadline — it never false-trips more aggressively).
#[cfg(any(feature = "wasmtime-host", test))]
pub(crate) const WATCHDOG_PERIOD: std::time::Duration = std::time::Duration::from_micros(500);

/// A small fixed epoch budget used ONLY to bound a hostile module's
/// instantiation / `oj_init`, before any audio block period is known (~4 ms at the
/// 500 µs tick — generous for one-time off-RT setup, still bounded so a malicious
/// constructor cannot hang the control thread).
#[cfg(any(feature = "wasmtime-host", test))]
pub(crate) const INIT_EPOCH_BUDGET: u64 = 8;

/// Epoch ticks one realtime `oj_process` (or `oj_param`) may run before the
/// watchdog pre-empts it, derived from the ACTUAL block period.
///
/// A node's legitimate real-time budget is one block, so the deadline GUARANTEES
/// at least one full block of compute — `(ticks - 1)` whole tick periods, since up
/// to one tick may have already elapsed when the deadline is armed — and pre-empts
/// a genuine RUNAWAY (infinite loop) within ~1–1.5 blocks, whereupon the host
/// latches to a guarded dry passthrough (a held note, not a glitch).
///
/// This replaces a FIXED budget of 8 ticks at a 1 ms watchdog (~8 ms regardless of
/// block size — for a 32-frame block that was ~12× the block, and it EXCEEDED the
/// <5 ms RT budget it was meant to protect). It is deliberately ~1 block (not
/// 0.5×): a trap permanently bypasses the node instance, so the deadline must never
/// false-trip a legitimately heavy-but-terminating kernel.
#[cfg(any(feature = "wasmtime-host", test))]
pub(crate) fn epoch_budget_ticks(sample_rate: f32, max_block: usize) -> u64 {
    if !sample_rate.is_finite() || sample_rate <= 0.0 || max_block == 0 {
        return INIT_EPOCH_BUDGET;
    }
    let block_secs = max_block as f32 / sample_rate;
    let period_secs = WATCHDOG_PERIOD.as_secs_f32();
    // ceil(one block / tick) guarantees ≥1 block AFTER subtracting the 1-tick phase
    // slack baked in by the `+ 1`; floored at 2 so even a tiny block keeps slack.
    let ticks = (block_secs / period_secs).ceil() as u64 + 1;
    ticks.max(2)
}

#[cfg(test)]
mod epoch_tests {
    use super::*;

    #[test]
    fn degenerate_inputs_fall_back_to_init_budget() {
        assert_eq!(epoch_budget_ticks(0.0, 64), INIT_EPOCH_BUDGET);
        assert_eq!(epoch_budget_ticks(-1.0, 64), INIT_EPOCH_BUDGET);
        assert_eq!(epoch_budget_ticks(f32::NAN, 64), INIT_EPOCH_BUDGET);
        assert_eq!(epoch_budget_ticks(48_000.0, 0), INIT_EPOCH_BUDGET);
    }

    #[test]
    fn budget_scales_with_block_and_guarantees_one_block() {
        let period = WATCHDOG_PERIOD.as_secs_f32();
        for (sr, block) in [
            (48_000.0_f32, 32usize),
            (48_000.0, 64),
            (48_000.0, 256),
            (96_000.0, 128),
        ] {
            let ticks = epoch_budget_ticks(sr, block);
            let block_secs = block as f32 / sr;
            // The GUARANTEED compute window — (ticks - 1) whole periods — is at least
            // one full block, so a legitimate full-block kernel is never false-tripped.
            assert!(
                (ticks - 1) as f32 * period >= block_secs,
                "sr={sr} block={block}: {ticks} ticks must guarantee >= one block",
            );
            assert!(ticks >= 2, "phase-slack floor");
        }
    }

    #[test]
    fn budget_is_far_tighter_than_the_old_fixed_8ms() {
        // The old fixed budget stalled ~8 ms; the new per-block deadline for a small
        // live block is a small fraction of that.
        let ticks = epoch_budget_ticks(48_000.0, 64); // 1.33 ms block
        let worst_case_ms = ticks as f32 * WATCHDOG_PERIOD.as_secs_f32() * 1000.0;
        assert!(
            worst_case_ms < 5.0,
            "preemption {worst_case_ms} ms must beat the 5 ms RT budget"
        );
    }
}
