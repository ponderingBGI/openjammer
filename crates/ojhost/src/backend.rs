//! Backend dispatch: the seam where scan-probe and plugin-open route to whatever
//! hosting backend is compiled in.
//!
//! Exactly one backend module is active, selected by feature (the `juce` feature
//! wins if both are on, since it is the superset format-wise):
//!
//! * neither feature: [`scaffold`] — `probe` finds nothing, `open` is
//!   [`HostError::Unavailable`]. The default, dependency-free build.
//! * `clap-host` (and not `juce`): [`clap`] — pure-Rust CLAP hosting via
//!   `clack`. No C++, no CMake. CLAP only.
//! * `juce`: [`juce`] — the bundled C++ JUCE 8 host (VST3 + CLAP, + AU on
//!   macOS) over the `extern "C"` ABI in `cpp/ojhost_juce.h`.
//!
//! Each backend exposes the same two functions so the rest of the crate is
//! backend-agnostic:
//!
//! * `probe(path, format) -> Result<Vec<PluginDescriptor>, HostError>` —
//!   open the binary just far enough to enumerate its plugins + report ports /
//!   params / latency, then close it. Used by [`crate::scan`].
//! * `open(desc, sample_rate, max_block) -> Result<Box<dyn HostedBackend>, _>`
//!   — instantiate a live, processable plugin. Wrapped by
//!   [`crate::node::PluginHostNode`] into a `DspInstance`.

use std::path::Path;

use crate::descriptor::{PluginDescriptor, PluginFormat};
use crate::error::HostError;

/// The live, backend-specific half of a hosted plugin. The RT-safe
/// [`crate::node::PluginHostNode`] owns one and forwards `DspInstance` calls to
/// it. `process` is on the audio thread and MUST NOT allocate or lock — backends
/// pre-allocate all scratch in [`HostedBackend::activate`].
///
/// `Send` so the engine can move a freshly-loaded plugin onto the audio thread.
pub trait EditorBackend: Send {
    fn focus(&mut self);
    fn close(&mut self);
}

pub trait HostedBackend: Send {
    /// Off-RT: bind to the sample rate and the max block size any later
    /// `process` will request. Backends allocate their channel/buffer scratch
    /// here. After this, [`HostedBackend::latency_samples`] is authoritative.
    fn activate(&mut self, sample_rate: f32, max_block: usize);

    /// RT-thread hot path. Render `nframes` from `inputs` into `outputs`.
    /// `inputs`/`outputs` are channel-major (one slice per channel). MUST NOT
    /// allocate, lock, or block.
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize);

    /// RT-thread hot path WITH a per-node fault boundary. Render like [`process`],
    /// returning `true` if the foreign plugin FAULTED this block (a segfault /
    /// illegal op caught at the language boundary) — in which case `outputs` may be
    /// garbage and the caller must not trust it. The default has NO boundary: it
    /// calls [`process`] and reports no fault. The JUCE backend overrides it with
    /// the per-OS SEH / signal guard around `processBlock`. On a reported fault the
    /// [`crate::node::PluginHostNode`] latches to a dry passthrough and never
    /// re-enters the plugin this session ("a held note beats a glitch"; latch-and-
    /// quarantine, never resume out of foreign C++ that may hold the heap lock).
    fn process_guarded(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        nframes: usize,
    ) -> bool {
        self.process(inputs, outputs, nframes);
        false
    }

    /// RT-thread: set parameter `id` to `value`. MUST NOT allocate.
    fn set_param(&mut self, id: u16, value: f32);

    /// RT-thread: note-on for instrument plugins. Default no-op.
    fn note_on(&mut self, _note: u8, _vel: u8) {}

    /// RT-thread: note-off for instrument plugins. Default no-op.
    fn note_off(&mut self, _note: u8) {}

    /// Plugin-reported processing latency in samples (post-`activate`), for PDC.
    fn latency_samples(&self) -> u32;

    /// Off-RT: release activation-time resources. Default no-op.
    fn deactivate(&mut self) {}
}

/// Scan-probe `path` (a binary of `format`) for its plugin(s). See module docs.
pub(crate) fn probe(path: &Path, format: PluginFormat) -> Result<Vec<PluginDescriptor>, HostError> {
    active::probe(path, format)
}

/// Open the plugin described by `desc` into a live [`HostedBackend`].
pub(crate) fn open(
    desc: &PluginDescriptor,
    sample_rate: f32,
    max_block: usize,
) -> Result<Box<dyn HostedBackend>, HostError> {
    active::open(desc, sample_rate, max_block)
}

pub(crate) fn open_editor(desc: &PluginDescriptor) -> Result<Box<dyn EditorBackend>, HostError> {
    active::open_editor(desc)
}

// Select the single active backend. `juce` is the superset, so it wins when both
// features are requested.
#[cfg(all(feature = "clap-host", not(feature = "juce")))]
use clap as active;
#[cfg(feature = "juce")]
use juce as active;
#[cfg(not(any(feature = "clap-host", feature = "juce")))]
use scaffold as active;

// ---------------------------------------------------------------------------
// Scaffold backend (default — no native deps, no network).
// ---------------------------------------------------------------------------
#[cfg(not(any(feature = "clap-host", feature = "juce")))]
mod scaffold {
    use super::*;

    /// No backend: scanning a real plugin is impossible, so report none. This is
    /// the documented no-plugin-safe behaviour — the UI shows an empty list.
    pub(super) fn probe(
        _path: &Path,
        _format: PluginFormat,
    ) -> Result<Vec<PluginDescriptor>, HostError> {
        Ok(Vec::new())
    }

    /// No backend: loading is terminally unavailable.
    pub(super) fn open(
        _desc: &PluginDescriptor,
        _sample_rate: f32,
        _max_block: usize,
    ) -> Result<Box<dyn HostedBackend>, HostError> {
        Err(HostError::Unavailable)
    }

    pub(super) fn open_editor(
        _desc: &PluginDescriptor,
    ) -> Result<Box<dyn EditorBackend>, HostError> {
        Err(HostError::Unavailable)
    }
}

// ---------------------------------------------------------------------------
// Pure-Rust CLAP backend (feature = "clap-host"). MIT, no C++. CLAP only.
// ---------------------------------------------------------------------------
#[cfg(all(feature = "clap-host", not(feature = "juce")))]
mod clap;

// ---------------------------------------------------------------------------
// JUCE C++ backend (feature = "juce"). VST3 + CLAP, + AU on macOS.
// ---------------------------------------------------------------------------
#[cfg(feature = "juce")]
mod juce;
