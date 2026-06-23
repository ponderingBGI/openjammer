//! JUCE C++ backend (feature = "juce"): the Rust binding for the `extern "C"`
//! ABI declared in `cpp/ojhost_juce.h` and implemented in `cpp/ojhost_juce.cpp`.
//! Supports VST3 + CLAP (+ AU on macOS). `build.rs` drives CMake to build and
//! link the C++ static library.
//!
//! This module is the ONLY place the C++ symbols are named on the Rust side. It
//! presents the same `probe` / `open` pair as the other backends, plus a
//! `JuceBackend: HostedBackend` whose `process` forwards to the RT-safe
//! `ojhost_process` (the C++ side pre-allocates in `ojhost_prepare`).
//!
//! NOTE: this file is only compiled with `--features juce`, which requires the
//! native toolchain + JUCE checkout (not present in the scaffold sandbox), so it
//! is unverified here. Its shape matches `ojhost_juce.h` 1:1.

use std::ffi::{c_char, c_float, c_int, CStr, CString};
use std::path::Path;
use std::ptr;

use super::{EditorBackend, HostedBackend};
use crate::descriptor::{HostedParam, PluginDescriptor, PluginFormat, PortCounts};
use crate::error::HostError;

// --- raw ABI (mirrors cpp/ojhost_juce.h) -----------------------------------

#[repr(C)]
struct OjHost {
    _opaque: [u8; 0],
}
#[repr(C)]
struct OjPlugin {
    _opaque: [u8; 0],
}
#[repr(C)]
struct OjPluginEditor {
    _opaque: [u8; 0],
}

#[repr(C)]
struct OjHostedParam {
    id: u32,
    name: *const c_char,
    min: f64,
    max: f64,
    default_value: f64,
}

#[repr(C)]
struct OjPluginDesc {
    uid: *const c_char,
    name: *const c_char,
    vendor: *const c_char,
    path: *const c_char,
    format: c_int,
    is_instrument: i32,
    audio_in: u16,
    audio_out: u16,
    param_count: u32,
    params: *const OjHostedParam,
    latency_samples: u32,
}

#[repr(C)]
struct OjScanResult {
    items: *mut OjPluginDesc,
    count: usize,
}

const OJ_FORMAT_VST2: c_int = 0;
const OJ_FORMAT_VST3: c_int = 1;
const OJ_FORMAT_CLAP: c_int = 2;
const OJ_FORMAT_AU: c_int = 3;

extern "C" {
    fn ojhost_create() -> *mut OjHost;
    fn ojhost_destroy(host: *mut OjHost);
    fn ojhost_scan(host: *mut OjHost, dirs: *const *const c_char, dir_count: usize)
        -> OjScanResult;
    fn ojhost_free_scan(result: OjScanResult);
    fn ojhost_load(
        host: *mut OjHost,
        path: *const c_char,
        uid: *const c_char,
        format: c_int,
        err: *mut *const c_char,
    ) -> *mut OjPlugin;
    fn ojhost_prepare(plugin: *mut OjPlugin, sample_rate: f64, max_block: c_int);
    fn ojhost_process(
        plugin: *mut OjPlugin,
        inputs: *const *const c_float,
        in_channels: c_int,
        outputs: *const *mut c_float,
        out_channels: c_int,
        nframes: c_int,
    );
    fn ojhost_process_guarded(
        plugin: *mut OjPlugin,
        inputs: *const *const c_float,
        in_channels: c_int,
        outputs: *const *mut c_float,
        out_channels: c_int,
        nframes: c_int,
    ) -> c_int;
    fn ojhost_set_param(plugin: *mut OjPlugin, index: u32, value: c_float);
    fn ojhost_note_on(plugin: *mut OjPlugin, note: u8, velocity: u8);
    fn ojhost_note_off(plugin: *mut OjPlugin, note: u8);
    fn ojhost_latency_samples(plugin: *const OjPlugin) -> u32;
    fn ojhost_param_count(plugin: *const OjPlugin) -> u32;
    fn ojhost_get_state(plugin: *mut OjPlugin, out_len: *mut usize) -> *mut u8;
    fn ojhost_free_state(data: *mut u8, len: usize);
    fn ojhost_set_state(plugin: *mut OjPlugin, data: *const u8, len: usize);
    fn ojhost_unload(plugin: *mut OjPlugin);
    fn ojhost_editor_open(
        path: *const c_char,
        uid: *const c_char,
        format: c_int,
        err: *mut *const c_char,
    ) -> *mut OjPluginEditor;
    fn ojhost_editor_focus(editor: *mut OjPluginEditor);
    fn ojhost_editor_close(editor: *mut OjPluginEditor);
}

fn fmt_to_c(f: PluginFormat) -> c_int {
    match f {
        PluginFormat::Vst2 => OJ_FORMAT_VST2,
        PluginFormat::Vst3 => OJ_FORMAT_VST3,
        PluginFormat::Clap => OJ_FORMAT_CLAP,
        PluginFormat::Au => OJ_FORMAT_AU,
    }
}

fn fmt_from_c(f: c_int) -> PluginFormat {
    match f {
        OJ_FORMAT_VST2 => PluginFormat::Vst2,
        OJ_FORMAT_VST3 => PluginFormat::Vst3,
        OJ_FORMAT_AU => PluginFormat::Au,
        _ => PluginFormat::Clap,
    }
}

/// # Safety
/// `p` must be NULL or a valid NUL-terminated C string valid for the duration of
/// the call (borrowed from the C++ side).
unsafe fn cstr_owned(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        // SAFETY: caller guarantees `p` is a valid NUL-terminated C string.
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }
}

// --- the `probe` / `open` seam ---------------------------------------------

/// Probe one binary by spinning up a host, scanning just its directory, and
/// returning matching descriptors. (JUCE's scanner works per-directory; we
/// filter to the requested path.)
pub(super) fn probe(
    path: &Path,
    _format: PluginFormat,
) -> Result<Vec<PluginDescriptor>, HostError> {
    let host = unsafe { ojhost_create() };
    if host.is_null() {
        return Err(HostError::Load {
            message: "ojhost_create returned null".into(),
        });
    }
    let dir = path.parent().unwrap_or(path);
    let dir_c = CString::new(dir.to_string_lossy().as_bytes()).map_err(|_| HostError::Load {
        message: "scan dir contains an interior NUL".into(),
    })?;
    let dirs = [dir_c.as_ptr()];

    let result = unsafe { ojhost_scan(host, dirs.as_ptr(), 1) };
    let target = path.to_string_lossy();
    let mut out = Vec::new();
    unsafe {
        let slice = std::slice::from_raw_parts(result.items, result.count);
        for d in slice {
            let dpath = cstr_owned(d.path);
            // Only descriptors from the requested binary (the scanner may also
            // have found neighbours in the same directory).
            if dpath != target {
                continue;
            }
            out.push(PluginDescriptor {
                uid: cstr_owned(d.uid),
                name: cstr_owned(d.name),
                vendor: cstr_owned(d.vendor),
                path: dpath,
                format: fmt_from_c(d.format),
                is_instrument: d.is_instrument != 0,
                ports: PortCounts {
                    audio_in: d.audio_in,
                    audio_out: d.audio_out,
                },
                param_count: d.param_count,
                params: params_from_c(d.params, d.param_count),
                latency_samples: d.latency_samples,
            });
        }
        ojhost_free_scan(result);
        ojhost_destroy(host);
    }
    Ok(out)
}

unsafe fn params_from_c(ptr: *const OjHostedParam, count: u32) -> Vec<HostedParam> {
    if ptr.is_null() || count == 0 {
        return Vec::new();
    }
    // SAFETY: caller passes `ptr`/`count` from one `OjPluginDesc`; C++ owns the
    // array until `ojhost_free_scan`, and this function clones every field.
    let slice = unsafe { std::slice::from_raw_parts(ptr, count as usize) };
    slice
        .iter()
        .map(|p| HostedParam {
            id: p.id,
            // SAFETY: C++ stores each param name as a valid NUL-terminated string.
            name: unsafe { cstr_owned(p.name) },
            min: p.min,
            max: p.max,
            default: p.default_value,
        })
        .collect()
}

/// Open a plugin into a live [`HostedBackend`].
pub(super) fn open(
    desc: &PluginDescriptor,
    sample_rate: f32,
    max_block: usize,
) -> Result<Box<dyn HostedBackend>, HostError> {
    let mut backend = JuceBackend::load(desc)?;
    backend.activate(sample_rate, max_block);
    Ok(Box::new(backend))
}

pub(super) fn open_editor(desc: &PluginDescriptor) -> Result<Box<dyn EditorBackend>, HostError> {
    let path = CString::new(desc.path.as_bytes()).map_err(|_| HostError::Load {
        message: "plugin path contains an interior NUL".into(),
    })?;
    let uid = CString::new(desc.uid.as_bytes()).map_err(|_| HostError::Load {
        message: "plugin uid contains an interior NUL".into(),
    })?;
    let mut err: *const c_char = ptr::null();
    let handle = unsafe {
        ojhost_editor_open(
            path.as_ptr(),
            uid.as_ptr(),
            fmt_to_c(desc.format),
            &mut err as *mut *const c_char,
        )
    };
    if handle.is_null() {
        let message = unsafe { cstr_owned(err) };
        return Err(HostError::Load {
            message: if message.is_empty() { "plugin editor failed to open".into() } else { message },
        });
    }
    Ok(Box::new(JuceEditor { handle }))
}

struct JuceEditor {
    handle: *mut OjPluginEditor,
}

unsafe impl Send for JuceEditor {}

impl EditorBackend for JuceEditor {
    fn focus(&mut self) {
        unsafe { ojhost_editor_focus(self.handle) };
    }

    fn close(&mut self) {
        if !self.handle.is_null() {
            unsafe { ojhost_editor_close(self.handle) };
            self.handle = ptr::null_mut();
        }
    }
}

impl Drop for JuceEditor {
    fn drop(&mut self) {
        self.close();
    }
}

/// One live JUCE-hosted plugin. Owns the C++ host + instance and the pre-sized
/// channel-pointer scratch used to call `ojhost_process` allocation-free.
struct JuceBackend {
    host: *mut OjHost,
    plugin: *mut OjPlugin,
    in_ptrs: Vec<*const c_float>,
    out_ptrs: Vec<*mut c_float>,
    in_channels: usize,
    out_channels: usize,
    latency: u32,
    /// Parameter count reported by the loaded instance (refined on `activate`).
    param_count: u32,
}

// SAFETY: the C++ side owns no thread-affine state we expose; the engine moves a
// freshly-loaded plugin onto the audio thread once and drives it there only.
unsafe impl Send for JuceBackend {}

impl JuceBackend {
    fn load(desc: &PluginDescriptor) -> Result<Self, HostError> {
        let host = unsafe { ojhost_create() };
        if host.is_null() {
            return Err(HostError::Load {
                message: "ojhost_create returned null".into(),
            });
        }
        let path = CString::new(desc.path.as_bytes()).map_err(|_| HostError::Load {
            message: "plugin path contains an interior NUL".into(),
        })?;
        let uid = CString::new(desc.uid.as_bytes()).map_err(|_| HostError::Load {
            message: "plugin uid contains an interior NUL".into(),
        })?;
        let mut err: *const c_char = ptr::null();
        let plugin = unsafe {
            ojhost_load(
                host,
                path.as_ptr(),
                uid.as_ptr(),
                fmt_to_c(desc.format),
                &mut err as *mut *const c_char,
            )
        };
        if plugin.is_null() {
            let message = unsafe { cstr_owned(err) };
            unsafe { ojhost_destroy(host) };
            return Err(HostError::Load {
                message: if message.is_empty() {
                    "ojhost_load returned null".into()
                } else {
                    message
                },
            });
        }
        Ok(Self {
            host,
            plugin,
            in_ptrs: Vec::new(),
            out_ptrs: Vec::new(),
            in_channels: desc.ports.audio_in as usize,
            out_channels: desc.ports.audio_out as usize,
            latency: desc.latency_samples,
            param_count: desc.param_count,
        })
    }

    /// Point the pre-sized channel-pointer arrays at the caller's buffers and
    /// return the clamped (in, out) channel counts. Shared by `process` and
    /// `process_guarded` (RT-safe: no allocation — `activate` sized the arrays).
    fn fill_ptrs(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]]) -> (usize, usize) {
        let in_n = inputs.len().min(self.in_ptrs.len());
        for (i, slot) in self.in_ptrs.iter_mut().enumerate().take(in_n) {
            *slot = inputs[i].as_ptr();
        }
        let out_n = outputs.len().min(self.out_ptrs.len());
        for (i, slot) in self.out_ptrs.iter_mut().enumerate().take(out_n) {
            *slot = outputs[i].as_mut_ptr();
        }
        (in_n, out_n)
    }
}

impl HostedBackend for JuceBackend {
    fn activate(&mut self, sample_rate: f32, max_block: usize) {
        unsafe { ojhost_prepare(self.plugin, sample_rate as f64, max_block as c_int) };
        // Refine latency + param count now the instance is prepared (these are
        // authoritative post-prepare, vs the scan-time defaults).
        self.latency = unsafe { ojhost_latency_samples(self.plugin) };
        self.param_count = unsafe { ojhost_param_count(self.plugin) };
        // Pre-size the channel-pointer arrays so `process` never grows them.
        self.in_ptrs = vec![ptr::null(); self.in_channels];
        self.out_ptrs = vec![ptr::null_mut(); self.out_channels];
    }

    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
        let (in_n, out_n) = self.fill_ptrs(inputs, outputs);
        unsafe {
            ojhost_process(
                self.plugin,
                self.in_ptrs.as_ptr(),
                in_n as c_int,
                self.out_ptrs.as_ptr(),
                out_n as c_int,
                nframes as c_int,
            );
        }
    }

    fn process_guarded(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        nframes: usize,
    ) -> bool {
        // Identical to `process`, but through the C++ SEH/signal fault boundary.
        // A non-zero return is `OJ_PROCESS_FAULT`: the plugin crashed this block
        // (the C++ side already silenced the outputs); the node latches.
        let (in_n, out_n) = self.fill_ptrs(inputs, outputs);
        let status = unsafe {
            ojhost_process_guarded(
                self.plugin,
                self.in_ptrs.as_ptr(),
                in_n as c_int,
                self.out_ptrs.as_ptr(),
                out_n as c_int,
                nframes as c_int,
            )
        };
        status != 0
    }

    fn set_param(&mut self, id: u16, value: f32) {
        // Ignore out-of-range indices (the C++ side also bounds-checks).
        if (id as u32) < self.param_count {
            unsafe { ojhost_set_param(self.plugin, id as u32, value) };
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        unsafe { ojhost_note_on(self.plugin, note, vel) };
    }

    fn note_off(&mut self, note: u8) {
        unsafe { ojhost_note_off(self.plugin, note) };
    }

    fn latency_samples(&self) -> u32 {
        self.latency
    }

    fn save_state(&self) -> Vec<u8> {
        // OFF-RT: pull the plugin's opaque state across the C ABI (malloc'd by C++),
        // copy it into a Rust Vec, then free the C++ buffer (no cross-allocator free).
        let mut len: usize = 0;
        let ptr = unsafe { ojhost_get_state(self.plugin, &mut len as *mut usize) };
        if ptr.is_null() || len == 0 {
            return Vec::new();
        }
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        unsafe { ojhost_free_state(ptr, len) };
        bytes
    }

    fn restore_state(&mut self, blob: &[u8]) {
        if blob.is_empty() {
            return;
        }
        // OFF-RT: hand the blob to setStateInformation. The C++ side copies it.
        unsafe { ojhost_set_state(self.plugin, blob.as_ptr(), blob.len()) };
    }

    fn deactivate(&mut self) {
        // resources are released on Drop (unload + destroy).
    }
}

impl Drop for JuceBackend {
    fn drop(&mut self) {
        unsafe {
            if !self.plugin.is_null() {
                ojhost_unload(self.plugin);
                self.plugin = ptr::null_mut();
            }
            if !self.host.is_null() {
                ojhost_destroy(self.host);
                self.host = ptr::null_mut();
            }
        }
    }
}
