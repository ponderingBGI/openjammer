//! Pure-Rust CLAP backend (feature = "clap-host"), built on the `clack` host
//! crate (MIT, no C++). Supports CLAP only — VST3 / AU need the JUCE backend.
//!
//! # Threading model (the `Send` processor + the retained main-thread handle)
//!
//! `clack`'s [`PluginInstance`] is the MAIN-THREAD handle and is `!Send`. Its
//! [`StartedPluginAudioProcessor`], by contrast, IS `Send` (it owns an `Arc`
//! clone of the instance and is meant to be moved to the audio thread). So we:
//!
//! 1. on the loading thread, create the instance, `activate`, and
//!    `start_processing` to obtain the `Send` audio processor (its own `Arc`);
//! 2. RETAIN the `!Send` [`PluginInstance`] handle in the backend (it owns a
//!    second `Arc` to the same inner) so the `oj.state` capability can call the
//!    CLAP `clap_plugin_state` save/load — which are `[main-thread]` and need this
//!    handle, not the audio processor;
//! 3. store the `Send` processor + the retained handle + pre-allocated scratch.
//!
//! The retained handle makes the struct `!Send`, so [`ClapBackend`] carries an
//! `unsafe impl Send` (see the impl for its safety contract). It is sound because
//! the handle is only ever METHOD-CALLED on the control thread — at off-RT
//! save/restore (always BEFORE the program is published into the audio callback)
//! and at teardown (drop happens on the control thread via the program-swap
//! reclaim). During audio-thread `process` only the `Send` processor is touched;
//! the `[main-thread]` handle is never used there, so a state call can never race
//! the audio thread. This is the same discipline the JUCE backend uses for its
//! `*mut OjPlugin`.
//!
//! # Real-time safety
//!
//! The CLAP `process` callback runs on the audio thread and must not allocate.
//! We pre-size the input/output [`AudioPorts`] and our per-channel scratch in
//! [`open`]; per block we copy into the scratch, re-point the (pre-sized)
//! `AudioPorts` at it (which reuses internal lists when capacity suffices), call
//! `process`, and copy back out. No heap traffic on the hot path.

use std::path::Path;

use clack_host::prelude::*;

use super::{EditorBackend, HostedBackend};
use crate::descriptor::{HostedParam, PluginDescriptor, PluginFormat, PortCounts};
use crate::error::HostError;

/// A minimal CLAP host: registers no extensions and ignores every callback.
/// Enough to scan and to render audio. A later unit can grow the handlers
/// (params / GUI / timer) without changing this crate's public surface.
struct OjClapHost;

struct OjShared;

impl<'a> SharedHandler<'a> for OjShared {
    fn request_restart(&self) {}
    fn request_process(&self) {}
    fn request_callback(&self) {}
}

struct OjMainThread;

impl<'a> MainThreadHandler<'a> for OjMainThread {}

impl HostHandlers for OjClapHost {
    type Shared<'a> = OjShared;
    type MainThread<'a> = OjMainThread;
    type AudioProcessor<'a> = ();
}

fn host_info() -> HostInfo {
    // Infallible inputs (no interior NUL), so `expect` is fine off the RT path.
    HostInfo::new(
        "OpenJammer",
        "OpenJammer",
        "https://openjammer.app",
        "0.0.0",
    )
    .expect("static host info has no interior NUL")
}

fn cstr_to_string(s: Option<&std::ffi::CStr>) -> String {
    s.map(|c| c.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Probe a `.clap` file: load it, enumerate its plugin descriptors, and close.
/// (The entry is dropped at end of scope, unloading the library.)
pub(super) fn probe(path: &Path, format: PluginFormat) -> Result<Vec<PluginDescriptor>, HostError> {
    // The CLAP backend hosts CLAP only, but `scan` enumerates every plugin
    // format it recognizes — on Windows that includes the `.vst3` bundles in
    // `Common Files\VST3`. A non-CLAP candidate is NOT an error and must never
    // crash the scan: skip it so the result degrades to "no CLAP plugin here",
    // exactly as the scaffold backend reports nothing. VST3/AU need the JUCE
    // backend (feature = "juce"); until that is compiled in they are silently
    // unhosted. (Previously a `debug_assert_eq!` here aborted the whole app the
    // moment a user with VST3s installed opened the Plugins panel — a held note
    // beats a glitch: a stray installed plugin can't take down the instrument.)
    if format != PluginFormat::Clap {
        return Ok(Vec::new());
    }

    // SAFETY: loading any dynamic library can run arbitrary init code; the
    // scan-time blacklist (see `scan`) is what makes a crash here recoverable.
    let entry = unsafe { PluginEntry::load(path) }.map_err(|e| HostError::Load {
        message: e.to_string(),
    })?;
    let factory = match entry.get_plugin_factory() {
        Some(f) => f,
        None => return Ok(Vec::new()),
    };

    let path_str = path.to_string_lossy().into_owned();
    let mut out = Vec::new();
    for d in factory.plugin_descriptors() {
        let is_instrument = d.features().any(|f| {
            let f = f.to_string_lossy();
            f == "instrument" || f == "synthesizer"
        });
        let uid = cstr_to_string(d.id());
        // Briefly instantiate to read the plugin's parameter list (CLAP params
        // extension) so the UI shows real knobs with the plugin's own ranges.
        // Best-effort and off-RT: a plugin that fails to instantiate yields an
        // empty list (the node still loads; it just surfaces no params).
        let params = query_params(&entry, &uid);
        out.push(PluginDescriptor {
            uid,
            name: cstr_to_string(d.name()),
            vendor: cstr_to_string(d.vendor()),
            path: path_str.clone(),
            format: PluginFormat::Clap,
            is_instrument,
            // CLAP reports ports via per-instance extensions; conservative
            // defaults here, refined on load.
            ports: PortCounts {
                audio_in: if is_instrument { 0 } else { 2 },
                audio_out: 2,
            },
            param_count: params.len() as u32,
            params,
            latency_samples: 0,
        });
    }
    Ok(out)
}

/// Instantiate `uid` from `entry` just long enough to read its parameter list
/// via the CLAP params extension, then drop it. Off-RT (scan time). Returns an
/// empty list when the plugin exposes no params extension or fails to
/// instantiate — the caller treats that as "no surfaced params", never an error.
fn query_params(entry: &PluginEntry, uid: &str) -> Vec<HostedParam> {
    use clack_extensions::params::{ParamInfoBuffer, PluginParams};

    let Ok(id) = std::ffi::CString::new(uid) else {
        return Vec::new();
    };
    let host = host_info();
    let mut instance = match PluginInstance::<OjClapHost>::new(
        |_| OjShared,
        |_| OjMainThread,
        entry,
        &id,
        &host,
    ) {
        Ok(i) => i,
        Err(_) => return Vec::new(),
    };
    let Some(params) = instance
        .plugin_shared_handle()
        .get_extension::<PluginParams>()
    else {
        return Vec::new();
    };
    let mut handle = instance.plugin_handle();
    let count = params.count(&mut handle);
    let mut out = Vec::with_capacity(count as usize);
    let mut buf = ParamInfoBuffer::new();
    for i in 0..count {
        if let Some(pi) = params.get_info(&mut handle, i, &mut buf) {
            let name = String::from_utf8_lossy(pi.name)
                .trim_end_matches('\0')
                .to_string();
            out.push(HostedParam {
                id: pi.id.get(),
                name,
                min: pi.min_value,
                max: pi.max_value,
                default: pi.default_value,
            });
        }
    }
    out
}

/// Open a CLAP plugin into a live [`HostedBackend`]. Performs the full
/// load -> activate -> start_processing here (off the RT thread), so the
/// returned backend holds only the `Send` audio processor.
pub(super) fn open(
    desc: &PluginDescriptor,
    sample_rate: f32,
    max_block: usize,
) -> Result<Box<dyn HostedBackend>, HostError> {
    // SAFETY: see `probe`; the blacklist makes a load-time crash recoverable.
    let entry = unsafe { PluginEntry::load(&desc.path) }.map_err(|e| HostError::Load {
        message: e.to_string(),
    })?;
    // `open_from_entry` builds an instance that keeps its own internal clone of the
    // entry, so the local `entry` may drop when `open` returns.
    open_from_entry(&entry, desc, sample_rate, max_block)
}

/// Shared body of [`open`] over an already-loaded [`PluginEntry`]. Factored out so a
/// device-free unit test can drive the real backend with an IN-PROCESS `clack`
/// plugin (`PluginEntry::load_from_clack`) — no `.clap` dylib, no audio device — and
/// exercise the `oj.state` save/restore round-trip against a real CLAP state vtable.
/// Performs activate -> start_processing here (off the RT thread).
fn open_from_entry(
    entry: &PluginEntry,
    desc: &PluginDescriptor,
    sample_rate: f32,
    max_block: usize,
) -> Result<Box<dyn HostedBackend>, HostError> {
    let info = host_info();
    let id = std::ffi::CString::new(desc.uid.as_str()).map_err(|_| HostError::Load {
        message: "plugin uid contains an interior NUL".into(),
    })?;

    let mut instance =
        PluginInstance::<OjClapHost>::new(|_| OjShared, |_| OjMainThread, entry, &id, &info)
            .map_err(|e| HostError::Load {
                message: e.to_string(),
            })?;

    let config = PluginAudioConfiguration {
        sample_rate: sample_rate as f64,
        min_frames_count: 1,
        max_frames_count: max_block as u32,
    };
    let stopped = instance
        .activate(|_, _| (), config)
        .map_err(|e| HostError::Load {
            message: e.to_string(),
        })?;
    let started = stopped.start_processing().map_err(|e| HostError::Load {
        message: e.to_string(),
    })?;

    // RETAIN the `!Send` main-thread `instance` handle (moved into the backend
    // below) so the `oj.state` save/restore can reach the CLAP state extension — it
    // owns a second `Arc` to the inner alongside `started`. The caller's `entry`
    // stays borrowed for this call; the instance keeps its own internal clone.
    let channels = desc.ports.audio_out.max(desc.ports.audio_in).max(1) as usize;
    // Map each surfaced param (by index) to its CLAP id, so `set_param(index, _)`
    // can build a param-value event targeting the plugin's stable id.
    let param_ids: Vec<clack_host::utils::ClapId> = desc
        .params
        .iter()
        .filter_map(|p| clack_host::utils::ClapId::from_raw(p.id))
        .collect();
    Ok(Box::new(ClapBackend {
        processor: Some(started),
        // Retained main-thread handle for oj.state save/restore (see module doc +
        // the `unsafe impl Send` contract). `RefCell` because `save_state(&self)`
        // needs `&mut` for `plugin_handle()`; `Option` so `deactivate` can release
        // it. Touched only on the control thread.
        instance: std::cell::RefCell::new(Some(instance)),
        in_ports: AudioPorts::with_capacity(channels, 1),
        out_ports: AudioPorts::with_capacity(channels, 1),
        in_scratch: vec![vec![0.0f32; max_block]; channels],
        out_scratch: vec![vec![0.0f32; max_block]; channels],
        // Pre-sized so `set_param`'s param-value pushes AND `note_on`/`note_off`'s
        // note pushes don't allocate on the RT thread (the buffer is cleared each
        // block in `process`). Headroom for a dense chord + an automation burst in
        // one block so `EventBuffer::push` never has to grow.
        in_events: EventBuffer::with_capacity(256),
        out_events: EventBuffer::new(),
        channels,
        max_block,
        latency: desc.latency_samples,
        param_ids,
    }))
}

/// One live CLAP plugin's audio-thread half + pre-allocated RT scratch + the
/// retained main-thread handle for `oj.state`.
struct ClapBackend {
    /// The `Send` audio processor; one of two `Arc` owners of the inner (the other
    /// is `instance`). `Option` so `deactivate` can take it.
    processor: Option<StartedPluginAudioProcessor<OjClapHost>>,
    /// The retained `!Send` main-thread handle (a second `Arc` to the inner), kept
    /// solely so `save_state`/`restore_state` can call the CLAP state extension's
    /// `[main-thread]` save/load. Touched ONLY on the control thread (off-RT
    /// save/restore pre-publish, and drop via the swap reclaim) — never during the
    /// audio-thread `process`. This is what makes the struct `!Send`; see the
    /// `unsafe impl Send` below.
    instance: std::cell::RefCell<Option<PluginInstance<OjClapHost>>>,
    /// Pre-sized input/output port wrappers (reused every block).
    in_ports: AudioPorts,
    out_ports: AudioPorts,
    /// Per-channel input/output scratch, allocated once at `open`.
    in_scratch: Vec<Vec<f32>>,
    out_scratch: Vec<Vec<f32>>,
    /// Reusable empty event buffers (no param/note events wired yet).
    in_events: EventBuffer,
    out_events: EventBuffer,
    channels: usize,
    max_block: usize,
    latency: u32,
    /// Index -> CLAP `clap_id` map (from the scanned param list). `set_param`
    /// addresses params by 0-based index; this resolves it to the plugin's id.
    param_ids: Vec<clack_host::utils::ClapId>,
}

// SAFETY: `ClapBackend` is `!Send` only because of the retained `!Send`
// `PluginInstance` main-thread `handle` (`instance`). We assert it is sound to send
// because that handle is METHOD-CALLED exclusively on the control thread:
//   * `open` creates it on the control thread (compile/adopt);
//   * `save_state`/`restore_state` use it on the control thread, and ONLY while the
//     program is not yet published — i.e. before the backend is moved into the audio
//     callback (the engine captures/restores on freshly compiled, pre-publish
//     instances; a published backend is unreachable for state);
//   * `process` (audio thread) touches ONLY the `Send` `processor`, never `instance`;
//   * the backend is dropped on the control thread (the program-swap reclaim), so
//     the instance's `[main-thread]` teardown also runs off the audio thread.
// The backend may CROSS threads (control -> audio -> control) carrying the dormant
// handle, but the handle is never used on the audio thread, so no CLAP
// `[main-thread]` call can race `process`. This mirrors the JUCE backend's
// `unsafe impl Send` over its `*mut OjPlugin`.
unsafe impl Send for ClapBackend {}

pub(super) fn open_editor(_desc: &PluginDescriptor) -> Result<Box<dyn EditorBackend>, HostError> {
    Err(HostError::Unavailable)
}

impl HostedBackend for ClapBackend {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {
        // Already activated + processing in `open` (clack requires activation to
        // produce the `Send` processor). Nothing to do here.
    }

    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
        let processor = match self.processor.as_mut() {
            Some(p) => p,
            None => {
                for ch in outputs.iter_mut() {
                    for s in ch.iter_mut().take(nframes) {
                        *s = 0.0;
                    }
                }
                return;
            }
        };
        let n = nframes.min(self.max_block);

        // Copy caller inputs into our pre-allocated scratch (no alloc).
        for ch in 0..self.channels {
            let dst = &mut self.in_scratch[ch][..n];
            if let Some(src) = inputs.get(ch) {
                let m = n.min(src.len());
                dst[..m].copy_from_slice(&src[..m]);
                for s in dst[m..].iter_mut() {
                    *s = 0.0;
                }
            } else {
                for s in dst.iter_mut() {
                    *s = 0.0;
                }
            }
        }

        // Re-point the pre-sized AudioPorts at the scratch (reuses internal
        // lists; no heap traffic when capacity suffices).
        let input_buffers = self.in_ports.with_input_buffers([AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_input_only(self.in_scratch.iter_mut().map(|b| {
                InputChannel {
                    buffer: &mut b[..n],
                    is_constant: false,
                }
            })),
        }]);
        let mut output_buffers = self.out_ports.with_output_buffers([AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_output_only(
                self.out_scratch.iter_mut().map(|b| &mut b[..n]),
            ),
        }]);

        let in_events = InputEvents::from_buffer(&self.in_events);
        let mut out_events = OutputEvents::from_buffer(&mut self.out_events);

        let _ = processor.process(
            &input_buffers,
            &mut output_buffers,
            &in_events,
            &mut out_events,
            None,
            None,
        );

        // Copy the plugin's output back into the caller's buffers.
        for (ch, out) in outputs.iter_mut().enumerate() {
            if let Some(src) = self.out_scratch.get(ch) {
                let m = n.min(out.len());
                out[..m].copy_from_slice(&src[..m]);
            } else {
                for s in out.iter_mut().take(n) {
                    *s = 0.0;
                }
            }
        }
        self.out_events.clear();
        // Drop the param-value events we queued this block so they don't replay.
        self.in_events.clear();
    }

    fn set_param(&mut self, id: u16, value: f32) {
        // Queue a CLAP param-value event for the next `process` block; the plugin
        // reads it from `in_events` and applies it. CLAP_EVENT_PARAM_VALUE is a
        // CORE event — no extension is needed to SEND a value. `id` is the 0-based
        // index the manifest surfaced; map it to the plugin's stable `clap_id`.
        let Some(&clap_id) = self.param_ids.get(id as usize) else {
            return;
        };
        let event = clack_host::events::event_types::ParamValueEvent::new(
            0, // sample offset within the block
            clap_id,
            clack_host::events::Pckn::match_all(), // global: all ports/channels/keys
            value as f64,
            clack_host::utils::Cookie::empty(),
        );
        // Pre-reserved at `open`, so this push does not allocate on the RT thread.
        self.in_events.push(&event);
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        // Queue a CLAP NOTE_ON core event for the next `process` block, exactly
        // like `set_param` queues a PARAM_VALUE event. The plugin reads it from
        // `in_events`. PCKN = (port 0, channel 0, key = note, note_id = match-all):
        // we don't track per-note ids, so the note is addressed by key. CLAP
        // velocity is normalized 0..=1 (MIDI 0..=127 / 127).
        let event = clack_host::events::event_types::NoteOnEvent::new(
            0, // sample offset within the block
            clack_host::events::Pckn::from_raw(0, 0, note as i16, -1),
            vel as f64 / 127.0,
        );
        // Pre-reserved at `open`, so this push does not allocate on the RT thread.
        self.in_events.push(&event);
    }

    fn note_off(&mut self, note: u8) {
        // Mirror of `note_on`: a CLAP NOTE_OFF core event keyed by note, with a
        // 0.0 release velocity (we don't track release velocity).
        let event = clack_host::events::event_types::NoteOffEvent::new(
            0,
            clack_host::events::Pckn::from_raw(0, 0, note as i16, -1),
            0.0,
        );
        self.in_events.push(&event);
    }

    fn latency_samples(&self) -> u32 {
        self.latency
    }

    fn save_state(&self) -> Vec<u8> {
        // oj.state SAVE: serialize the plugin's opaque state via the CLAP
        // `clap_plugin_state` extension's `[main-thread]` save. Off-RT, control
        // thread, pre-publish (see the `unsafe impl Send` contract). A plugin with
        // no state extension, or a save that fails, yields an empty blob (the node
        // simply has nothing to persist) — never an error. `RefCell` gives the
        // `&mut` `plugin_handle()` needs from this `&self` method.
        use clack_extensions::state::PluginState;
        let mut guard = self.instance.borrow_mut();
        let Some(inst) = guard.as_mut() else {
            return Vec::new();
        };
        let Some(state) = inst.plugin_shared_handle().get_extension::<PluginState>() else {
            return Vec::new();
        };
        let mut buf = Vec::new();
        match state.save(&mut inst.plugin_handle(), &mut buf) {
            Ok(()) => buf,
            Err(_) => Vec::new(),
        }
    }

    fn restore_state(&mut self, blob: &[u8]) {
        // oj.state RESTORE: load a prior session's opaque blob via the CLAP state
        // extension's `[main-thread]` load. Off-RT, at compile time on the fresh
        // (pre-publish) instance. An empty blob or a plugin without the extension is
        // a no-op; a load failure is swallowed (the plugin keeps its default state).
        use clack_extensions::state::PluginState;
        if blob.is_empty() {
            return;
        }
        let mut guard = self.instance.borrow_mut();
        let Some(inst) = guard.as_mut() else {
            return;
        };
        let Some(state) = inst.plugin_shared_handle().get_extension::<PluginState>() else {
            return;
        };
        let mut reader = std::io::Cursor::new(blob);
        let _ = state.load(&mut inst.plugin_handle(), &mut reader);
    }

    fn deactivate(&mut self) {
        // Release both `Arc`s to the inner. Dropping the LAST one triggers clack's
        // `PluginInstanceInner::drop`, which stops processing, deactivates, and
        // destroys the plugin (the same teardown the sole-owner path relied on).
        self.processor = None;
        *self.instance.borrow_mut() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::{probe, PluginFormat};
    use std::path::Path;

    /// A non-CLAP candidate (a `.vst3`/`.component` the scan turns up next to
    /// real CLAPs) must be SKIPPED, never asserted on. Regression guard for the
    /// crash that aborted the app when the Plugins panel scanned a machine with
    /// VST3 plugins installed. The early return fires before any dynamic-library
    /// load, so the bogus path never touches the filesystem.
    #[test]
    fn probe_skips_non_clap_without_panicking() {
        for fmt in [PluginFormat::Vst2, PluginFormat::Vst3, PluginFormat::Au] {
            let got = probe(Path::new("/nonexistent/Plug.bin"), fmt)
                .expect("non-CLAP probe must be Ok(empty), never a panic or error");
            assert!(got.is_empty(), "non-CLAP probe must yield no descriptors");
        }
    }

    /// The note-event wiring `note_on`/`note_off` rely on: a NOTE_ON / NOTE_OFF
    /// CLAP core event must build from a key and push into the same pre-sized
    /// `EventBuffer` the RT path uses, then clear — proving the API usage compiles
    /// and behaves without needing a real instrument. (The full audible path is a
    /// `--features juce`/`clap-host` founder check with a real CLAP synth.)
    #[test]
    fn note_events_push_and_clear_without_allocating() {
        use clack_host::events::event_types::{NoteOffEvent, NoteOnEvent};
        use clack_host::events::Pckn;
        use clack_host::prelude::EventBuffer;

        let mut buf = EventBuffer::with_capacity(256);
        buf.push(&NoteOnEvent::new(
            0,
            Pckn::from_raw(0, 0, 60, -1),
            100.0 / 127.0,
        ));
        buf.push(&NoteOffEvent::new(0, Pckn::from_raw(0, 0, 60, -1), 0.0));
        assert_eq!(buf.len(), 2, "both note events queued");
        buf.clear();
        assert!(
            buf.is_empty(),
            "the block boundary drains queued note events"
        );
    }
}

/// Device-free verification of the `oj.state` save/restore round-trip through the
/// REAL [`ClapBackend`] — using an IN-PROCESS `clack` plugin
/// (`PluginEntry::load_from_clack`), so no `.clap` dylib and no audio device are
/// needed. This is what makes the CLAP state path a true CI test rather than only a
/// founder check: a stub plugin implements the actual CLAP `clap_plugin_state`
/// extension (save writes its current bytes, load replaces them), and we drive
/// [`open_from_entry`] -> [`HostedBackend::save_state`] / `restore_state` and assert
/// the blob round-trips through the live plugin's `[main-thread]` state calls.
#[cfg(test)]
mod state_roundtrip {
    use crate::descriptor::{PluginDescriptor, PluginFormat, PortCounts};
    use clack_extensions::state::{PluginState, PluginStateImpl};
    use clack_host::prelude::PluginEntry;
    use clack_plugin::prelude::*;
    use clack_plugin::stream::{InputStream, OutputStream};
    use std::io::{Read, Write};

    struct StubShared;
    impl<'a> PluginShared<'a> for StubShared {}

    /// Holds the plugin's opaque state — save writes it out, load replaces it.
    struct StubMainThread {
        value: Vec<u8>,
    }
    impl<'a> PluginMainThread<'a, StubShared> for StubMainThread {}
    impl PluginStateImpl for StubMainThread {
        fn save(&mut self, output: &mut OutputStream) -> Result<(), PluginError> {
            output.write_all(&self.value)?;
            Ok(())
        }
        fn load(&mut self, input: &mut InputStream) -> Result<(), PluginError> {
            let mut buf = Vec::new();
            input.read_to_end(&mut buf)?;
            self.value = buf;
            Ok(())
        }
    }

    struct StubAudio;
    impl<'a> PluginAudioProcessor<'a, StubShared, StubMainThread> for StubAudio {
        fn activate(
            _host: HostAudioProcessorHandle<'a>,
            _main_thread: &mut StubMainThread,
            _shared: &'a StubShared,
            _config: PluginAudioConfiguration,
        ) -> Result<Self, PluginError> {
            Ok(StubAudio)
        }
        fn process(
            &mut self,
            _process: Process,
            _audio: Audio,
            _events: Events,
        ) -> Result<ProcessStatus, PluginError> {
            Ok(ProcessStatus::Sleep)
        }
    }

    struct StubPlugin;
    impl Plugin for StubPlugin {
        type AudioProcessor<'a> = StubAudio;
        type Shared<'a> = StubShared;
        type MainThread<'a> = StubMainThread;
        fn declare_extensions(
            builder: &mut PluginExtensions<Self>,
            _shared: Option<&Self::Shared<'_>>,
        ) {
            builder.register::<PluginState>();
        }
    }
    impl DefaultPluginFactory for StubPlugin {
        fn get_descriptor() -> clack_plugin::plugin::PluginDescriptor {
            use clack_plugin::plugin::features::*;
            clack_plugin::plugin::PluginDescriptor::new("oj.test.stateful", "OJ Test Stateful")
                .with_features([SYNTHESIZER])
        }
        fn new_shared(_host: HostSharedHandle<'_>) -> Result<Self::Shared<'_>, PluginError> {
            Ok(StubShared)
        }
        fn new_main_thread<'a>(
            _host: HostMainThreadHandle<'a>,
            _shared: &'a Self::Shared<'a>,
        ) -> Result<Self::MainThread<'a>, PluginError> {
            // The state the plugin reports until something loads into it.
            Ok(StubMainThread {
                value: b"initial-state".to_vec(),
            })
        }
    }

    #[test]
    fn clap_state_round_trips_through_the_backend() {
        // In-process clack entry: no `.clap` dylib, no audio device.
        let entry = PluginEntry::load_from_clack::<SinglePluginEntry<StubPlugin>>(c"")
            .expect("in-process clack entry loads");
        let desc = PluginDescriptor {
            uid: "oj.test.stateful".to_string(),
            name: "OJ Test Stateful".to_string(),
            vendor: "OpenJammer".to_string(),
            path: String::new(),
            format: PluginFormat::Clap,
            is_instrument: true,
            ports: PortCounts {
                audio_in: 0,
                audio_out: 2,
            },
            param_count: 0,
            params: Vec::new(),
            latency_samples: 0,
        };
        let mut backend =
            super::open_from_entry(&entry, &desc, 48_000.0, 128).expect("backend opens");

        // SAVE reads the live plugin's current state via the CLAP state extension.
        assert_eq!(
            backend.save_state(),
            b"initial-state",
            "save_state reads the plugin's current opaque state"
        );

        // RESTORE a new blob, then SAVE again — the plugin's [main-thread] load/save
        // round-trips the opaque bytes through the real ClapBackend handle path.
        backend.restore_state(b"restored-blob");
        assert_eq!(
            backend.save_state(),
            b"restored-blob",
            "restore_state then save_state round-trips the opaque blob end to end"
        );

        // An empty restore is a no-op (does not clobber the current state).
        backend.restore_state(b"");
        assert_eq!(
            backend.save_state(),
            b"restored-blob",
            "an empty restore blob is ignored"
        );
    }
}
