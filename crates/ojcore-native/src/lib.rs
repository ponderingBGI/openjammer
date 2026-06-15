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
//! * [`latency`] — the Phase-1 loopback round-trip latency math + impulse
//!   onset detection, plus the `loopback` harness (this lib + `src/bin/loopback.rs`).
//!
//! The audio-touching paths cannot run in a device-less CI sandbox; every such
//! path returns a clear error (never a panic) so the harness can report "no
//! audio device available" cleanly, and the device-requiring test is `#[ignore]`d.

pub mod asset;
pub mod host;
pub mod latency;

pub use asset::{AssetError, AssetStore, Pcm};
pub use host::{render_block, AudioHost, BlockProcessor, HostError, StreamRequest, DEFAULT_RUN};
pub use latency::{
    detect_onset, frames_to_ms, measure_round_trip_frames, ms_to_frames, LatencyEstimate,
};

/// The amplitude threshold used to detect the loopback impulse in the captured
/// buffer. Well above any realistic noise floor, well below a full-scale click.
pub const LOOPBACK_THRESHOLD: f32 = 0.1;
