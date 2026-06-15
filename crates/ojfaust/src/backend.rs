//! Backend dispatch for [`crate::FaustCompiler::compile`].
//!
//! Exactly one of the two `compile` definitions below is compiled, selected by
//! the `libfaust` Cargo feature:
//!
//! * feature OFF (default): the [`stub`] — returns [`FaustError::Unavailable`].
//! * feature ON: the [`native`] backend — a TODO-marked scaffold of the real
//!   binding (libfaust C API via bindgen, OR the `faust` CLI AOT path). It is
//!   intentionally `unimplemented!()` for now; see `README.md` for the install
//!   prerequisites and the chosen-path decision.

use crate::{CompiledFaust, CompilerConfig, FaustError};

#[cfg(not(feature = "libfaust"))]
pub(crate) fn compile(
    _cfg: &CompilerConfig,
    _dsp_source: &str,
) -> Result<CompiledFaust, FaustError> {
    stub::compile(_cfg, _dsp_source)
}

#[cfg(feature = "libfaust")]
pub(crate) fn compile(
    cfg: &CompilerConfig,
    dsp_source: &str,
) -> Result<CompiledFaust, FaustError> {
    native::compile(cfg, dsp_source)
}

// ---------------------------------------------------------------------------
// Stub backend (default).
// ---------------------------------------------------------------------------
#[cfg(not(feature = "libfaust"))]
mod stub {
    use super::*;

    /// No backend compiled in: every compile is terminally unavailable.
    ///
    /// This keeps the crate buildable with zero native dependencies while the
    /// full API surface — including [`crate::compile_repair`] — stays exercisable.
    pub(super) fn compile(
        _cfg: &CompilerConfig,
        _dsp_source: &str,
    ) -> Result<CompiledFaust, FaustError> {
        Err(FaustError::Unavailable)
    }
}

// ---------------------------------------------------------------------------
// Native backend (feature = "libfaust").  SCAFFOLD ONLY — cannot be verified
// in this environment because libfaust is not installed.
// ---------------------------------------------------------------------------
#[cfg(feature = "libfaust")]
mod native {
    use super::*;

    /// Real Faust compilation. **TODO**: implement one of the two paths below.
    ///
    /// Both produce the same [`CompiledFaust`] shape so the rest of the crate is
    /// path-agnostic.
    pub(super) fn compile(
        cfg: &CompilerConfig,
        dsp_source: &str,
    ) -> Result<CompiledFaust, FaustError> {
        // -------------------------------------------------------------------
        // PATH A — libfaust C API via bindgen (in-process JIT).
        // -------------------------------------------------------------------
        // Add to Cargo.toml:
        //   [dependencies] libc = "0.2"
        //   [build-dependencies] bindgen = "0.71"
        // and a `build.rs` that:
        //   * `println!("cargo:rustc-link-lib=faust");`
        //   * `bindgen` over `<faust/dsp/llvm-dsp-c.h>` (the C facade) to get
        //     `createCDSPFactoryFromString`, `createCDSPInstance`,
        //     `getCDSPFactoryError`, `getNumInputsCDSPInstance`, etc.
        //
        // Sketch:
        //   let name = c_string(declared_name(dsp_source).unwrap_or("ojfaust"));
        //   let code = c_string(dsp_source);
        //   let mut err = [0i8; 4096];
        //   let factory = unsafe {
        //       ffi::createCDSPFactoryFromString(
        //           name.as_ptr(), code.as_ptr(),
        //           argc, argv,            // cfg.extra_args
        //           /*target*/ ptr::null(),
        //           err.as_mut_ptr(), /*opt*/ -1)
        //   };
        //   if factory.is_null() {
        //       return Err(FaustError::Compile { message: c_to_string(&err) });
        //   }
        //   let inst = unsafe { ffi::createCDSPInstance(factory) };
        //   let n_in  = unsafe { ffi::getNumInputsCDSPInstance(inst)  } as u8;
        //   let n_out = unsafe { ffi::getNumOutputsCDSPInstance(inst) } as u8;
        //   // ...stash the factory/instance handle on CompiledFaust (extend the
        //   //    struct) so an ojcore::PluginLoader can wrap it as a DspInstance.
        //
        // -------------------------------------------------------------------
        // PATH B — `faust` CLI, ahead-of-time (no in-process JIT).
        // -------------------------------------------------------------------
        // No bindgen/build.rs; shell out to the `faust` binary:
        //   faust -lang rust -o out.rs in.dsp        // -> Rust source, OR
        //   faust -lang wasm -o out.wasm in.dsp       // -> wasm for WasmHost
        // Capture stderr as the diagnostic for FaustError::Compile, parse the
        // generated metadata (or `faust -json`) for n_in/n_out, then compile /
        // load the artifact. This trades JIT latency for not linking libfaust.
        //
        // -------------------------------------------------------------------
        // Until one path is implemented, fail loudly so a `--features libfaust`
        // build can't masquerade as working.
        let _ = (cfg, dsp_source);
        unimplemented!(
            "ojfaust: `libfaust` feature is a scaffold; implement backend::native::compile \
             (see crate README for install + the Path A/Path B decision)"
        )
    }
}
