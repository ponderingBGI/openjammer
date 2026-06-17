//! `builtin.sampler` — a from-scratch resampling sample-playback instrument.
//!
//! Each voice plays back a shared PCM buffer ([`SamplerSample`]) at a pitch
//! ratio `2^((note-root)/12)`, reading through the buffer with **linear
//! interpolation**, gated by an [`Adsr`] whose release is the envelope's
//! exponential one-pole tail. Up to [`MAX_VOICES`] voices with oldest-first
//! steal (the shared [`VoiceAlloc`] policy).
//!
//! ## Sample-loading seam
//! The sampler does not decode files (that is the native [`AssetStore`]'s job).
//! The PCM arrives as an already-decoded mono [`SamplerSample`] handed in via
//! [`SamplerInstrument::set_sample`] (the minimal documented seam) — a host
//! resolves an [`ojproto::AssetId`] to PCM off the RT thread and installs it
//! here at graph-build / asset-bind time. The buffer is shared (`Arc`) across
//! all voices, so no per-note copy happens. Tests feed a synthetic buffer
//! directly through the same method.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::sync::Arc;
use alloc::vec;
use alloc::vec::Vec;

use ojcore::{
    DspInstance, DspKind, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind,
};
use ojproto::PrimitiveKind;

use crate::adsr::{Adsr, AdsrParams};
use crate::voice::VoiceAlloc;
use crate::{param, velocity_to_amp, MAX_VOICES};

/// Stable manifest id for the built-in sampler instrument.
pub const SAMPLER_ID: &str = "builtin.sampler";

/// Default root note (MIDI 60, middle C) for an asset bound via
/// [`DspInstance::load_asset`] when the node carries no explicit `root_note`
/// override param. The recorded pitch then plays at unity at middle C.
pub const SAMPLER_DEFAULT_ROOT: u8 = 60;

/// Param id selecting the sample's **root note** — the MIDI note at which the
/// buffer plays back at its native rate (playback ratio 1.0). Distinct from the
/// shared envelope param ids so the two never collide.
pub const SAMPLER_PCM_PARAM: u16 = 16;

/// An already-decoded, mono PCM sample plus the rate it was captured at and the
/// MIDI note it represents. Shared (`Arc`) across all of an instrument's voices.
#[derive(Debug, Clone, PartialEq)]
pub struct SamplerSample {
    /// Mono PCM samples in `[-1, 1]`.
    pub pcm: Vec<f32>,
    /// The sample's own capture sample rate (Hz). Used to correct playback rate
    /// when it differs from the engine's sample rate.
    pub sample_rate: f32,
    /// MIDI note at which `pcm` plays at unity ratio (its recorded pitch).
    pub root_note: u8,
}

impl SamplerSample {
    pub fn new(pcm: Vec<f32>, sample_rate: f32, root_note: u8) -> Self {
        Self {
            pcm,
            sample_rate: sample_rate.max(1.0),
            root_note,
        }
    }
}

/// One playback voice: a fractional read position into the shared buffer, the
/// per-sample increment (pitch ratio), an envelope, the velocity amplitude, and
/// a per-voice one-pole low-pass whose cutoff is set by velocity (soft notes are
/// darker, hard notes open up — the expressive dynamics of a real instrument).
#[derive(Clone, Copy)]
struct SamplerVoice {
    pos: f32,
    inc: f32,
    env: Adsr,
    amp: f32,
    /// One-pole low-pass state (the filtered sample carried between frames).
    lp: f32,
    /// One-pole coefficient in `(0, 1]`: 1 = fully open (bright), lower = darker.
    lp_coef: f32,
}

/// Map a MIDI velocity to a one-pole low-pass coefficient for the brightness
/// map. Velocity 0..127 sweeps the cutoff exponentially from ~500 Hz (very soft,
/// dark) up past Nyquist (full velocity, fully open). `sample_rate` is the
/// engine SR. Pure + branch-light so it is safe on the audio thread.
#[inline]
fn velocity_to_lp_coef(vel: u8, sample_rate: f32) -> f32 {
    let v = (vel as f32 / 127.0).clamp(0.0, 1.0);
    // 500 Hz .. ~500 * 2^7 ≈ 64 kHz: above Nyquist at high velocity => fully open.
    let cutoff = 500.0 * libm::powf(2.0, v * 7.0);
    let coef = 1.0 - libm::expf(-2.0 * core::f32::consts::PI * cutoff / sample_rate.max(1.0));
    coef.clamp(0.0, 1.0)
}

/// A from-scratch polyphonic sampler.
pub struct SamplerInstrument {
    sample_rate: f32,
    gain: f32,
    adsr: AdsrParams,
    /// Root-note override; if `None`, the loaded sample's own `root_note` is used.
    root_override: Option<u8>,
    sample: Option<Arc<SamplerSample>>,
    voices: [SamplerVoice; MAX_VOICES],
    alloc: VoiceAlloc,
}

impl SamplerInstrument {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(1.0);
        let adsr = AdsrParams::default();
        Self {
            sample_rate: sr,
            gain: 0.8,
            adsr,
            root_override: None,
            sample: None,
            voices: [SamplerVoice {
                pos: 0.0,
                inc: 0.0,
                env: Adsr::new(sr, adsr),
                amp: 0.0,
                lp: 0.0,
                lp_coef: 1.0,
            }; MAX_VOICES],
            alloc: VoiceAlloc::new(),
        }
    }

    /// Install the PCM buffer this instrument plays (the documented loading
    /// seam — see the module docs). Off the RT thread; the `Arc` is shared by
    /// every voice. Voices index the *current* buffer by position, so any
    /// in-flight voice is silenced on swap to avoid reading a shorter buffer
    /// out of bounds.
    pub fn set_sample(&mut self, sample: Arc<SamplerSample>) {
        self.sample = Some(sample);
        // Silence in-flight voices so none keeps indexing across the swap.
        self.alloc.clear();
        for v in self.voices.iter_mut() {
            v.env.reset();
        }
    }

    /// The root note in effect: explicit override, else the sample's own.
    #[inline]
    fn effective_root(&self, sample: &SamplerSample) -> f32 {
        self.root_override.unwrap_or(sample.root_note) as f32
    }
}

impl DspInstance for SamplerInstrument {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        self.sample_rate = sample_rate.max(1.0);
        for v in self.voices.iter_mut() {
            v.env.set_sample_rate(self.sample_rate);
        }
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.outputs.is_empty() {
            return;
        }
        let out = &mut ctx.outputs[0];
        for s in out.iter_mut().take(ctx.nframes) {
            *s = 0.0;
        }
        let Some(sample) = self.sample.as_ref() else {
            return; // No PCM loaded -> silence (but still well-defined output).
        };
        let pcm = &sample.pcm;
        let n = pcm.len();
        if n == 0 {
            return;
        }
        for slot in 0..MAX_VOICES {
            if !self.alloc.is_active(slot) {
                continue;
            }
            let v = &mut self.voices[slot];
            for s in out.iter_mut().take(ctx.nframes) {
                let g = v.env.tick();
                // Linear interpolation over the buffer at the fractional pos.
                let i = v.pos as usize;
                let sampled = if i + 1 < n {
                    let frac = v.pos - i as f32;
                    pcm[i] * (1.0 - frac) + pcm[i + 1] * frac
                } else if i < n {
                    pcm[i]
                } else {
                    0.0
                };
                // Velocity brightness: one-pole low-pass (coef 1 = fully open).
                v.lp += v.lp_coef * (sampled - v.lp);
                *s += v.lp * g * v.amp * self.gain;
                v.pos += v.inc;
                // Past the end while not yet released -> let the tail release.
                if v.pos >= n as f32 {
                    v.env.gate_off();
                }
            }
            if !v.env.is_active() {
                self.alloc.release_slot(slot);
            }
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        let Some(sample) = self.sample.as_ref() else {
            return;
        };
        // Pitch ratio: 2^((note-root)/12), corrected for any sample/engine SR
        // mismatch so the recorded pitch lands at unity at the root note.
        let root = self.effective_root(sample);
        let semis = note as f32 - root;
        let pitch = libm::powf(2.0, semis / 12.0);
        let sr_correction = sample.sample_rate / self.sample_rate;
        let inc = pitch * sr_correction;

        let (slot, _stolen) = self.alloc.allocate(note);
        let v = &mut self.voices[slot];
        v.pos = 0.0;
        v.inc = inc;
        v.amp = velocity_to_amp(vel).max(0.0);
        // Velocity → brightness: soft notes get a lower low-pass cutoff.
        v.lp = 0.0;
        v.lp_coef = velocity_to_lp_coef(vel, self.sample_rate);
        v.env.set_params(self.adsr);
        v.env.reset();
        v.env.gate_on();
    }

    fn note_off(&mut self, note: u8) {
        if let Some(slot) = self.alloc.slot_of_note(note) {
            self.voices[slot].env.gate_off();
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        match id {
            param::GAIN => self.gain = value.max(0.0),
            param::ATTACK => self.adsr.attack = value.max(0.0),
            param::DECAY => self.adsr.decay = value.max(0.0),
            param::SUSTAIN => self.adsr.sustain = value.clamp(0.0, 1.0),
            param::RELEASE => self.adsr.release = value.max(0.0),
            SAMPLER_PCM_PARAM => {
                // Root-note override, carried as a float so it fits the one
                // numeric param-addressing scheme. 0..127; negative => clear.
                self.root_override = if value < 0.0 {
                    None
                } else {
                    Some(value.clamp(0.0, 127.0) as u8)
                };
            }
            _ => {}
        }
    }

    /// OFF-RT asset bind: install the resolved PCM as this sampler's playback
    /// buffer (the U6 seam reached from [`ojcore::compile_with_assets`]). The
    /// root note is the node's `root_note` override param if set (applied before
    /// assets at compile time), else [`SAMPLER_DEFAULT_ROOT`] (middle C). Slot is
    /// ignored: the sampler has a single PCM buffer. May allocate (copies the
    /// borrowed PCM into a shared `Arc`); never called on the audio thread.
    fn load_asset(&mut self, _slot: u16, pcm: &[f32], sample_rate: f32) {
        let root = self.root_override.unwrap_or(SAMPLER_DEFAULT_ROOT);
        let sample = SamplerSample::new(pcm.to_vec(), sample_rate, root);
        self.set_sample(Arc::new(sample));
    }

    fn reset(&mut self) {
        self.alloc.clear();
        for v in self.voices.iter_mut() {
            v.env.reset();
            v.pos = 0.0;
        }
    }
}

/// Loader/factory for [`SamplerInstrument`].
pub struct SamplerLoader {
    manifest: PluginManifest,
}

impl Default for SamplerLoader {
    fn default() -> Self {
        Self {
            manifest: sampler_manifest(),
        }
    }
}

impl SamplerLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for SamplerLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        // The host installs PCM via `SamplerInstrument::set_sample` after
        // resolving the node's `AssetRef` (kept off the RT thread).
        Box::new(SamplerInstrument::new(sample_rate))
    }
}

fn sampler_manifest() -> PluginManifest {
    PluginManifest {
        id: String::from(SAMPLER_ID),
        name: String::from("Sampler"),
        kind: PrimitiveKind::Sampler,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: param::GAIN,
                name: String::from("gain"),
                min: 0.0,
                max: 1.0,
                default: 0.8,
            },
            ParamDecl {
                id: param::ATTACK,
                name: String::from("attack"),
                min: 0.0,
                max: 4.0,
                default: 0.005,
            },
            ParamDecl {
                id: param::DECAY,
                name: String::from("decay"),
                min: 0.0,
                max: 4.0,
                default: 0.080,
            },
            ParamDecl {
                id: param::SUSTAIN,
                name: String::from("sustain"),
                min: 0.0,
                max: 1.0,
                default: 0.7,
            },
            ParamDecl {
                id: param::RELEASE,
                name: String::from("release"),
                min: 0.0,
                max: 8.0,
                default: 0.120,
            },
            ParamDecl {
                id: SAMPLER_PCM_PARAM,
                name: String::from("root_note"),
                min: -1.0,
                max: 127.0,
                default: -1.0,
            },
        ],
        ports: PortDecl {
            audio_in: 0,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
        },
    }
}
