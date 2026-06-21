//! `ojcore-native` — the native (desktop) audio host for OpenJammer.
//!
//! This crate is the `std`, hardware-facing edge of the engine. It does NOT
//! define DSP or graph semantics (that is `ojcore` / `ojcore-dsp`); it owns the
//! glue between the OS audio stack and the engine:
//!
//! * [`AudioHost`] — opens a small-buffer cpal output stream (and optional
//!   duplex input), and inside the realtime-promoted audio callback drains the
//!   UI->RT [`ojcore::CommandQueue`] then runs [`ojcore::Engine::process_block`].
//! * [`AssetStore`] — off-RT WAV decode (symphonia) and write/capture (hound).
//! * [`AssetCatalog`] — content-addressed, deduplicating, eviction-free in-memory
//!   store of decoded [`Pcm`] keyed by [`ojproto::AssetId`]: the off-RT side the
//!   engine's `AssetId` handles point at. See [`store`] for the fetch protocol.
//! * [`latency`] — the Phase-1 loopback round-trip latency math + impulse
//!   onset detection, plus the `loopback` harness (this lib + `src/bin/loopback.rs`).
//! * [`Recorder`] / [`RecorderSink`] — the U-STATEFUL capture capability: the RT
//!   audio thread pushes a bus's output into a wait-free SPSC ring; the control
//!   thread drains it into a growing PCM buffer and stores it in the
//!   [`AssetCatalog`] / exports it to WAV via the [`AssetStore`]. Native-only
//!   (the ring + `Vec` growth live off the realtime, wasm-clean engine core).
//!
//! The audio-touching paths cannot run in a device-less CI sandbox; every such
//! path returns a clear error (never a panic) so the harness can report "no
//! audio device available" cleanly, and the device-requiring test is `#[ignore]`d.

pub mod asset;
pub mod backend;
pub mod device;
pub mod device_listener;
pub mod fs;
pub mod host;
pub mod latency;
pub mod log;
#[cfg(feature = "persist")]
pub mod logstore;
pub mod recorder;
pub mod store;
pub mod supervisor;
pub mod update_gate;

pub use asset::{AssetError, AssetStore, Pcm};
pub use backend::{supervise_once, AudioBackend};
pub use device::{
    classify as classify_device_fault, device_fault_channel, probe_default_output, DeviceFault,
    DeviceFaultRx, DeviceFaultTx, DeviceIdentity, DeviceWatcher,
};
pub use device_listener::{install as install_device_listener, DeviceListener};
pub use fs::{atomic_write, atomic_write_path, OjFs, RealFs};
pub use host::{
    default_output_sample_rate, render_block, AudioHost, BlockProcessor, HostError, StreamFault,
    StreamRequest, DEFAULT_RUN,
};
pub use latency::{
    detect_onset, frames_to_ms, measure_round_trip_frames, ms_to_frames, LatencyEstimate,
};
pub use log::init_logging;
#[cfg(feature = "persist")]
pub use logstore::{LogHit, LogRecord, LogStore};
pub use recorder::{Recorder, RecorderSink, DEFAULT_RING_FRAMES};
pub use store::{content_address, AssetCatalog};
pub use supervisor::{DeviceSupervisor, RecoveryAction, SupervisorState};
pub use update_gate::{UpdateGate, UpdateState};

/// The amplitude threshold used to detect the loopback impulse in the captured
/// buffer. Well above any realistic noise floor, well below a full-scale click.
pub const LOOPBACK_THRESHOLD: f32 = 0.1;
