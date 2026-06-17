---
title: Instruments & sound
description: Every instrument in the picker makes sound out of the box — and you can bring your own.
sidebar:
  order: 1
---

OpenJammer is meant to be picked up and **played**. Drop an instrument on the
canvas, wire a keyboard or MIDI controller to it, route it to a speaker, and you
hear it — no sample packs to download, no setup. This page explains how that
works and how to go further: your own samples, SoundFonts, Faust code nodes, and
native plugins.

## Pick an instrument, hear it instantly

Every melodic instrument node lowers to the engine's built-in **sampler**, which
plays a single one-shot and pitch-shifts it across the whole keyboard
(`2^((note − root) / 12)`). The repo ships **no** sample assets, so to make every
instrument playable immediately OpenJammer **synthesizes** a distinct, recognizable
voice for each one — procedurally, with zero downloads.

The voice engine ([`src/audio/voiceSynth.ts`](https://github.com/PonderingBGI/openjammer/blob/main/src/audio/voiceSynth.ts))
renders a short mono tone from a per-family recipe — a harmonic series plus an
amplitude envelope, and where it matters: inharmonic partial stretch (pianos,
bells), vibrato (strings, brass, reeds), tremolo (organs, electric pianos), and
breath/bow noise (flutes, saxes). It is pure and deterministic, so a given
instrument sounds identical every run.

### The timbre families

Every one of the 171 catalogue instruments maps onto one of these families, so a
cello and a saxophone genuinely sound different:

| Family | Character | Example instruments |
| --- | --- | --- |
| `piano` | Inharmonic struck string, bright attack | Acoustic Grand, Bright Piano |
| `epiano` | Bell tine + fundamental, gentle tremolo | Electric Piano 1/2, Rhodes |
| `organ` | Flat drawbar stack, faint tremolo | Church/Rock/Drawbar Organ |
| `mallet` | Metallic inharmonic ring, quick decay | Vibraphone, Marimba, Celesta |
| `bell` | Strong high inharmonic partials, long ring | Tubular Bells, Glockenspiel |
| `pluck` | Rich bright onset, fast decay | Guitars, Harp, Harpsichord |
| `bass` | Strong fundamental, dark | Acoustic/Electric/Synth Bass |
| `strings` | Bowed saw, vibrato, slow swell | Violin, Cello, String Ensemble |
| `brass` | Bright rising harmonics, light vibrato | Trumpet, Trombone, Horn, Tuba |
| `reed` | Odd-harmonic buzz, vibrato + breath | Sax, Clarinet, Oboe |
| `flute` | Near-sine + octave, lots of breath | Flute, Piccolo, Recorder |
| `lead` | Bright saw, sustained | Synth leads |
| `pad` | Soft detuned bloom | Synth pads, choirs |
| `percussion` | Noise burst + short tonal thud | Drums, agogo, woodblock |
| `world` | Bright plucked/struck hybrid | Accordion, ethnic strings |

Resolution is by **keyword** over the instrument's id and name first (so "Church
Organ" is an organ even though its catalogue category is "piano"), then by the
coarse catalogue category, and finally the warm default. The picker selection
(`node.data.instrumentId`) is threaded through **both** executors (native + the
browser worklet), and the voice is re-bound only when the selected family
actually changes — so switching instruments re-voices the node instantly while a
plain graph re-push doesn't re-upload audio.

> A golden test asserts that **no** catalogue instrument can resolve to a silent
> voice — shipping a silent instrument fails CI.

## Bring your own sound

The synthesized voices are the floor, not the ceiling. A professional brings
their own:

- **Your own sample.** Bind decoded PCM to a sampler node; it replaces the
  synthesized voice (the executor skips any node that already has a user sample
  bound). The seam is `SamplerInstrument::set_sample` on the engine side and
  `load_sample` / the worklet transfer on the host side.
- **SoundFonts (.sf2).** The native build includes a SoundFont2 synth
  (`rustysynth`, the `Sf2` primitive). Load a `.sf2` and pick a program for
  authentic multisampled instruments.
- **Faust code nodes.** Author a brand-new DSP node from Faust source — the AI
  agent can do this for you, or you can paste source. See
  [the code-node ABI](https://github.com/PonderingBGI/openjammer/blob/main/docs/code-node-abi.md).
- **Native plugins.** A CLAP/VST3 host (`ojhost`) lets you bring instruments and
  effects you already own.

See the project [ROADMAP](https://github.com/PonderingBGI/openjammer/blob/main/ROADMAP.md)
§3 for the current status of each bring-your-own path.

## If you hear nothing

Sound not coming through? You have two fast paths:

1. Open the **DevLog** (Ctrl/Cmd+Shift+L, or the command palette → "Toggle
   DevLog") and look for warnings/errors — an empty sampler, an xrun, or a
   missing connection will show up there.
2. Ask the **AI assistant** (Ctrl/Cmd+K). It can read your logs and audio
   diagnostics and fix the obvious causes for you — see
   [Troubleshooting with the AI](/openjammer/play/troubleshooting-with-the-ai/).

The usual culprits: the keyboard isn't wired to the instrument, the instrument
isn't wired to a speaker, or audio was never started (the "Start OpenJammer"
overlay). A correct minimal patch is **Keyboard → Instrument → Speaker**.
