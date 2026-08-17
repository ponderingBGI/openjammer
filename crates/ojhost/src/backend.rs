//! Backend dispatch: the seam where scan-probe and plugin-open route to whatever
//! hosting backend is compiled in.
//!
//! Exactly one backend module is active, selected by feature (the `juce` feature
//! wins if both are on):
//!
//! * neither feature: [`scaffold`] — `probe` finds nothing, `open` is
//!   [`HostError::Unavailable`]. The default, dependency-free build.
//! * `clap-host` (and not `juce`): [`clap`] — pure-Rust CLAP hosting via
//!   `clack`. No C++, no CMake. CLAP only.
//! * `juce`: [`juce`] — the bundled C++ JUCE 8 host (VST3, + AU on
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

use std::sync::atomic::{AtomicBool, Ordering};

static LATENCY_RESCAN_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Called by a backend host callback when a live plugin invalidates its latency.
#[cfg(feature = "clap-host")]
pub(crate) fn request_latency_rescan() {
    LATENCY_RESCAN_REQUESTED.store(true, Ordering::Release);
}

/// Consume the coalesced latency-change request on the control thread. The
/// caller recompiles its retained graph and publishes through `ProgramSwap`.
pub fn take_latency_rescan_request() -> bool {
    LATENCY_RESCAN_REQUESTED.swap(false, Ordering::AcqRel)
}

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

    /// CLAP audio-thread lifecycle boundary. Called immediately before the
    /// first process block in a run; never performs main-thread work.
    fn start_processing(&mut self) {}

    /// CLAP audio-thread lifecycle boundary after the final process block.
    fn stop_processing(&mut self) {}

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

    /// Queue a timestamped hosted event for the next block. The caller must
    /// provide nondecreasing `at_frame` values smaller than that block.
    fn queue_event(&mut self, _event: HostedEvent) {}

    /// Plugin-reported processing latency in samples (post-`activate`), for PDC.
    fn latency_samples(&self) -> u32;

    /// Plugin tail in samples. `None` means an infinite tail.
    fn tail_samples(&self) -> Option<u32> {
        Some(0)
    }

    /// OFF-RT CLAP value-to-text conversion.
    fn param_value_to_text(&mut self, _id: u16, _value: f64) -> Option<String> {
        None
    }

    /// OFF-RT CLAP text-to-value conversion.
    fn param_text_to_value(&mut self, _id: u16, _text: &str) -> Option<f64> {
        None
    }

    /// OFF-RT: drain plugin-originated gestures/adjustments captured without
    /// blocking the audio callback.
    fn take_param_gestures(&mut self) -> Vec<ParamGesture> {
        Vec::new()
    }

    /// OFF-RT: drain plugin-originated note events such as CLAP NOTE_END.
    fn take_output_events(&mut self) -> Vec<HostedEvent> {
        Vec::new()
    }

    /// OFF-RT: consume a coalesced params/ports descriptor refresh request.
    fn take_descriptor_rescan_request(&self) -> bool {
        false
    }

    /// OFF-RT: serialize the plugin's full opaque state — VST3
    /// `getStateInformation` / the CLAP state extension — so a session can persist
    /// it and a respawn can restore it (the `oj.state` capability's save half).
    /// Default empty (a backend with no state surface). MAY allocate; never on the
    /// audio thread.
    fn save_state(&self) -> Vec<u8> {
        Vec::new()
    }

    /// OFF-RT: restore the plugin from a blob produced by [`save_state`]
    /// (`setStateInformation` / CLAP state). Default no-op. Applied at construction
    /// (before the instance goes live), so it runs off the audio thread; MAY allocate.
    fn restore_state(&mut self, _blob: &[u8]) {}

    /// Checked restore used by conformance. Legacy backends that cannot report
    /// rejection retain the previous best-effort behavior.
    fn restore_state_checked(&mut self, blob: &[u8]) -> bool {
        self.restore_state(blob);
        true
    }

    /// Off-RT: release activation-time resources. Default no-op.
    fn deactivate(&mut self) {}
}

/// Sample-accurate events accepted by the hosted-plugin bridge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HostedEvent {
    Param {
        at_frame: u32,
        id: u16,
        value: f64,
    },
    NoteOn {
        at_frame: u32,
        port: i16,
        channel: i16,
        key: i16,
        note_id: i32,
        velocity: f64,
    },
    NoteOff {
        at_frame: u32,
        port: i16,
        channel: i16,
        key: i16,
        note_id: i32,
        velocity: f64,
    },
    NoteChoke {
        at_frame: u32,
        port: i16,
        channel: i16,
        key: i16,
        note_id: i32,
    },
    NoteEnd {
        at_frame: u32,
        port: i16,
        channel: i16,
        key: i16,
        note_id: i32,
    },
    Midi {
        at_frame: u32,
        port: u16,
        data: [u8; 3],
    },
}

/// One plugin-originated parameter transaction event.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ParamGesture {
    Begin { id: u32 },
    Adjust { id: u32, value: f64 },
    End { id: u32 },
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

/// DEV/TEST ONLY: forward to the JUCE backend's in-guard fault arm (see
/// [`crate::arm_fault`]). Present only with `juce` + `fault-inject`.
#[cfg(all(feature = "juce", oj_fault_inject))]
pub(crate) fn arm_fault() {
    juce::arm_fault();
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
// JUCE C++ backend (feature = "juce"). VST3, + AU on macOS.
// ---------------------------------------------------------------------------
#[cfg(feature = "juce")]
mod juce;
