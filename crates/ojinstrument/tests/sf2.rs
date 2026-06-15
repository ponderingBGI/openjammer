//! U6 SoundFont (SF2) backend tests. The construction + note/render code path
//! is always compiled and the "no SoundFont loaded => well-defined silence"
//! behaviour is checked unconditionally. The actual rustysynth render test is
//! `#[ignore]`d: it needs a real `.sf2` asset, which is not bundled in the repo
//! (run with `OJ_SF2=/path/to/font.sf2 cargo test -p ojinstrument -- --ignored`).
#![cfg(feature = "sf2")]

use ojcore::{DspInstance, PluginLoader, ProcessCtx};
use ojinstrument::{Sf2Instrument, Sf2Loader, SF2_ID};
use ojproto::PrimitiveKind;

const SR: f32 = 44_100.0;
const BLOCK: usize = 512;

fn render_block(inst: &mut dyn DspInstance, buf: &mut [f32]) {
    for s in buf.iter_mut() {
        *s = 0.0;
    }
    let ins: [&[f32]; 0] = [];
    let mut outs: [&mut [f32]; 1] = [buf];
    let mut ctx = ProcessCtx {
        inputs: &ins,
        outputs: &mut outs,
        nframes: BLOCK,
    };
    inst.process(&mut ctx);
}

#[test]
fn sf2_loader_manifest_is_sf2() {
    let l = Sf2Loader::new();
    assert_eq!(l.manifest().id, SF2_ID);
    assert_eq!(l.manifest().kind, PrimitiveKind::Sf2);
    assert_eq!(l.manifest().ports.audio_out, 1);
}

#[test]
fn sf2_without_soundfont_is_silent_and_safe() {
    // Construction + the full note/process code path must work even before any
    // SoundFont is installed; output is well-defined silence.
    let mut inst = Sf2Instrument::new(SR, BLOCK);
    inst.activate(SR, BLOCK);
    assert!(!inst.is_loaded());
    inst.note_on(60, 100); // routed but dropped (no synth yet)
    inst.note_off(60);
    let mut buf = vec![0.0f32; BLOCK];
    render_block(&mut inst, &mut buf);
    assert!(buf.iter().all(|&x| x == 0.0), "unloaded sf2 must be silent");
}

#[test]
fn sf2_rejects_garbage_soundfont() {
    let mut inst = Sf2Instrument::new(SR, BLOCK);
    let err = inst.load_soundfont(b"not a real soundfont");
    assert!(err.is_err(), "garbage bytes must not parse as a SoundFont");
    assert!(!inst.is_loaded());
}

#[test]
fn sf2_loader_instantiates() {
    let l = Sf2Loader::new();
    let mut inst = l.instantiate(SR, BLOCK);
    inst.activate(SR, BLOCK);
    // Drivable: note routing + process must not panic without a SoundFont.
    inst.note_on(72, 80);
    let mut buf = vec![0.0f32; BLOCK];
    render_block(&mut *inst, &mut buf);
}

/// Real render through rustysynth. Ignored by default (needs a `.sf2` asset).
/// Provide one via `OJ_SF2=/path/to/font.sf2`.
#[test]
#[ignore = "needs a real .sf2 asset; set OJ_SF2=/path/to/font.sf2"]
fn sf2_renders_non_silent_with_real_soundfont() {
    let path = std::env::var("OJ_SF2").expect("set OJ_SF2 to a .sf2 file path");
    let bytes = std::fs::read(&path).expect("read sf2 file");
    let mut inst = Sf2Instrument::new(SR, BLOCK);
    inst.activate(SR, BLOCK);
    inst.load_soundfont(&bytes).expect("valid soundfont");
    assert!(inst.is_loaded());

    inst.note_on(60, 100);
    let mut peak = 0.0f32;
    let mut buf = vec![0.0f32; BLOCK];
    for _ in 0..32 {
        render_block(&mut inst, &mut buf);
        for &x in &buf {
            peak = peak.max(x.abs());
        }
    }
    assert!(peak > 0.001, "rendered SF2 note was silent (peak {peak})");
}
