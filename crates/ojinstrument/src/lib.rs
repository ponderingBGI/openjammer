//! OpenJammer instrument / voice nodes — the crate that actually makes sound.
//!
//! Every instrument here is "just a plugin": a [`ojcore::PluginManifest`]
//! (mapping an open `manifest_id` to a closed [`ojproto::PrimitiveKind`]), a
//! [`ojcore::PluginLoader`] factory, and a polyphonic [`ojcore::DspInstance`]
//! that consumes the note events the engine routes through
//! [`ojcore::DspInstance::note_on`] / [`note_off`](ojcore::DspInstance::note_off)
//! (added in U6's STEP 1).
//!
//! Backends:
//! * [`OscInstrument`] (`builtin.osc`) — a sine-voice pool reusing
//!   [`ojcore_dsp::Osc`], each voice gated by an [`Adsr`] envelope.
//! * [`SamplerInstrument`] (`builtin.sampler`) — a from-scratch resampling
//!   voice: playback rate `2^((note-root)/12)`, linear interpolation over a
//!   shared sample buffer, oldest-first voice steal.
//! * [`KarplusInstrument`] (`builtin.karplus`) — a Karplus-Strong string pool
//!   reusing [`ojcore_dsp::KarplusString`].
//! * [`Sf2Instrument`] (`builtin.sf2`, `sf2` feature) — a SoundFont synth via
//!   `rustysynth`.
//!
//! `no_std + alloc` core (Osc / Sampler / Karplus); the SF2 backend needs `std`
//! and lives behind the `sf2` feature.
#![cfg_attr(not(any(test, feature = "std")), no_std)]

extern crate alloc;

#[cfg(all(feature = "std", not(test)))]
extern crate std;

mod adsr;
mod karplus;
mod osc;
mod sampler;
mod voice;

#[cfg(feature = "sf2")]
mod sf2;

pub use adsr::{Adsr, AdsrParams};
pub use karplus::{KarplusInstrument, KarplusLoader, KARPLUS_ID};
pub use osc::{OscInstrument, OscLoader, OSC_ID};
pub use sampler::{SamplerInstrument, SamplerLoader, SamplerSample, SAMPLER_ID, SAMPLER_PCM_PARAM};

#[cfg(feature = "sf2")]
pub use sf2::{Sf2Instrument, Sf2Loader, SF2_ID};

/// Number of simultaneous voices in the polyphonic instrument pools.
pub const MAX_VOICES: usize = 16;

/// Shared parameter ids across the voice-based instruments. Envelope params
/// reuse one numbering so a UI can drive any instrument with the same ids.
/// (The Sampler's PCM-config slot is [`SAMPLER_PCM_PARAM`], kept distinct.)
pub mod param {
    /// Master output gain (linear).
    pub const GAIN: u16 = 0;
    /// ADSR attack time, seconds.
    pub const ATTACK: u16 = 1;
    /// ADSR decay time, seconds.
    pub const DECAY: u16 = 2;
    /// ADSR sustain level, 0..1.
    pub const SUSTAIN: u16 = 3;
    /// ADSR release time, seconds.
    pub const RELEASE: u16 = 4;
}

/// MIDI note number -> frequency in Hz (A4 = note 69 = 440 Hz, 12-TET).
#[inline]
pub fn midi_to_freq(note: u8) -> f32 {
    440.0 * libm::powf(2.0, (note as f32 - 69.0) / 12.0)
}

/// Standard MIDI velocity (0..127) -> linear amplitude (0..1).
#[inline]
pub fn velocity_to_amp(vel: u8) -> f32 {
    (vel as f32) / 127.0
}
