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

use clack_host::prelude::*;

use super::HostedBackend;
use crate::descriptor::{PluginDescriptor, PluginFormat, PortCounts};
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
        in_events: EventBuffer::new(),
        out_events: EventBuffer::new(),
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
    /// Reusable empty event buffers (no param/note events wired yet).
    in_events: EventBuffer,
    out_events: EventBuffer,
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
        self.out_events.clear();
    }

    fn set_param(&mut self, _id: u16, _value: f32) {
        // TODO(clap-host): push a CLAP param-value event into `in_events` so the
        // plugin sees the change next block. Requires the `clack-extensions`
        // params extension; deferred (see crate README).
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
