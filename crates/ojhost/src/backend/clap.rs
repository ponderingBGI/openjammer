//! Pure-Rust CLAP backend (feature = "clap-host"), built on the `clack` host
//! crate (MIT, no C++). Supports CLAP only — VST3 / AU need the JUCE backend.
//!
//! # Threading model (the `Send` processor + the retained main-thread handle)
//!
//! `clack`'s [`PluginInstance`] is the MAIN-THREAD handle and is `!Send`. Its
//! [`StartedPluginAudioProcessor`], by contrast, IS `Send` (it owns an `Arc`
//! clone of the instance and is meant to be moved to the audio thread). So we:
//!
//! 1. on the loading thread, create an inactive instance so state can load;
//! 2. at the explicit lifecycle boundaries, `activate` and `start_processing`
//!    produce the `Send` audio processor (its own `Arc`);
//! 3. RETAIN the `!Send` [`PluginInstance`] handle in the backend (it owns a
//!    second `Arc` to the same inner) so the `oj.state` capability can call the
//!    CLAP `clap_plugin_state` save/load — which are `[main-thread]` and need this
//!    handle, not the audio processor;
//! 4. store the processor type-state + retained handle + pre-allocated scratch.
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
//!
//! # Sample format policy
//!
//! OpenJammer's graph is planar `f32`, so this boundary always supplies CLAP
//! 32-bit buffers, including when a port advertises `PREFERS_64BITS`. The CLAP
//! audio-ports contract requires every compliant plugin to support 32-bit data;
//! 64-bit support is optional. A non-compliant plugin that truly refuses `f32`
//! returns a process error and produces silence rather than forcing a per-block
//! conversion/allocation path into the realtime graph.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use clack_host::prelude::*;

use super::{EditorBackend, HostedBackend, HostedEvent, ParamGesture};
use crate::descriptor::{
    HostedAudioPort, HostedParam, HostedPortConfig, PluginDescriptor, PluginFormat, PortCounts,
};
use crate::error::HostError;

/// A minimal CLAP host: registers no extensions and ignores every callback.
/// Enough to scan and to render audio. A later unit can grow the handlers
/// (params / GUI / timer) without changing this crate's public surface.
struct OjClapHost;

#[derive(Default)]
struct HostSignals {
    callback: AtomicBool,
    flush: AtomicBool,
    param_rescan: AtomicU32,
    descriptor_rescan: AtomicBool,
    tail_changed: AtomicBool,
}

struct OjShared(Arc<HostSignals>);

impl<'a> SharedHandler<'a> for OjShared {
    fn request_restart(&self) {}
    fn request_process(&self) {}
    fn request_callback(&self) {
        // CLAP [thread-safe]: merely publish work. The audio thread never waits
        // for `on_main_thread`; the control thread services this flag later.
        self.0.callback.store(true, Ordering::Release);
    }
}

struct OjMainThread(Arc<HostSignals>);

impl<'a> MainThreadHandler<'a> for OjMainThread {}

impl clack_extensions::latency::HostLatencyImpl for OjMainThread {
    fn changed(&mut self) {
        super::request_latency_rescan();
    }
}

impl clack_extensions::params::HostParamsImplShared for OjShared {
    fn request_flush(&self) {
        // CLAP [thread-safe]: coalesce only. Flush is performed by the owning
        // control/audio context without a lock or cross-thread rendezvous.
        self.0.flush.store(true, Ordering::Release);
    }
}

impl clack_extensions::params::HostParamsImplMainThread for OjMainThread {
    fn rescan(&mut self, flags: clack_extensions::params::ParamRescanFlags) {
        self.0.param_rescan.fetch_or(flags.bits(), Ordering::AcqRel);
    }
    fn clear(
        &mut self,
        _param_id: clack_host::utils::ClapId,
        _flags: clack_extensions::params::ParamClearFlags,
    ) {
    }
}

impl clack_extensions::audio_ports::HostAudioPortsImpl for OjMainThread {
    fn is_rescan_flag_supported(
        &self,
        _flag: clack_extensions::audio_ports::AudioPortRescanFlags,
    ) -> bool {
        true
    }
    fn rescan(&mut self, _flags: clack_extensions::audio_ports::AudioPortRescanFlags) {
        self.0.descriptor_rescan.store(true, Ordering::Release);
    }
}

impl clack_extensions::audio_ports_config::HostAudioPortsConfigImpl for OjMainThread {
    fn rescan(&mut self) {
        self.0.descriptor_rescan.store(true, Ordering::Release);
    }
}

impl clack_extensions::note_ports::HostNotePortsImpl for OjMainThread {
    fn supported_dialects(&self) -> clack_extensions::note_ports::NoteDialects {
        clack_extensions::note_ports::NoteDialects::CLAP
            | clack_extensions::note_ports::NoteDialects::MIDI
    }
    fn rescan(&mut self, _flags: clack_extensions::note_ports::NotePortRescanFlags) {
        self.0.descriptor_rescan.store(true, Ordering::Release);
    }
}

struct OjAudio(Arc<HostSignals>);

impl AudioProcessorHandler<'_> for OjAudio {}

impl clack_extensions::tail::HostTailImpl for OjAudio {
    fn changed(&mut self) {
        // CLAP [audio-thread]: atomic notification only; no main-thread work or
        // blocking is permitted from the process callback.
        self.0.tail_changed.store(true, Ordering::Release);
    }
}

impl HostHandlers for OjClapHost {
    type Shared<'a> = OjShared;
    type MainThread<'a> = OjMainThread;
    type AudioProcessor<'a> = OjAudio;

    fn declare_extensions(builder: &mut HostExtensions<Self>, _shared: &Self::Shared<'_>) {
        builder.register::<clack_extensions::latency::HostLatency>();
        builder.register::<clack_extensions::params::HostParams>();
        builder.register::<clack_extensions::audio_ports::HostAudioPorts>();
        builder.register::<clack_extensions::audio_ports_config::HostAudioPortsConfig>();
        builder.register::<clack_extensions::note_ports::HostNotePorts>();
        builder.register::<clack_extensions::tail::HostTail>();
    }
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
        let features: Vec<String> = d
            .features()
            .map(|feature| feature.to_string_lossy().into_owned())
            .collect();
        let is_instrument = features
            .iter()
            .any(|feature| feature == "instrument" || feature == "synthesizer");
        let uid = cstr_to_string(d.id());
        // Briefly instantiate to read the plugin's parameter list (CLAP params
        // extension) so the UI shows real knobs with the plugin's own ranges.
        // Best-effort and off-RT: a plugin that fails to instantiate yields an
        // empty list (the node still loads; it just surfaces no params).
        let (params, audio_ports, port_configs, note_ports) = query_metadata(&entry, &uid);
        let audio_in = audio_ports
            .iter()
            .filter(|p| p.is_input)
            .map(|p| p.channel_count)
            .sum::<u32>()
            .min(u16::MAX as u32) as u16;
        let audio_out = audio_ports
            .iter()
            .filter(|p| !p.is_input)
            .map(|p| p.channel_count)
            .sum::<u32>()
            .min(u16::MAX as u32) as u16;
        out.push(PluginDescriptor {
            uid,
            name: cstr_to_string(d.name()),
            vendor: cstr_to_string(d.vendor()),
            path: path_str.clone(),
            format: PluginFormat::Clap,
            is_instrument,
            features,
            // clack 0.1.0 is pinned without the GUI extension; state this
            // honestly so the web surface never draws a dead editor glyph.
            has_gui: false,
            // CLAP reports ports via per-instance extensions; conservative
            // defaults here, refined on load.
            ports: PortCounts {
                audio_in: if audio_ports.is_empty() {
                    if is_instrument {
                        0
                    } else {
                        2
                    }
                } else {
                    audio_in
                },
                audio_out: if audio_ports.is_empty() { 2 } else { audio_out },
            },
            audio_ports,
            port_configs,
            note_ports,
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
fn query_metadata(
    entry: &PluginEntry,
    uid: &str,
) -> (
    Vec<HostedParam>,
    Vec<HostedAudioPort>,
    Vec<HostedPortConfig>,
    PortCounts,
) {
    use clack_extensions::params::{ParamInfoBuffer, PluginParams};

    let Ok(id) = std::ffi::CString::new(uid) else {
        return (
            Vec::new(),
            Vec::new(),
            Vec::new(),
            PortCounts {
                audio_in: 0,
                audio_out: 0,
            },
        );
    };
    let host = host_info();
    let mut instance = match PluginInstance::<OjClapHost>::new(
        |_| OjShared(Arc::new(HostSignals::default())),
        |shared| OjMainThread(Arc::clone(&shared.0)),
        entry,
        &id,
        &host,
    ) {
        Ok(i) => i,
        Err(_) => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                PortCounts {
                    audio_in: 0,
                    audio_out: 0,
                },
            )
        }
    };
    let params_ext = instance
        .plugin_shared_handle()
        .get_extension::<PluginParams>();
    let params_out = {
        let mut handle = instance.plugin_handle();
        let count = params_ext.map(|p| p.count(&mut handle)).unwrap_or(0);
        let mut params_out = Vec::with_capacity(count as usize);
        let mut buf = ParamInfoBuffer::new();
        for i in 0..count {
            if let Some(pi) = params_ext.and_then(|p| p.get_info(&mut handle, i, &mut buf)) {
                let name = String::from_utf8_lossy(pi.name)
                    .trim_end_matches('\0')
                    .to_string();
                let module = String::from_utf8_lossy(pi.module)
                    .trim_end_matches('\0')
                    .to_string();
                let unit = params_ext
                    .and_then(|p| {
                        let mut text = [0u8; 256];
                        p.value_to_text(&mut handle, pi.id, pi.default_value, &mut text)
                            .ok()
                            .map(|bytes| infer_unit(&String::from_utf8_lossy(bytes)))
                    })
                    .unwrap_or_default();
                params_out.push(HostedParam {
                    id: pi.id.get(),
                    name,
                    module,
                    flags: pi.flags.bits(),
                    unit,
                    min: pi.min_value,
                    max: pi.max_value,
                    default: pi.default_value,
                });
            }
        }
        params_out
    };

    let audio_ports = query_audio_ports(&mut instance);
    let port_configs = query_port_configs(&mut instance);
    let note_ports = query_note_ports(&mut instance);
    (params_out, audio_ports, port_configs, note_ports)
}

fn infer_unit(text: &str) -> String {
    text.trim()
        .trim_start_matches(|c: char| c.is_ascii_digit() || matches!(c, '-' | '+' | '.' | ','))
        .trim()
        .to_owned()
}

fn query_audio_ports(instance: &mut PluginInstance<OjClapHost>) -> Vec<HostedAudioPort> {
    use clack_extensions::audio_ports::{AudioPortFlags, AudioPortInfoBuffer, PluginAudioPorts};
    let Some(ext) = instance
        .plugin_shared_handle()
        .get_extension::<PluginAudioPorts>()
    else {
        return Vec::new();
    };
    let mut handle = instance.plugin_handle();
    let mut out = Vec::new();
    for is_input in [true, false] {
        for index in 0..ext.count(&mut handle, is_input) {
            let mut buf = AudioPortInfoBuffer::new();
            if let Some(info) = ext.get(&mut handle, index, is_input, &mut buf) {
                out.push(HostedAudioPort {
                    id: info.id.get(),
                    name: String::from_utf8_lossy(info.name)
                        .trim_end_matches('\0')
                        .to_owned(),
                    channel_count: info.channel_count,
                    is_input,
                    is_main: info.flags.contains(AudioPortFlags::IS_MAIN),
                    in_place_pair: info.in_place_pair.map(|id| id.get()),
                    port_type: info.port_type.map(|t| t.0.to_string_lossy().into_owned()),
                });
            }
        }
    }
    out
}

fn query_port_configs(instance: &mut PluginInstance<OjClapHost>) -> Vec<HostedPortConfig> {
    use clack_extensions::audio_ports_config::{AudioPortsConfigBuffer, PluginAudioPortsConfig};
    let Some(ext) = instance
        .plugin_shared_handle()
        .get_extension::<PluginAudioPortsConfig>()
    else {
        return Vec::new();
    };
    let mut handle = instance.plugin_handle();
    let mut out = Vec::new();
    for index in 0..ext.count(&mut handle) {
        let mut buf = AudioPortsConfigBuffer::new();
        if let Some(info) = ext.get(&mut handle, index, &mut buf) {
            out.push(HostedPortConfig {
                id: info.id.get(),
                name: String::from_utf8_lossy(info.name)
                    .trim_end_matches('\0')
                    .to_owned(),
                input_ports: info.input_port_count,
                output_ports: info.output_port_count,
                input_channels: info.main_input.map(|p| p.channel_count).unwrap_or(0),
                output_channels: info.main_output.map(|p| p.channel_count).unwrap_or(0),
            });
        }
    }
    out
}

fn query_note_ports(instance: &mut PluginInstance<OjClapHost>) -> PortCounts {
    use clack_extensions::note_ports::PluginNotePorts;
    let Some(ext) = instance
        .plugin_shared_handle()
        .get_extension::<PluginNotePorts>()
    else {
        return PortCounts {
            audio_in: 0,
            audio_out: 0,
        };
    };
    let mut handle = instance.plugin_handle();
    PortCounts {
        audio_in: ext.count(&mut handle, true).min(u16::MAX as u32) as u16,
        audio_out: ext.count(&mut handle, false).min(u16::MAX as u32) as u16,
    }
}

/// Open a CLAP plugin into an inactive [`HostedBackend`]. Activation and
/// processing start remain explicit so state restoration is ordered first.
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
/// It returns an inactive instance by construction.
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

    let signals = Arc::new(HostSignals::default());
    let shared_signals = Arc::clone(&signals);
    let main_signals = Arc::clone(&signals);
    let mut instance = PluginInstance::<OjClapHost>::new(
        move |_| OjShared(shared_signals),
        move |_| OjMainThread(main_signals),
        entry,
        &id,
        &info,
    )
    .map_err(|e| HostError::Load {
        message: e.to_string(),
    })?;
    let sends_clap_notes = plugin_accepts_clap_notes(&mut instance);

    // RETAIN the `!Send` main-thread `instance` handle (moved into the backend
    // below) so the `oj.state` save/restore can reach the CLAP state extension — it
    // owns a second `Arc` to the inner alongside `started`. The caller's `entry`
    // stays borrowed for this call; the instance keeps its own internal clone.
    let channels = desc.ports.audio_out.max(desc.ports.audio_in).max(1) as usize;
    let in_layout = port_layout(desc, true);
    let out_layout = port_layout(desc, false);
    // Map each surfaced param (by index) to its CLAP id, so `set_param(index, _)`
    // can build a param-value event targeting the plugin's stable id.
    let param_ids: Vec<clack_host::utils::ClapId> = desc
        .params
        .iter()
        .filter_map(|p| clack_host::utils::ClapId::from_raw(p.id))
        .collect();
    Ok(Box::new(ClapBackend {
        processor: None,
        stopped: None,
        // Retained main-thread handle for oj.state save/restore (see module doc +
        // the `unsafe impl Send` contract). `RefCell` because `save_state(&self)`
        // needs `&mut` for `plugin_handle()`; `Option` so `deactivate` can release
        // it. Touched only on the control thread.
        instance: std::cell::RefCell::new(Some(instance)),
        in_ports: AudioPorts::with_capacity(channels, in_layout.len()),
        out_ports: AudioPorts::with_capacity(channels, out_layout.len()),
        in_scratch: vec![vec![0.0f32; max_block]; channels],
        out_scratch: vec![vec![0.0f32; max_block]; channels],
        // Pre-sized so `set_param`'s param-value pushes AND `note_on`/`note_off`'s
        // note pushes don't allocate on the RT thread (the buffer is cleared each
        // block in `process`). Headroom for a dense chord + an automation burst in
        // one block so `EventBuffer::push` never has to grow.
        in_events: EventBuffer::with_capacity(256),
        // Plugins may emit gestures and NOTE_END from process. Reserve on the
        // control thread so their OutputEvents pushes do not allocate on RT.
        out_events: EventBuffer::with_capacity(256),
        channels,
        max_block,
        latency: 0,
        tail: clack_extensions::tail::TailLength::Finite(0),
        param_ids,
        signals,
        sample_rate,
        pending_gestures: Vec::with_capacity(256),
        pending_output_events: Vec::with_capacity(256),
        sends_clap_notes,
        in_layout,
        out_layout,
    }))
}

/// One live CLAP plugin's audio-thread half + pre-allocated RT scratch + the
/// retained main-thread handle for `oj.state`.
struct ClapBackend {
    /// The `Send` audio processor; one of two `Arc` owners of the inner (the other
    /// is `instance`). `Option` so `deactivate` can take it.
    processor: Option<StartedPluginAudioProcessor<OjClapHost>>,
    /// Activated but not processing. CLAP's type-state makes it impossible to
    /// call `process` or inactive-only APIs from the wrong lifecycle phase.
    stopped: Option<StoppedPluginAudioProcessor<OjClapHost>>,
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
    /// Reusable, preallocated input and plugin-output event buffers.
    in_events: EventBuffer,
    out_events: EventBuffer,
    channels: usize,
    max_block: usize,
    latency: u32,
    tail: clack_extensions::tail::TailLength,
    /// Index -> CLAP `clap_id` map (from the scanned param list). `set_param`
    /// addresses params by 0-based index; this resolves it to the plugin's id.
    param_ids: Vec<clack_host::utils::ClapId>,
    signals: Arc<HostSignals>,
    sample_rate: f32,
    pending_gestures: Vec<ParamGesture>,
    pending_output_events: Vec<HostedEvent>,
    sends_clap_notes: bool,
    in_layout: Vec<usize>,
    out_layout: Vec<usize>,
}

fn port_layout(desc: &PluginDescriptor, input: bool) -> Vec<usize> {
    if desc.audio_ports.is_empty() {
        let channels = if input {
            desc.ports.audio_in
        } else {
            desc.ports.audio_out
        };
        return (channels != 0)
            .then_some(vec![channels as usize])
            .unwrap_or_default();
    }
    desc.audio_ports
        .iter()
        .filter(|port| port.is_input == input)
        .map(|port| port.channel_count as usize)
        .collect()
}

fn plugin_accepts_clap_notes(instance: &mut PluginInstance<OjClapHost>) -> bool {
    use clack_extensions::note_ports::{NoteDialect, NotePortInfoBuffer, PluginNotePorts};
    let Some(ext) = instance
        .plugin_shared_handle()
        .get_extension::<PluginNotePorts>()
    else {
        return false;
    };
    let mut handle = instance.plugin_handle();
    if ext.count(&mut handle, true) == 0 {
        return false;
    }
    let mut buffer = NotePortInfoBuffer::new();
    ext.get(&mut handle, 0, true, &mut buffer)
        .is_some_and(|info| info.supported_dialects.supports(NoteDialect::Clap))
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
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        if self.processor.is_some() || self.stopped.is_some() {
            return;
        }
        let mut guard = self.instance.borrow_mut();
        let Some(instance) = guard.as_mut() else {
            return;
        };
        let config = PluginAudioConfiguration {
            sample_rate: sample_rate as f64,
            min_frames_count: 1,
            max_frames_count: self.max_block as u32,
        };
        // CLAP [main-thread]: activation occurs only from DspInstance::activate,
        // before publication to the RT program. State restoration therefore has
        // already happened on the inactive instance.
        let Ok(mut stopped) = instance.activate(|shared, _| OjAudio(Arc::clone(&shared.0)), config)
        else {
            return;
        };
        self.latency = instance
            .plugin_shared_handle()
            .get_extension::<clack_extensions::latency::PluginLatency>()
            .map(|ext| ext.get(&mut instance.plugin_handle()))
            .unwrap_or(0);
        self.tail = stopped
            .shared_plugin_handle()
            .get_extension::<clack_extensions::tail::PluginTail>()
            .map(|ext| ext.get(&stopped.plugin_handle()))
            .unwrap_or_default();
        self.sample_rate = sample_rate;
        self.stopped = Some(stopped);
    }

    fn start_processing(&mut self) {
        if self.processor.is_none() {
            if let Some(stopped) = self.stopped.take() {
                // CLAP [audio-thread]: type-state confines start_processing to
                // this lifecycle boundary; it never calls a main-thread API.
                match stopped.start_processing() {
                    Ok(started) => self.processor = Some(started),
                    Err(error) => self.stopped = Some(error.into_stopped_processor()),
                }
            }
        }
    }

    fn stop_processing(&mut self) {
        if let Some(started) = self.processor.take() {
            // CLAP [audio-thread]: stop is paired with start and is nonblocking.
            self.stopped = Some(started.stop_processing());
        }
    }

    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], nframes: usize) {
        if self.processor.is_none() {
            self.start_processing();
        }
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
        let in_scratch = self.in_scratch.as_mut_ptr();
        let mut in_offset = 0usize;
        let input_buffers = self
            .in_ports
            .with_input_buffers(self.in_layout.iter().map(|count| {
                let start = in_offset;
                in_offset += *count;
                // SAFETY: `port_layout` partitions `[0, channels)` into disjoint,
                // ordered ranges and `in_scratch` is not otherwise borrowed until
                // the CLAP process call returns. Each pointer still addresses a
                // separately allocated channel Vec; only the Vec headers are sliced.
                let port = unsafe { std::slice::from_raw_parts_mut(in_scratch.add(start), *count) };
                AudioPortBuffer {
                    latency: 0,
                    channels: AudioPortBufferType::f32_input_only(port.iter_mut().map(|buffer| {
                        InputChannel {
                            buffer: &mut buffer[..n],
                            is_constant: false,
                        }
                    })),
                }
            }));
        let out_scratch = self.out_scratch.as_mut_ptr();
        let mut out_offset = 0usize;
        let mut output_buffers = self
            .out_ports
            .with_output_buffers(self.out_layout.iter().map(|count| {
                let start = out_offset;
                out_offset += *count;
                // SAFETY: same disjoint partition argument as `in_scratch` above;
                // input and output scratch are separate allocations.
                let port =
                    unsafe { std::slice::from_raw_parts_mut(out_scratch.add(start), *count) };
                AudioPortBuffer {
                    latency: 0,
                    channels: AudioPortBufferType::f32_output_only(
                        port.iter_mut().map(|buffer| &mut buffer[..n]),
                    ),
                }
            }));

        // CLAP requires monotonically ordered timestamps and preserves order at
        // equal timestamps. Bridge callers enqueue in `at_frame` order (the
        // engine already splits its absolute-time queue into ordered spans), so
        // do not use EventBuffer::sort here: it is unstable and could invert a
        // same-sample note-off/note-on pair.
        debug_assert!({
            let mut prior = 0;
            self.in_events.iter().all(|event| {
                let ordered = event.header().time() >= prior;
                prior = event.header().time();
                ordered
            })
        });
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

        if self.signals.tail_changed.swap(false, Ordering::AcqRel) {
            self.tail = processor
                .shared_plugin_handle()
                .get_extension::<clack_extensions::tail::PluginTail>()
                .map(|ext| ext.get(&processor.plugin_handle()))
                .unwrap_or_default();
        }

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
        capture_output_events(
            &self.out_events,
            &mut self.pending_gestures,
            &mut self.pending_output_events,
        );
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
        if self.processor.is_none() {
            self.flush_inactive_params();
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        // Queue a CLAP NOTE_ON core event for the next `process` block, exactly
        // like `set_param` queues a PARAM_VALUE event. The plugin reads it from
        // `in_events`. PCKN = (port 0, channel 0, key = note, note_id = match-all):
        // we don't track per-note ids, so the note is addressed by key. CLAP
        // velocity is normalized 0..=1 (MIDI 0..=127 / 127).
        if self.sends_clap_notes {
            let event = clack_host::events::event_types::NoteOnEvent::new(
                0,
                clack_host::events::Pckn::from_raw(0, 0, note as i16, -1),
                vel as f64 / 127.0,
            );
            self.in_events.push(&event);
        } else {
            // MIDI 1.0 is the mandatory compatibility dialect for legacy-style
            // CLAP instruments that do not accept native CLAP note events.
            self.in_events
                .push(&clack_host::events::event_types::MidiEvent::new(
                    0,
                    0,
                    [0x90, note, vel],
                ));
        }
    }

    fn note_off(&mut self, note: u8) {
        // Mirror of `note_on`: a CLAP NOTE_OFF core event keyed by note, with a
        // 0.0 release velocity (we don't track release velocity).
        if self.sends_clap_notes {
            self.in_events
                .push(&clack_host::events::event_types::NoteOffEvent::new(
                    0,
                    clack_host::events::Pckn::from_raw(0, 0, note as i16, -1),
                    0.0,
                ));
        } else {
            self.in_events
                .push(&clack_host::events::event_types::MidiEvent::new(
                    0,
                    0,
                    [0x80, note, 0],
                ));
        }
    }

    fn queue_event(&mut self, event: HostedEvent) {
        use clack_host::events::event_types::{
            MidiEvent, NoteChokeEvent, NoteEndEvent, NoteOffEvent, NoteOnEvent, ParamValueEvent,
        };
        match event {
            HostedEvent::Param {
                at_frame,
                id,
                value,
            } => {
                if let Some(&param_id) = self.param_ids.get(id as usize) {
                    self.in_events.push(&ParamValueEvent::new(
                        at_frame,
                        param_id,
                        clack_host::events::Pckn::match_all(),
                        value,
                        clack_host::utils::Cookie::empty(),
                    ));
                }
            }
            HostedEvent::NoteOn {
                at_frame,
                port,
                channel,
                key,
                note_id,
                velocity,
            } => self.in_events.push(&NoteOnEvent::new(
                at_frame,
                clack_host::events::Pckn::from_raw(port, channel, key, note_id),
                velocity,
            )),
            HostedEvent::NoteOff {
                at_frame,
                port,
                channel,
                key,
                note_id,
                velocity,
            } => self.in_events.push(&NoteOffEvent::new(
                at_frame,
                clack_host::events::Pckn::from_raw(port, channel, key, note_id),
                velocity,
            )),
            HostedEvent::NoteChoke {
                at_frame,
                port,
                channel,
                key,
                note_id,
            } => self.in_events.push(&NoteChokeEvent::new(
                at_frame,
                clack_host::events::Pckn::from_raw(port, channel, key, note_id),
            )),
            HostedEvent::NoteEnd {
                at_frame,
                port,
                channel,
                key,
                note_id,
            } => self.in_events.push(&NoteEndEvent::new(
                at_frame,
                clack_host::events::Pckn::from_raw(port, channel, key, note_id),
            )),
            HostedEvent::Midi {
                at_frame,
                port,
                data,
            } => self.in_events.push(&MidiEvent::new(at_frame, port, data)),
        }
    }

    fn latency_samples(&self) -> u32 {
        self.latency
    }

    fn tail_samples(&self) -> Option<u32> {
        match self.tail {
            clack_extensions::tail::TailLength::Finite(samples) => Some(samples),
            clack_extensions::tail::TailLength::Infinite => None,
        }
    }

    fn param_value_to_text(&mut self, id: u16, value: f64) -> Option<String> {
        self.service_main_thread_callback();
        use clack_extensions::params::PluginParams;
        let param_id = *self.param_ids.get(id as usize)?;
        let mut guard = self.instance.borrow_mut();
        let instance = guard.as_mut()?;
        let ext = instance
            .plugin_shared_handle()
            .get_extension::<PluginParams>()?;
        let mut text = [0u8; 256];
        let bytes = ext
            .value_to_text(&mut instance.plugin_handle(), param_id, value, &mut text)
            .ok()?;
        Some(String::from_utf8_lossy(bytes).into_owned())
    }

    fn param_text_to_value(&mut self, id: u16, text: &str) -> Option<f64> {
        self.service_main_thread_callback();
        use clack_extensions::params::PluginParams;
        let param_id = *self.param_ids.get(id as usize)?;
        let text = std::ffi::CString::new(text).ok()?;
        let mut guard = self.instance.borrow_mut();
        let instance = guard.as_mut()?;
        let ext = instance
            .plugin_shared_handle()
            .get_extension::<PluginParams>()?;
        ext.text_to_value(&mut instance.plugin_handle(), param_id, &text)
    }

    fn take_param_gestures(&mut self) -> Vec<ParamGesture> {
        std::mem::take(&mut self.pending_gestures)
    }

    fn take_output_events(&mut self) -> Vec<HostedEvent> {
        std::mem::take(&mut self.pending_output_events)
    }

    fn take_descriptor_rescan_request(&self) -> bool {
        let param = self.signals.param_rescan.swap(0, Ordering::AcqRel);
        self.signals.descriptor_rescan.swap(false, Ordering::AcqRel) || param != 0
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
        let _ = self.restore_state_checked(blob);
    }

    fn restore_state_checked(&mut self, blob: &[u8]) -> bool {
        self.service_main_thread_callback();
        // oj.state RESTORE: load a prior session's opaque blob via the CLAP state
        // extension's `[main-thread]` load. Off-RT, at compile time on the fresh
        // (pre-publish) instance. An empty blob or a plugin without the extension is
        // a no-op; a load failure is swallowed (the plugin keeps its default state).
        use clack_extensions::state::PluginState;
        if blob.is_empty() {
            return true;
        }
        let mut guard = self.instance.borrow_mut();
        let Some(inst) = guard.as_mut() else {
            return false;
        };
        let Some(state) = inst.plugin_shared_handle().get_extension::<PluginState>() else {
            return false;
        };
        let mut reader = std::io::Cursor::new(blob);
        state.load(&mut inst.plugin_handle(), &mut reader).is_ok()
    }

    fn deactivate(&mut self) {
        // Release both `Arc`s to the inner. Dropping the LAST one triggers clack's
        // `PluginInstanceInner::drop`, which stops processing, deactivates, and
        // destroys the plugin (the same teardown the sole-owner path relied on).
        self.stop_processing();
        if let (Some(stopped), Some(instance)) =
            (self.stopped.take(), self.instance.borrow_mut().as_mut())
        {
            // CLAP [main-thread]: deactivation/destroy is reclaimed off RT.
            instance.deactivate(stopped);
        }
    }
}

impl Drop for ClapBackend {
    fn drop(&mut self) {
        self.deactivate();
        // CLAP [main-thread]: final instance destruction happens on the control
        // thread after deactivation; the audio processor Arc is already gone.
        *self.instance.borrow_mut() = None;
    }
}

impl ClapBackend {
    fn service_main_thread_callback(&mut self) {
        if self.signals.callback.swap(false, Ordering::AcqRel) {
            let mut guard = self.instance.borrow_mut();
            if let Some(instance) = guard.as_mut() {
                // CLAP [main-thread]: callbacks requested from arbitrary/plugin
                // threads are serviced only from an explicit off-RT bridge call.
                instance.call_on_main_thread_callback();
            }
        }
        if self.signals.flush.swap(false, Ordering::AcqRel) {
            self.flush_inactive_params();
        }
    }

    fn flush_inactive_params(&mut self) {
        use clack_extensions::params::PluginParams;
        let input = InputEvents::from_buffer(&self.in_events);
        let mut output = OutputEvents::from_buffer(&mut self.out_events);
        if let Some(stopped) = self.stopped.as_mut() {
            let Some(ext) = stopped
                .shared_plugin_handle()
                .get_extension::<PluginParams>()
            else {
                return;
            };
            // CLAP [audio-thread]: stopped type-state statically excludes a
            // concurrent process call.
            ext.flush_active(&mut stopped.plugin_handle(), &input, &mut output);
        } else {
            let mut guard = self.instance.borrow_mut();
            let Some(instance) = guard.as_mut() else {
                return;
            };
            let Some(ext) = instance
                .plugin_shared_handle()
                .get_extension::<PluginParams>()
            else {
                return;
            };
            let Some(mut handle) = instance.inactive_plugin_handle() else {
                return;
            };
            // CLAP [main-thread, inactive]: `InactivePluginMainThreadHandle`
            // makes this flush uncallable after activation.
            ext.flush(&mut handle, &input, &mut output);
        }
        self.in_events.clear();
        capture_output_events(
            &self.out_events,
            &mut self.pending_gestures,
            &mut self.pending_output_events,
        );
        self.out_events.clear();
    }
}

fn capture_output_events(
    events: &EventBuffer,
    gestures: &mut Vec<ParamGesture>,
    notes: &mut Vec<HostedEvent>,
) {
    use clack_host::events::event_types::{
        NoteChokeEvent, NoteEndEvent, NoteOffEvent, NoteOnEvent, ParamGestureBeginEvent,
        ParamGestureEndEvent, ParamValueEvent,
    };
    for event in events {
        if let Some(begin) = event.as_event::<ParamGestureBeginEvent>() {
            if let Some(id) = begin.param_id() {
                if gestures.len() < gestures.capacity() {
                    gestures.push(ParamGesture::Begin { id: id.get() });
                }
            }
        } else if let Some(value) = event.as_event::<ParamValueEvent>() {
            if let Some(id) = value.param_id() {
                if gestures.len() < gestures.capacity() {
                    gestures.push(ParamGesture::Adjust {
                        id: id.get(),
                        value: value.value(),
                    });
                }
            }
        } else if let Some(end) = event.as_event::<ParamGestureEndEvent>() {
            if let Some(id) = end.param_id() {
                if gestures.len() < gestures.capacity() {
                    gestures.push(ParamGesture::End { id: id.get() });
                }
            }
        } else if let Some(note) = event.as_event::<NoteOnEvent>() {
            push_note_output(
                notes,
                note.pckn(),
                event.header().time(),
                0,
                note.velocity(),
            );
        } else if let Some(note) = event.as_event::<NoteOffEvent>() {
            push_note_output(
                notes,
                note.pckn(),
                event.header().time(),
                1,
                note.velocity(),
            );
        } else if let Some(note) = event.as_event::<NoteChokeEvent>() {
            push_note_output(notes, note.pckn(), event.header().time(), 2, 0.0);
        } else if let Some(note) = event.as_event::<NoteEndEvent>() {
            push_note_output(notes, note.pckn(), event.header().time(), 3, 0.0);
        }
    }
}

fn push_note_output(
    target: &mut Vec<HostedEvent>,
    pckn: clack_host::events::Pckn,
    time: u32,
    kind: u8,
    velocity: f64,
) {
    if target.len() >= target.capacity() {
        return;
    }
    let event = match kind {
        0 => HostedEvent::NoteOn {
            at_frame: time,
            port: pckn.raw_port_index(),
            channel: pckn.raw_channel(),
            key: pckn.raw_key(),
            note_id: pckn.raw_note_id(),
            velocity,
        },
        1 => HostedEvent::NoteOff {
            at_frame: time,
            port: pckn.raw_port_index(),
            channel: pckn.raw_channel(),
            key: pckn.raw_key(),
            note_id: pckn.raw_note_id(),
            velocity,
        },
        2 => HostedEvent::NoteChoke {
            at_frame: time,
            port: pckn.raw_port_index(),
            channel: pckn.raw_channel(),
            key: pckn.raw_key(),
            note_id: pckn.raw_note_id(),
        },
        _ => HostedEvent::NoteEnd {
            at_frame: time,
            port: pckn.raw_port_index(),
            channel: pckn.raw_channel(),
            key: pckn.raw_key(),
            note_id: pckn.raw_note_id(),
        },
    };
    target.push(event);
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
    use clack_extensions::latency::{HostLatencyImpl, PluginLatency, PluginLatencyImpl};
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
    impl PluginLatencyImpl for StubMainThread {
        fn get(&mut self) -> u32 {
            37
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
            builder.register::<PluginLatency>();
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
            features: vec!["instrument".into(), "synthesizer".into()],
            has_gui: false,
            ports: PortCounts {
                audio_in: 0,
                audio_out: 2,
            },
            audio_ports: Vec::new(),
            port_configs: Vec::new(),
            note_ports: PortCounts::default(),
            param_count: 0,
            params: Vec::new(),
            latency_samples: 0,
        };
        let mut backend =
            super::open_from_entry(&entry, &desc, 48_000.0, 128).expect("backend opens");

        // The backend is intentionally inactive after open so state can be
        // restored first; activation makes latency authoritative.
        backend.activate(48_000.0, 128);
        assert_eq!(backend.latency_samples(), 37);

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

    #[test]
    fn clap_latency_changed_requests_control_thread_rescan() {
        let _ = crate::take_latency_rescan_request();
        let mut handler = super::OjMainThread(std::sync::Arc::new(super::HostSignals::default()));
        HostLatencyImpl::changed(&mut handler);
        assert!(crate::take_latency_rescan_request());
        assert!(
            !crate::take_latency_rescan_request(),
            "request is coalesced"
        );
    }
}
