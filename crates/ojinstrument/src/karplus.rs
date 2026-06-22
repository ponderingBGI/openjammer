//! `builtin.karplus` — a polyphonic Karplus-Strong plucked-string instrument.
//!
//! Each voice is an [`ojcore_dsp::KarplusString`] re-plucked on note-on. The
//! string's own damping is the decay, so the only envelope concern is a clean
//! gate: a tiny [`Adsr`] release smooths note-off so cutting a plucked note
//! does not click. Voice allocation/steal is the shared [`VoiceAlloc`] policy.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore::{
    DspInstance, DspKind, ParamDecl, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind,
};
use ojcore_dsp::KarplusString;
use ojproto::PrimitiveKind;

use crate::adsr::{Adsr, AdsrParams};
use crate::voice::VoiceAlloc;
use crate::{midi_to_freq, param, velocity_to_amp, MAX_VOICES};

/// Stable manifest id for the built-in Karplus-Strong string instrument.
pub const KARPLUS_ID: &str = "builtin.karplus";

/// Longest string buffer a voice can hold: enough for the lowest MIDI notes at
/// 96 kHz (note 0 ≈ 8.18 Hz -> ~11.7k samples). Allocated once per voice at
/// construction; `pluck` only sets the active length.
const MAX_STRING_LEN: usize = 16_384;

/// One plucked-string voice: the string DSP + a gate envelope (only attack +
/// release matter; the string's damping provides the natural decay).
struct KarplusVoice {
    string: KarplusString,
    env: Adsr,
    amp: f32,
}

/// A polyphonic Karplus-Strong string instrument.
pub struct KarplusInstrument {
    sample_rate: f32,
    gain: f32,
    /// Gate envelope params. Decay/sustain are pinned (the string decays on its
    /// own); attack/release just de-click the note edges.
    gate: AdsrParams,
    voices: [KarplusVoice; MAX_VOICES],
    alloc: VoiceAlloc,
}

impl KarplusInstrument {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(1.0);
        // Sustain at 1.0 so the envelope holds the string at full level while
        // it rings; the string itself supplies the decay.
        let gate = AdsrParams {
            attack: 0.001,
            decay: 0.0,
            sustain: 1.0,
            release: 0.010,
        };
        let voices = core::array::from_fn(|_| KarplusVoice {
            string: KarplusString::new(MAX_STRING_LEN),
            env: Adsr::new(sr, gate),
            amp: 0.0,
        });
        Self {
            sample_rate: sr,
            gain: 0.5,
            gate,
            voices,
            alloc: VoiceAlloc::new(),
        }
    }
}

impl DspInstance for KarplusInstrument {
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
                *s += v.string.tick() * g * v.amp * self.gain;
            }
            if !v.env.is_active() {
                self.alloc.release_slot(slot);
            }
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        let (slot, _stolen) = self.alloc.allocate(note);
        let v = &mut self.voices[slot];
        v.string.pluck(midi_to_freq(note), self.sample_rate);
        v.amp = velocity_to_amp(vel).max(0.0);
        v.env.set_params(self.gate);
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
            param::ATTACK => self.gate.attack = value.max(0.0),
            param::RELEASE => self.gate.release = value.max(0.0),
            // Decay/sustain are intrinsic to the string model; ignored here.
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

/// Loader/factory for [`KarplusInstrument`].
pub struct KarplusLoader {
    manifest: PluginManifest,
}

impl Default for KarplusLoader {
    fn default() -> Self {
        Self {
            manifest: karplus_manifest(),
        }
    }
}

impl KarplusLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for KarplusLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(KarplusInstrument::new(sample_rate))
    }
}

fn karplus_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(KARPLUS_ID),
        name: String::from("Karplus String"),
        kind: PrimitiveKind::KarplusString,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: param::GAIN,
                name: String::from("gain"),
                min: 0.0,
                max: 1.0,
                default: 0.5,
            },
            ParamDecl {
                id: param::ATTACK,
                name: String::from("attack"),
                min: 0.0,
                max: 1.0,
                default: 0.001,
            },
            ParamDecl {
                id: param::RELEASE,
                name: String::from("release"),
                min: 0.0,
                max: 2.0,
                default: 0.010,
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
