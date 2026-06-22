//! `builtin.sf2` — a SoundFont (SF2) synthesizer backed by `rustysynth`.
//!
//! `rustysynth` is a pure-Rust SoundFont synth, but it depends on `std` (it
//! reads SoundFonts through [`std::io::Read`] and keeps `std` collections), so
//! this whole backend sits behind the crate's `sf2` feature.
//!
//! ## SoundFont-loading seam
//! The synth is built from a `.sf2` byte blob via
//! [`Sf2Instrument::load_soundfont`] — the host resolves the node's
//! [`ojproto::AssetId`] to bytes off the RT thread and installs them here. Until
//! a SoundFont is loaded the instrument is well-defined silence. Notes route in
//! through [`DspInstance::note_on`] / [`note_off`](DspInstance::note_off) on a
//! single MIDI channel (0); `rustysynth` owns its own polyphony + envelopes.
//!
//! `rustysynth::Synthesizer::render` is allocation-free (it fills caller-owned
//! left/right buffers from preallocated internal blocks), so once loaded the
//! `process` hot path honours the RT no-alloc contract. We render into stereo
//! scratch sized in `activate` and downmix to the mono output.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::sync::Arc;
use alloc::vec;
use alloc::vec::Vec;

use ojcore::{DspInstance, DspKind, PluginLoader, PluginManifest, PortDecl, ProcessCtx, UiKind};
use ojproto::PrimitiveKind;
use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};

/// Stable manifest id for the built-in SoundFont synth.
pub const SF2_ID: &str = "builtin.sf2";

/// The single MIDI channel all routed notes play on.
const CHANNEL: i32 = 0;

/// A SoundFont synth wrapping a `rustysynth::Synthesizer`.
pub struct Sf2Instrument {
    sample_rate: i32,
    max_block: usize,
    synth: Option<Synthesizer>,
    /// Stereo render scratch, sized in `activate` (allocation-free `process`).
    left: Vec<f32>,
    right: Vec<f32>,
}

impl Sf2Instrument {
    pub fn new(sample_rate: f32, max_block: usize) -> Self {
        let mb = max_block.max(1);
        Self {
            sample_rate: (sample_rate.max(1.0)) as i32,
            max_block: mb,
            synth: None,
            left: vec![0.0; mb],
            right: vec![0.0; mb],
        }
    }

    /// Load a SoundFont from a `.sf2` byte blob and build the synth (the
    /// documented loading seam — see the module docs). Off the RT thread.
    /// Returns `Err` with a short message if the bytes are not a valid
    /// SoundFont or the synth cannot be built.
    pub fn load_soundfont(&mut self, bytes: &[u8]) -> Result<(), String> {
        // `&[u8]` implements `std::io::Read`; rustysynth reads through it.
        let mut cursor = bytes;
        let sf = SoundFont::new(&mut cursor).map_err(|e| {
            let mut s = String::from("sf2 load: ");
            s.push_str(&format_err(&e));
            s
        })?;
        let settings = SynthesizerSettings::new(self.sample_rate);
        let synth = Synthesizer::new(&Arc::new(sf), &settings).map_err(|e| {
            let mut s = String::from("sf2 synth: ");
            s.push_str(&format_err(&e));
            s
        })?;
        self.synth = Some(synth);
        Ok(())
    }

    /// Whether a SoundFont has been loaded (i.e. the synth is live).
    pub fn is_loaded(&self) -> bool {
        self.synth.is_some()
    }

    /// Select the General-MIDI `bank`/`preset` (program) the loaded SoundFont
    /// plays — e.g. bank 0 preset 0 = Acoustic Grand, bank 128 = the percussion
    /// kit. Sends a bank-select (CC0) + program-change on the synth channel.
    /// A no-op (safe) when no SoundFont is loaded. Off the RT thread.
    pub fn select_program(&mut self, bank: u8, preset: u8) {
        if let Some(synth) = self.synth.as_mut() {
            // Control change: bank-select MSB (CC 0).
            synth.process_midi_message(CHANNEL, 0xB0, 0x00, bank as i32);
            // Program change to `preset`.
            synth.process_midi_message(CHANNEL, 0xC0, preset as i32, 0);
        }
    }
}

/// Format any `rustysynth` error (its errors impl `Display`) into an owned
/// string without pulling in `core::fmt::Write` plumbing at call sites.
fn format_err<E: core::fmt::Display>(e: &E) -> String {
    use core::fmt::Write;
    let mut s = String::new();
    let _ = write!(s, "{e}");
    s
}

impl DspInstance for Sf2Instrument {
    fn activate(&mut self, sample_rate: f32, max_block: usize) {
        let new_sr = sample_rate.max(1.0) as i32;
        let mb = max_block.max(1);
        // Resize stereo scratch to the activated block size (off the RT thread).
        if mb > self.left.len() {
            self.left.resize(mb, 0.0);
            self.right.resize(mb, 0.0);
        }
        self.max_block = mb;
        // If the sample rate changed, the existing synth was built for the old
        // rate; drop it so a subsequent `load_soundfont` rebuilds at `new_sr`.
        // (A live re-activation at a new rate is an off-RT event.)
        if new_sr != self.sample_rate {
            self.sample_rate = new_sr;
            self.synth = None;
        }
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.outputs.is_empty() {
            return;
        }
        let n = ctx.nframes.min(self.max_block);
        let out = &mut ctx.outputs[0];
        let Some(synth) = self.synth.as_mut() else {
            for s in out.iter_mut().take(ctx.nframes) {
                *s = 0.0;
            }
            return;
        };
        // Render stereo into the preallocated scratch, then downmix to mono.
        synth.render(&mut self.left[..n], &mut self.right[..n]);
        for (i, s) in out.iter_mut().take(n).enumerate() {
            *s = 0.5 * (self.left[i] + self.right[i]);
        }
        for s in out.iter_mut().take(ctx.nframes).skip(n) {
            *s = 0.0;
        }
    }

    fn note_on(&mut self, note: u8, vel: u8) {
        if let Some(synth) = self.synth.as_mut() {
            synth.note_on(CHANNEL, note as i32, vel as i32);
        }
    }

    fn note_off(&mut self, note: u8) {
        if let Some(synth) = self.synth.as_mut() {
            synth.note_off(CHANNEL, note as i32);
        }
    }

    fn set_param(&mut self, _id: u16, _value: f32) {
        // SF2 exposes no engine-level params yet; preset/bank selection is a
        // later unit. No-op keeps the surface honest.
    }

    fn reset(&mut self) {
        if let Some(synth) = self.synth.as_mut() {
            synth.reset();
        }
    }
}

/// Loader/factory for [`Sf2Instrument`].
pub struct Sf2Loader {
    manifest: PluginManifest,
}

impl Default for Sf2Loader {
    fn default() -> Self {
        Self {
            manifest: sf2_manifest(),
        }
    }
}

impl Sf2Loader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for Sf2Loader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, max_block: usize) -> Box<dyn DspInstance> {
        // The host installs the SoundFont via `Sf2Instrument::load_soundfont`
        // after resolving the node's `AssetRef` (kept off the RT thread).
        Box::new(Sf2Instrument::new(sample_rate, max_block))
    }
}

fn sf2_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(SF2_ID),
        name: String::from("SoundFont"),
        kind: PrimitiveKind::Sf2,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![],
        ports: PortDecl {
            audio_in: 0,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
        },
    }
}
