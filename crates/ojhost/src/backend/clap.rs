//! Pure-Rust CLAP backend (feature = "clap-host"), built on the `clack` host
//! crate (MIT, no C++). Supports CLAP only — VST3 / AU need the JUCE backend.
//!
//! # Threading model (why we store only the audio processor)
//!
//! `clack`'s [`PluginInstance`] is the MAIN-THREAD handle and is `!Send`. Its
//! [`StartedPluginAudioProcessor`], by contrast, IS `Send` (it owns an `Arc`
//! clone of the instance and is meant to be moved to the audio thread). So we:
//!
//! 1. on the loading thread, create the instance, `activate`, and
//!    `start_processing` to obtain the `Send` audio processor;
//! 2. drop the `!Send` [`PluginInstance`] handle — `clack` leaks its handle when
//!    the audio processor still holds the `Arc`, so the instance stays alive and
//!    is fully torn down (deactivated + destroyed) when the processor drops;
//! 3. store ONLY the `Send` processor (+ pre-allocated scratch) in the backend.
//!
//! This is exactly the lifecycle `clack` documents for sending a plugin to the
//! audio thread, and it makes [`ClapBackend`] genuinely `Send` (so the engine
//! can move a freshly-loaded plugin onto the RT thread) without `unsafe`.
//!
//! # Real-time safety
//!
//! The CLAP `process` callback runs on the audio thread and must not allocate.
//! We pre-size the input/output [`AudioPorts`] and our per-channel scratch in
//! [`open`]; per block we copy into the scratch, re-point the (pre-sized)
//! `AudioPorts` at it (which reuses internal lists when capacity suffices), call
//! `process`, and copy back out. No heap traffic on the hot path.

use std::path::Path;

use clack_host::events::event_types::{NoteOffEvent, NoteOnEvent, ParamValueEvent};
use clack_host::events::Match;
use clack_host::prelude::*;
use clack_host::utils::Cookie;

use super::HostedBackend;
use crate::descriptor::{PluginDescriptor, PluginFormat, PortCounts};
use crate::error::HostError;

/// Max control events (note-on/off + param-value) buffered between two
/// `process` calls. [`ClapBackend::in_events`] is pre-allocated to this many of
/// the LARGEST CLAP event (via [`EventBuffer::with_capacity`]) at `open`, and
/// every queue helper refuses to push past it, so the RT-thread event pushes are
/// **guaranteed allocation-free** (the `HostedBackend::set_param`/`note_*`
/// contract). 256 is far beyond the handful of control events a real block ever
/// carries; the cap is a hard RT-safety floor, not an expected limit.
const EVENT_CAPACITY: usize = 256;

/// Queue a CLAP note-on for the plugin's next `process` block. Sample-accurate
/// time 0 (block start); `Match::All` note-id lets the plugin assign its own
/// voice id. No-op (never allocs) once [`EVENT_CAPACITY`] is reached.
fn queue_note_on(buf: &mut EventBuffer, count: &mut usize, note: u8, vel: u8) {
    if *count >= EVENT_CAPACITY {
        return;
    }
    let pckn = Pckn::new(0u16, 0u16, note as u16, Match::All);
    buf.push(&NoteOnEvent::new(0, pckn, vel as f64 / 127.0));
    *count += 1;
}

/// Queue a CLAP note-off (velocity 0) for the next block. See [`queue_note_on`].
fn queue_note_off(buf: &mut EventBuffer, count: &mut usize, note: u8) {
    if *count >= EVENT_CAPACITY {
        return;
    }
    let pckn = Pckn::new(0u16, 0u16, note as u16, Match::All);
    buf.push(&NoteOffEvent::new(0, pckn, 0.0));
    *count += 1;
}

/// Queue a CLAP param-value change for the next block. `id` is treated as the
/// plugin's `clap_id` with an empty [`Cookie`] (the spec-allowed lookup-by-id
/// path); plugins that key automation on a host-supplied cookie are refined when
/// the `clack-extensions` params extension is wired (see crate README).
fn queue_param(buf: &mut EventBuffer, count: &mut usize, id: u16, value: f32) {
    if *count >= EVENT_CAPACITY {
        return;
    }
    let ev = ParamValueEvent::new(
        0,
        ClapId::new(id as u32),
        Pckn::match_all(),
        value as f64,
        Cookie::empty(),
    );
    buf.push(&ev);
    *count += 1;
}

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
    debug_assert_eq!(format, PluginFormat::Clap, "clap backend only probes CLAP");

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
        out.push(PluginDescriptor {
            uid: cstr_to_string(d.id()),
            name: cstr_to_string(d.name()),
            vendor: cstr_to_string(d.vendor()),
            path: path_str.clone(),
            format: PluginFormat::Clap,
            is_instrument,
            // CLAP reports ports/params via per-instance extensions; we fill
            // conservative defaults at scan time and refine on load.
            ports: PortCounts {
                audio_in: if is_instrument { 0 } else { 2 },
                audio_out: 2,
            },
            param_count: 0,
            latency_samples: 0,
        });
    }
    Ok(out)
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
    let info = host_info();
    let id = std::ffi::CString::new(desc.uid.as_str()).map_err(|_| HostError::Load {
        message: "plugin uid contains an interior NUL".into(),
    })?;

    let mut instance =
        PluginInstance::<OjClapHost>::new(|_| OjShared, |_| OjMainThread, &entry, &id, &info)
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

    // Drop the !Send main-thread handles. `clack` leaks the instance handle
    // because the audio processor still owns an `Arc` to it, so the plugin stays
    // alive and is torn down when `started` drops. `entry` is also kept alive by
    // the instance's internal clone.
    drop(instance);
    drop(entry);

    let channels = desc.ports.audio_out.max(desc.ports.audio_in).max(1) as usize;
    Ok(Box::new(ClapBackend {
        processor: Some(started),
        in_ports: AudioPorts::with_capacity(channels, 1),
        out_ports: AudioPorts::with_capacity(channels, 1),
        in_scratch: vec![vec![0.0f32; max_block]; channels],
        out_scratch: vec![vec![0.0f32; max_block]; channels],
        // Pre-allocated off-RT so the per-block control-event pushes never alloc.
        in_events: EventBuffer::with_capacity(EVENT_CAPACITY),
        out_events: EventBuffer::with_capacity(EVENT_CAPACITY),
        events_this_block: 0,
        channels,
        max_block,
        latency: desc.latency_samples,
    }))
}

/// One live CLAP plugin's audio-thread half + pre-allocated RT scratch.
struct ClapBackend {
    /// The `Send` audio processor; sole `Arc` owner of the instance once the
    /// main-thread handle is dropped. `Option` so `deactivate` can take it.
    processor: Option<StartedPluginAudioProcessor<OjClapHost>>,
    /// Pre-sized input/output port wrappers (reused every block).
    in_ports: AudioPorts,
    out_ports: AudioPorts,
    /// Per-channel input/output scratch, allocated once at `open`.
    in_scratch: Vec<Vec<f32>>,
    out_scratch: Vec<Vec<f32>>,
    /// Control events queued for the next block (note-on/off, param-value) and
    /// the plugin's own output events. `in_events` is drained + cleared each
    /// `process`; both are pre-sized to [`EVENT_CAPACITY`] so pushes never alloc.
    in_events: EventBuffer,
    out_events: EventBuffer,
    /// Count of events queued into `in_events` since the last `process`, so the
    /// queue helpers can hard-cap at [`EVENT_CAPACITY`] without an O(n) length
    /// scan on the RT thread.
    events_this_block: usize,
    channels: usize,
    max_block: usize,
    latency: u32,
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
        // The plugin has consumed this block's input events; reset so the next
        // block's note/param queue starts empty. `clear` retains the pre-sized
        // capacity, keeping subsequent pushes allocation-free.
        self.in_events.clear();
        self.events_this_block = 0;
        self.out_events.clear();
    }

    fn set_param(&mut self, id: u16, value: f32) {
        queue_param(&mut self.in_events, &mut self.events_this_block, id, value);
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        queue_note_on(&mut self.in_events, &mut self.events_this_block, note, vel);
    }

    fn note_off(&mut self, note: u8) {
        queue_note_off(&mut self.in_events, &mut self.events_this_block, note);
    }

    fn latency_samples(&self) -> u32 {
        self.latency
    }

    fn deactivate(&mut self) {
        // Dropping the processor (sole Arc owner) stops processing, deactivates,
        // and destroys the instance via clack's PluginInstanceInner::drop.
        self.processor = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The note/param queue helpers form well-typed CLAP events, land them in a
    /// pre-sized buffer the plugin can read as `InputEvents`, and `clear` resets
    /// it for the next block. This is the RT seam a hosted CLAP instrument plays
    /// through; opening a real plugin to hear it is the standing rig gate.
    #[test]
    fn control_events_queue_drain_and_clear() {
        let mut buf = EventBuffer::with_capacity(EVENT_CAPACITY);
        let mut count = 0usize;

        queue_note_on(&mut buf, &mut count, 60, 100);
        queue_param(&mut buf, &mut count, 3, 0.5);
        queue_note_off(&mut buf, &mut count, 60);
        assert_eq!(count, 3, "three control events queued");
        assert_eq!(
            InputEvents::from_buffer(&buf).len(),
            3,
            "the plugin sees all three as CLAP input events"
        );

        // A fresh block clears the buffer but keeps capacity (no realloc).
        buf.clear();
        assert_eq!(
            InputEvents::from_buffer(&buf).len(),
            0,
            "drained for next block"
        );
    }

    /// The hard cap is honoured, so RT pushes can never grow the pre-sized buffer
    /// (the allocation-free guarantee the `HostedBackend` contract requires).
    #[test]
    fn queue_helpers_refuse_to_grow_past_capacity() {
        let mut buf = EventBuffer::with_capacity(EVENT_CAPACITY);
        let mut count = EVENT_CAPACITY;
        queue_note_on(&mut buf, &mut count, 64, 90);
        queue_param(&mut buf, &mut count, 1, 1.0);
        queue_note_off(&mut buf, &mut count, 64);
        assert_eq!(
            count, EVENT_CAPACITY,
            "pushes past the cap are dropped, not grown"
        );
        assert_eq!(
            InputEvents::from_buffer(&buf).len(),
            0,
            "nothing was buffered"
        );
    }
}
