//! `builtin.osc` — a polyphonic sine instrument.
//!
//! Each voice is an [`ojcore_dsp::Osc`] gated by an [`Adsr`]. Notes route in
//! via [`DspInstance::note_on`] / [`note_off`](DspInstance::note_off); the
//! [`VoiceAlloc`] policy hands out / steals voice slots. `process` sums every
//! active voice into the (mono) output, allocation-free.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore::{
    DspInstance, DspKind, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind,
};
use ojcore_dsp::Osc;
use ojproto::PrimitiveKind;

use crate::adsr::{Adsr, AdsrParams};
use crate::voice::VoiceAlloc;
use crate::{midi_to_freq, param, velocity_to_amp, MAX_VOICES};

/// Stable manifest id for the built-in oscillator instrument.
pub const OSC_ID: &str = "builtin.osc";

/// One sine voice: oscillator + envelope + the velocity amplitude it was
/// triggered at.
#[derive(Clone, Copy)]
struct OscVoice {
    osc: Osc,
    env: Adsr,
    amp: f32,
}

/// A polyphonic sine instrument. Voice DSP state lives in `voices`; the
/// [`VoiceAlloc`] tracks which slot plays which note.
pub struct OscInstrument {
    sample_rate: f32,
    gain: f32,
    adsr: AdsrParams,
    voices: [OscVoice; MAX_VOICES],
    alloc: VoiceAlloc,
}

impl OscInstrument {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(1.0);
        let adsr = AdsrParams::default();
        Self {
            sample_rate: sr,
            gain: 0.3,
            adsr,
            voices: [OscVoice {
                osc: Osc::new(),
                env: Adsr::new(sr, adsr),
                amp: 0.0,
            }; MAX_VOICES],
            alloc: VoiceAlloc::new(),
        }
    }
}

impl DspInstance for OscInstrument {
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
        for slot in 0..MAX_VOICES {
            if !self.alloc.is_active(slot) {
                continue;
            }
            let v = &mut self.voices[slot];
            for s in out.iter_mut().take(ctx.nframes) {
                let g = v.env.tick();
                *s += v.osc.next_sine() * g * v.amp * self.gain;
            }
            // Recycle the slot once its envelope has fully decayed.
            if !v.env.is_active() {
                self.alloc.release_slot(slot);
            }
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        let (slot, _stolen) = self.alloc.allocate(note);
        let v = &mut self.voices[slot];
        v.osc.set_freq(midi_to_freq(note), self.sample_rate);
        v.amp = velocity_to_amp(vel).max(0.0);
        // Hard-reset the envelope so a stolen voice restarts cleanly.
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
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.alloc.clear();
        for v in self.voices.iter_mut() {
            v.env.reset();
        }
    }
}

/// Loader/factory for [`OscInstrument`].
pub struct OscLoader {
    manifest: PluginManifest,
}

impl Default for OscLoader {
    fn default() -> Self {
        Self {
            manifest: osc_manifest(),
        }
    }
}

impl OscLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for OscLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(OscInstrument::new(sample_rate))
    }
}

fn osc_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(OSC_ID),
        name: String::from("Oscillator"),
        kind: PrimitiveKind::Osc,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: param::GAIN,
                name: String::from("gain"),
                min: 0.0,
                max: 1.0,
                default: 0.3,
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
        ],
        // Instruments are sources: no audio in, mono audio out.
        ports: PortDecl {
            audio_in: 0,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
        },
    }
}
