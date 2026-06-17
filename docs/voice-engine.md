# The procedural voice engine + sample-binding seam (developer guide)

How OpenJammer makes **every** selectable instrument play out of the box with
zero sample assets, how the picker selection reaches the engine, and how to
extend it. User-facing notes live on the docs site
([Instruments & sound](https://ponderingbgi.github.io/openjammer/guides/instruments-and-sound/));
this is the implementation map.

## The problem it solves

Melodic instrument nodes lower to the engine's `builtin.sampler`, which is
**silent until PCM is bound** — and the repo ships no samples. So the engine
needs *something* to play, and a cello must not sound like a saxophone.

## Layer 1 — `src/audio/voiceSynth.ts` (the synth)

A pure, deterministic additive synthesizer that renders one mono one-shot per
**timbre family**.

- `VoiceSpec` — a family recipe: a harmonic `partials` list (each with `mult`,
  `amp`, exponential `decay`), an attack, and optional `inharmonicity` (piano /
  bell stretch), `vibrato`, `tremolo`, `noise` (breath/bow), and a sustained
  `releaseS` tail. A `decay` of `0` means the partial sustains (organ / strings /
  pad) and is shaped by the global attack→sustain→release envelope; a positive
  `decay` is a struck/plucked partial.
- `FAMILY_SPECS` — one `VoiceSpec` for each `VoiceFamily`: `keys`, `piano`,
  `epiano`, `organ`, `mallet`, `bell`, `pluck`, `bass`, `strings`, `brass`,
  `reed`, `flute`, `lead`, `pad`, `percussion`, `world`.
- `resolveVoiceFamily(id, name?, category?)` — keyword rules over the
  instrument's id + name win first (so "Church Organ" → `organ` even though its
  catalogue *category* is `piano`); the catalogue category is the fallback; the
  warm `keys` family is the last resort.
- `synthesize()` is pure + deterministic (a seeded `mulberry32` for the noise),
  so a family renders identical PCM every run — it is unit-testable and cache-safe.
  `getFamilyVoice()` caches one render per family (≈16 renders shared across the
  171 catalogue ids).
- `isKarplusFamily()` marks `pluck` + `bass` as backed by the real Karplus
  primitive (see below).

**To tune or add a timbre:** edit/extend `FAMILY_SPECS` and, if adding a family,
add it to the `VoiceFamily` union + the keyword/category maps. The golden test
(`src/audio/__tests__/voiceSynth.test.ts`) asserts every catalogue id stays
non-silent, so a silent recipe fails CI.

## Layer 2 — `src/audio/defaultInstrument.ts` (the seam)

The thin executor-facing seam over the synth.

- `DEFAULT_VOICE_INSTRUMENTS` — the node types that receive a built-in voice
  (the category aliases + the generic `instrument` picker). Raw `sampler` /
  `library` nodes are excluded (they own their PCM).
- `getVoiceForInstrumentNode(nodeType, data)` — resolves a node's voice from
  `data.instrumentId` (the picker) or, absent one, the node type; returns the
  PCM `voice` plus a stable `key` (the resolved family).
- `instrumentUsesKarplus(nodeType, data)` — the single predicate that decides if
  an instrument is a plucked string / bass; used by BOTH the emit and the
  executors so they can never disagree.

## Layer 3 — the executors (binding it into the engine)

`OjcoreWasmExecutor` and `OjcoreNativeExecutor` each have a
`loadDefaultInstrumentVoices()` that, on every graph push, for each instrument
node:

1. skips raw nodes, user-bound samples, and Karplus-routed nodes (no PCM needed);
2. resolves the voice via `getVoiceForInstrumentNode`;
3. binds it through the sampler seam — **native** `load_sample` (Tauri →
   `AssetCatalog` → `SamplerInstrument::set_sample`); **wasm** transfers the PCM
   into the AudioWorklet's sampler — but only when the family `key` CHANGED
   (`boundVoiceKey` guard), so changing the picker re-voices the node while a
   plain re-push does not re-upload audio.

A user-imported sample (the `SamplerNode` drop / browse path) records a
`sampleBindings` entry, which takes precedence — the synthesized voice is only
the floor.

## Plucked strings — the real Karplus primitive

`pluck` + `bass` families lower to the engine's real Karplus-Strong primitive
(`builtin.karplus`) instead of the sampler. `emitOjGraph` (`src/audio/ojgraph/
emit.ts`) flips an instrument node's `kind` from `Sampler` to `KarplusString`
when `instrumentUsesKarplus` is true; `remapForBackend` then selects
`builtin.karplus` on both targets, and the executors skip sample-binding it. The
string is plucked live, per note, at the right pitch.

## Velocity → brightness

`SamplerInstrument` (`crates/ojinstrument/src/sampler.rs`) maps note velocity to
a **per-voice one-pole low-pass** cutoff (`velocity_to_lp_coef`): soft notes are
darker, hard notes open up — expressive dynamics from one bound sample. It is
RT-safe (libm-only, no allocation) and fully open at full velocity.

## Where the tests are

- `src/audio/__tests__/voiceSynth.test.ts` — synthesis, determinism, distinctness,
  family resolution, the no-silent-instrument golden, the Karplus predicate.
- `src/audio/ojgraph/__tests__/emit.test.ts` — the Sampler-vs-Karplus kind routing.
- `crates/ojinstrument/tests/instruments.rs` — engine-level voice correctness,
  incl. `sampler_velocity_controls_brightness`.
