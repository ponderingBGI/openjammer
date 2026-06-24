//! Native (dylib) faust execution backend (feature `native-host`).
//!
//! faust's `-lang wasm` output uses the wasm exception-handling proposal that
//! wasmtime 45 cannot run (see `docs/code-node-abi.md`), so the native path
//! compiles faust to native code instead: `faust -lang cpp` + a small `APIUI`
//! C-ABI wrapper → `cl.exe` → `.dll`, loaded via `libloading` and driven through
//! the same ABI-agnostic [`Kernel`] trait — so the host's [`OutputGuard`] chain
//! still wraps its output.
//!
//! ⚠ SECURITY: unlike the wasm host, native code is **not sandboxed** — there is no
//! epoch pre-emption and no memory isolation. The host `OutputGuard` (applied by
//! `WasmHostNode`, outside this kernel) still scrubs NaN / clipping / DC, but a
//! runaway or hostile native kernel can stall or crash the audio process. This is
//! the accepted trade-off for running faust natively until the wasm toolchain can
//! execute faust's exception wasm.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::process::Command;

use libloading::Library;

use crate::{Kernel, KernelTrap};

// The `oj_*` C ABI the faust wrapper (`WRAPPER_CPP`) exposes.
type NewFn = unsafe extern "C" fn() -> *mut c_void;
type InitFn = unsafe extern "C" fn(*mut c_void, i32);
type ComputeFn = unsafe extern "C" fn(*mut c_void, i32, *const *mut f32, *const *mut f32);
type ParamFn = unsafe extern "C" fn(*mut c_void, i32, f32);
type NumFn = unsafe extern "C" fn(*mut c_void) -> i32;
type DeleteFn = unsafe extern "C" fn(*mut c_void);

/// Build a [`Kernel`] from a compiled native faust `.dll`, or `None` if it can't
/// be loaded / lacks the `oj_*` exports → the host falls back to a guarded
/// passthrough.
pub(crate) fn build_native_kernel(dll_path: &Path) -> Option<Box<dyn Kernel>> {
    NativeKernel::new(dll_path)
        .ok()
        .map(|k| Box::new(k) as Box<dyn Kernel>)
}

/// A faust DSP loaded as a native dynamic library, driven through the `oj_*` C ABI.
struct NativeKernel {
    // Keep the library loaded for the kernel's lifetime; dropped after `handle` is
    // freed in `Drop` (Drop code runs before fields drop).
    _lib: Library,
    handle: *mut c_void,
    init_fn: InitFn,
    compute_fn: ComputeFn,
    param_fn: ParamFn,
    delete_fn: DeleteFn,
    num_in: usize,
    num_out: usize,
    /// Per-channel (non-interleaved) scratch faust reads/writes; sized in `init`
    /// and never resized, so the raw pointers in `*_ptrs` stay valid.
    in_bufs: Vec<Vec<f32>>,
    out_bufs: Vec<Vec<f32>>,
    in_ptrs: Vec<*mut f32>,
    out_ptrs: Vec<*mut f32>,
    max_block: usize,
    usable: bool,
}

// SAFETY: the kernel owns its faust instance, library, and buffers, and is driven
// from a single thread at a time (the engine moves it onto the audio thread). The
// raw pointers reference only its own heap buffers / loaded library.
unsafe impl Send for NativeKernel {}

impl NativeKernel {
    fn new(dll_path: &Path) -> Result<Self, ()> {
        // SAFETY: loading a dll + reading its declared `oj_*` symbols. A missing
        // symbol / bad library returns Err → the host passes through.
        unsafe {
            let lib = Library::new(dll_path).map_err(|_| ())?;
            let new_fn: NewFn = *lib.get(b"oj_new\0").map_err(|_| ())?;
            let init_fn: InitFn = *lib.get(b"oj_init\0").map_err(|_| ())?;
            let compute_fn: ComputeFn = *lib.get(b"oj_compute\0").map_err(|_| ())?;
            let param_fn: ParamFn = *lib.get(b"oj_param\0").map_err(|_| ())?;
            let delete_fn: DeleteFn = *lib.get(b"oj_delete\0").map_err(|_| ())?;
            let num_in_fn: NumFn = *lib.get(b"oj_num_in\0").map_err(|_| ())?;
            let num_out_fn: NumFn = *lib.get(b"oj_num_out\0").map_err(|_| ())?;
            let handle = new_fn();
            if handle.is_null() {
                return Err(());
            }
            let num_in = num_in_fn(handle).max(0) as usize;
            let num_out = num_out_fn(handle).max(0) as usize;
            Ok(Self {
                _lib: lib,
                handle,
                init_fn,
                compute_fn,
                param_fn,
                delete_fn,
                num_in,
                num_out,
                in_bufs: Vec::new(),
                out_bufs: Vec::new(),
                in_ptrs: Vec::new(),
                out_ptrs: Vec::new(),
                max_block: 0,
                usable: false,
            })
        }
    }
}

impl Drop for NativeKernel {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: `handle` came from `oj_new` and is freed exactly once here,
            // while the library is still loaded.
            unsafe { (self.delete_fn)(self.handle) };
        }
    }
}

impl Kernel for NativeKernel {
    fn init(&mut self, sample_rate: f32, max_block: usize) {
        self.max_block = max_block;
        self.in_bufs = (0..self.num_in).map(|_| vec![0.0f32; max_block]).collect();
        self.out_bufs = (0..self.num_out).map(|_| vec![0.0f32; max_block]).collect();
        self.in_ptrs = self.in_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        self.out_ptrs = self.out_bufs.iter_mut().map(|b| b.as_mut_ptr()).collect();
        // SAFETY: `handle` is valid; faust's init touches only its own dsp struct.
        unsafe { (self.init_fn)(self.handle, sample_rate as i32) };
        self.usable = true;
    }

    fn process(&mut self, input: &[f32], output: &mut [f32], n: usize) -> Result<(), KernelTrap> {
        if !self.usable {
            return Err(KernelTrap);
        }
        let n = n.min(self.max_block);
        // De-interleave host input -> faust's per-channel buffers.
        let num_in = self.num_in;
        for ch in 0..num_in {
            let buf = &mut self.in_bufs[ch];
            for (f, slot) in buf.iter_mut().take(n).enumerate() {
                *slot = input.get(f * num_in + ch).copied().unwrap_or(0.0);
            }
        }
        // SAFETY: the pointer arrays reference our own `*_bufs` (sized in `init`,
        // never resized), and `n <= max_block`, so faust reads/writes in bounds.
        // Native code is NOT sandboxed: a buggy kernel could still misbehave — the
        // OutputGuard chain (outside this kernel) is the remaining safety net.
        unsafe {
            (self.compute_fn)(
                self.handle,
                n as i32,
                self.in_ptrs.as_ptr(),
                self.out_ptrs.as_ptr(),
            );
        }
        // Re-interleave faust's per-channel output -> interleaved host output.
        let num_out = self.num_out;
        for ch in 0..num_out {
            let buf = &self.out_bufs[ch];
            for (f, &s) in buf.iter().take(n).enumerate() {
                let idx = f * num_out + ch;
                if idx < output.len() {
                    output[idx] = s;
                }
            }
        }
        Ok(())
    }

    fn param(&mut self, idx: u16, value: f32) {
        if !self.usable {
            return;
        }
        // SAFETY: APIUI-indexed param write into faust's own dsp struct.
        unsafe { (self.param_fn)(self.handle, idx as i32, value) };
    }
}

// ===========================================================================
// Build helper: faust source -> native .dll (off-RT, author-time).
// ===========================================================================

/// The `oj_*` C-ABI wrapper compiled alongside faust's `-lang cpp` class (which it
/// `#include`s). Uses faust's `APIUI` for index-addressed params.
const WRAPPER_CPP: &str = r#"#define FAUSTFLOAT float
#include "faust/dsp/dsp.h"
#include "faust/gui/APIUI.h"
#include "ojdsp.cpp"
#define OJ extern "C" __declspec(dllexport)
struct OjFaust { ojdsp d; APIUI ui; };
OJ void* oj_new(){ OjFaust* w = new OjFaust(); w->d.buildUserInterface(&w->ui); return w; }
OJ void oj_init(void* p, int sr){ ((OjFaust*)p)->d.init(sr); }
OJ void oj_compute(void* p, int n, float** in, float** out){ ((OjFaust*)p)->d.compute(n, in, out); }
OJ void oj_param(void* p, int i, float v){ ((OjFaust*)p)->ui.setParamValue(i, v); }
OJ int oj_num_in(void* p){ return ((OjFaust*)p)->d.getNumInputs(); }
OJ int oj_num_out(void* p){ return ((OjFaust*)p)->d.getNumOutputs(); }
OJ void oj_delete(void* p){ delete (OjFaust*)p; }
"#;

const FAUST_BIN: &str = r"C:\Program Files\Faust\bin\faust.exe";
const FAUST_INCLUDE: &str = r"C:\Program Files\Faust\include";
const VCVARS_CANDIDATES: &[&str] = &[
    r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
    r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
    r"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
];

/// Discover a `vcvars64.bat`. Prefers `vswhere` (the SUPPORTED way to locate a VS
/// install at ANY path — e.g. a non-standard `C:\BuildTools`), then falls back to
/// the well-known install locations. The old hardcoded-only list silently returned
/// `None` (no audible faust) when a perfectly good toolchain lived off the default
/// path; this finds it.
fn find_vcvars() -> Option<PathBuf> {
    const VSWHERE: &str = r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
    if Path::new(VSWHERE).exists() {
        if let Ok(out) = Command::new(VSWHERE)
            .args([
                "-latest",
                "-products",
                "*",
                "-requires",
                "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
                "-property",
                "installationPath",
            ])
            .output()
        {
            if out.status.success() {
                let root = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !root.is_empty() {
                    let bat = Path::new(&root).join(r"VC\Auxiliary\Build\vcvars64.bat");
                    if bat.exists() {
                        return Some(bat);
                    }
                }
            }
        }
    }
    VCVARS_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
}

/// Compile faust `src` to a native `.dll` in `out_dir`, returning the dll path.
///
/// Windows dev-environment helper: shells `faust -lang cpp` then `cl.exe` (via a
/// discovered `vcvars64.bat`) against the wrapper. Resolves the faust binary and
/// the VS toolchain from the candidate paths above (with a `faust`-on-PATH
/// fallback). Returns `None` on any failure (faust/cl missing, compile error).
/// Off-RT only; the production caller is `author_faust_native` in `src-tauri`.
pub fn compile_faust_to_dll(src: &str, out_dir: &Path) -> Option<PathBuf> {
    let dsp = out_dir.join("ojdsp.dsp");
    let cpp = out_dir.join("ojdsp.cpp");
    let wrapper = out_dir.join("wrapper.cpp");
    let bat = out_dir.join("build.bat");
    let dll = out_dir.join("ojfaust.dll");

    std::fs::write(&dsp, src).ok()?;
    let faust = if Path::new(FAUST_BIN).exists() {
        FAUST_BIN
    } else {
        "faust"
    };
    let faust_ok = Command::new(faust)
        .args(["-lang", "cpp", "-cn", "ojdsp", "-o"])
        .arg(&cpp)
        .arg(&dsp)
        .status()
        .ok()?
        .success();
    if !faust_ok {
        return None;
    }
    std::fs::write(&wrapper, WRAPPER_CPP).ok()?;
    let vcvars = find_vcvars()?;
    let bat_src = format!(
        "@echo off\r\n\
         call \"{vcvars}\" >nul\r\n\
         cd /d \"{dir}\"\r\n\
         cl /nologo /LD /EHsc /O2 /I \"{inc}\" wrapper.cpp /Fe:ojfaust.dll\r\n",
        vcvars = vcvars.display(),
        dir = out_dir.display(),
        inc = FAUST_INCLUDE,
    );
    std::fs::write(&bat, bat_src).ok()?;
    let built = Command::new("cmd")
        .arg("/c")
        .arg(&bat)
        .status()
        .ok()?
        .success();
    if built && dll.exists() {
        Some(dll)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end on a real dev box: faust + cl.exe (via the discovered vcvars)
    /// compile a trivial DSP to a loadable native `.dll` exposing the `oj_*` ABI.
    /// Skips gracefully when the toolchain is absent (CI), so it only ASSERTS where
    /// it can actually build — but on a faust+MSVC machine it proves the whole
    /// agent-authored-node compile+load path, including the vswhere vcvars discovery.
    #[test]
    fn compiles_a_faust_dsp_to_a_loadable_dll() {
        let src = "process = _ : *(0.5);";
        let dir = std::env::temp_dir().join("ojwasm_native_faust_test");
        let _ = std::fs::create_dir_all(&dir);
        let Some(dll) = compile_faust_to_dll(src, &dir) else {
            eprintln!("skip: faust/MSVC toolchain unavailable on this machine");
            return;
        };
        assert!(dll.exists(), "compile_faust_to_dll returned a missing path");
        let kernel = build_native_kernel(&dll);
        assert!(
            kernel.is_some(),
            "compiled .dll did not expose the oj_* exports"
        );
    }
}
