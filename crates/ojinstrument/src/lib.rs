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

// ===========================================================================
// Shared registration — the ONE path both engine targets call
// ===========================================================================

use alloc::boxed::Box;

pub use ojcore::{register_builtins, BuiltinOpts};

/// Options for [`register_all`]: which slices of the common built-in set to
/// register. Effects + structural come from `ojcore`; the instruments are added
/// here on top, with SF2 separately gateable for targets where `rustysynth`
/// (its `std` SoundFont backend) is unavailable (e.g. `wasm32`).
#[derive(Debug, Clone, Copy)]
pub struct RegisterOpts {
    /// Forwarded to [`ojcore::register_builtins`] (effects + structural).
    pub builtins: BuiltinOpts,
    /// Register the polyphonic Osc / Sampler / Karplus instruments.
    pub instruments: bool,
    /// Register the SF2 SoundFont instrument. Only honoured when the `sf2`
    /// feature is compiled in (it pulls `std`-only `rustysynth`); ignored on
    /// targets built without it, such as the `wasm32` worklet.
    pub sf2: bool,
}

impl Default for RegisterOpts {
    fn default() -> Self {
        Self {
            builtins: BuiltinOpts::full(),
            instruments: true,
            sf2: true,
        }
    }
}

impl RegisterOpts {
    /// The full common set: every effect, every structural node, every
    /// instrument, and SF2 (if the feature is built). Native default.
    pub fn full() -> Self {
        Self::default()
    }

    /// The `wasm32` worklet set: full effects + structural + Osc/Sampler/Karplus,
    /// but NO SF2 (rustysynth does not build for `wasm32` — see crate docs).
    pub fn wasm() -> Self {
        Self {
            builtins: BuiltinOpts::full(),
            instruments: true,
            sf2: false,
        }
    }
}

/// Register the FULL common built-in node set into `reg` through the single
/// shared path. Calls [`ojcore::register_builtins`] for the effects + structural
/// nodes, then adds this crate's instruments. This is the ONE function both the
/// native host (`src-tauri`) and the `wasm32` worklet (`ojcore-wasm`) call, so
/// the two registries stay byte-for-byte in sync (minus the documented SF2
/// native-only difference).
///
/// Registered ids (with full opts):
/// * effects:     `builtin.gain`, `builtin.biquad`, `builtin.waveshaper`,
///   `builtin.delay`, `builtin.convolution`
/// * structural:  `host.graph_in`, `host.mic_in`, `host.graph_out`,
///   `host.speaker_out`, `builtin.add`, `builtin.passthrough`
/// * instruments: `builtin.osc`, `builtin.sampler`, `builtin.karplus`
/// * SF2 (native, feature `sf2`, `opts.sf2`): `builtin.sf2`
pub fn register_all(reg: &mut ojcore::PluginRegistry, opts: RegisterOpts) {
    register_builtins(reg, opts.builtins);

    if opts.instruments {
        reg.register(Box::new(OscLoader::new()));
        reg.register(Box::new(SamplerLoader::new()));
        reg.register(Box::new(KarplusLoader::new()));
    }

    #[cfg(feature = "sf2")]
    if opts.sf2 {
        reg.register(Box::new(Sf2Loader::new()));
    }
}

#[cfg(test)]
mod register_tests {
    use super::*;
    use ojcore::PluginRegistry;

    /// The full native set registers every effect, structural node, and
    /// instrument (SF2 included when the feature is built).
    #[test]
    fn register_all_full_native_set() {
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::full());

        // Effects (from ojcore).
        assert!(reg.contains(ojcore::GAIN_ID));
        assert!(reg.contains(ojcore::BIQUAD_ID));
        assert!(reg.contains(ojcore::WAVESHAPER_ID));
        assert!(reg.contains(ojcore::DELAY_ID));
        assert!(reg.contains(ojcore::CONVOLUTION_ID));
        // Structural (from ojcore).
        assert!(reg.contains(ojcore::SPEAKER_OUT_ID));
        assert!(reg.contains(ojcore::GRAPH_IN_ID));
        assert!(reg.contains(ojcore::PASSTHROUGH_ID));
        // Instruments (this crate).
        assert!(reg.contains(OSC_ID));
        assert!(reg.contains(SAMPLER_ID));
        assert!(reg.contains(KARPLUS_ID));

        #[cfg(feature = "sf2")]
        assert!(reg.contains(SF2_ID));
    }

    /// The wasm opts register the instruments + effects but never SF2.
    #[test]
    fn register_all_wasm_set_excludes_sf2() {
        let mut reg = PluginRegistry::new();
        register_all(&mut reg, RegisterOpts::wasm());

        assert!(reg.contains(OSC_ID));
        assert!(reg.contains(SAMPLER_ID));
        assert!(reg.contains(KARPLUS_ID));
        assert!(reg.contains(ojcore::CONVOLUTION_ID));
        #[cfg(feature = "sf2")]
        assert!(!reg.contains(SF2_ID), "wasm opts must exclude SF2");
    }
}
