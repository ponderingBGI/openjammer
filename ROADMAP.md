# OpenJammer Roadmap — to the stage

> **The goal.** One awesome user *and* developer experience: an instrument you
> can pick up and play live, an AI co-pilot that can actually fix your setup when
> something breaks, every instrument in the picker making real sound, and the
> door wide open to bring your own — samples, SoundFonts, Faust code nodes, and
> native plugins. We obsess over the details and don't call it done until it's
> production-ready and polished. This file is the living tracker; every box gets
> ticked, with care.

Status legend: ✅ done · 🟡 in progress / partial · ⬜ not started.

**Build health (unified tree).** All green: `tsc -b`, 795 vitest tests, `eslint .`
(0 errors), `cargo fmt --check`, `cargo clippy -D warnings` (engine crates),
engine `cargo test`, the `ojproto`↔TS `wire_shapes` parity gate, the `no_std`/
wasm32 builds, `ojhost --features clap-host`, the production `vite build`, the
Starlight docs build, and `oj doctor` (6 pass / 0 fail). The remaining ⬜ items
below are larger features or owner/hardware-gated (signing identities, a JUCE/C++
or libfaust toolchain), not breakage.

---

## 0. Unify the two histories (the merge, done properly)

The repo had two parallel histories with **no common ancestor**: `main` (the
6-month app — ojcore audio engine, the Ctrl+K AI agent, Faust code-nodes, the
`ojwasm` host, collaboration, auth) and a `foundations` branch (the L1–L5
logging spine, the DevLog, the SQLite/FTS5 log store, the `oj` CI control plane,
the Starlight docs site, versioning/signing, this roadmap). Rather than a
conflict-resolution dump, the app is the base of truth and the foundations are
re-integrated on top, feature by feature, each verified.

- [x] ✅ Merge `main` ↔ foundations with `main` as the base for all overlapping app code.
- [x] ✅ Union the structured-event taxonomy (`Severity`/`Source`/`EventKind`/`Event`/`RtEvent`) into the shared TS protocol; derive `PrimitiveKind` from a `PRIMITIVE_KINDS` tuple so the D1 SSOT gate has its list. (Caught + fixed a real drift: `oj-plugin-v1.json` was missing `Looper`/`Recorder`.)
- [x] ✅ Resolve `@openjammer/oj-protocol` across tsconfig/vite/vitest; inline `__APP_VERSION__`.
- [x] ✅ Re-port the TS logging layer: mount the DevLog + IssueReporter, add the palette command, and `installConsoleCapture()` so every `console.*` becomes live, faceted log content.
- [x] ✅ Re-port the native logging: `ojcore-native`'s `log` (tracing) + `persist`-gated `logstore` (SQLite/FTS5), with deps + workspace wiring. `cargo check` + the 4 FTS5 tests pass.
- [x] ✅ Ship the DevLog in **every** build (was dev/canary-only) so it's there on stage.

---

## 1. The AI as a real co-pilot — logs, diagnostics, settings

> *"The AI agent should have full access to the logs and all settings so it can
> help the user get things working again."* Done — the agent can now see what's
> happening and change the knobs, all reversibly, all documented.

- [x] ✅ `get_logs` — tail the on-device DevLog (filter by level/scope/search/limit).
- [x] ✅ `get_diagnostics` — environment + live audio (running?, sample rate, round-trip latency, output device, COI).
- [x] ✅ `get_settings` — the safe-allowlist settings (sample rate, latency hint, low-latency mode, in/out device, theme, default velocity).
- [x] ✅ `update_settings` — apply an allowlisted patch through the same store verbs the Settings panel uses; **reversible** (returns an undo).
- [x] ✅ Pure, injected `AgentEnvPort` (testable) + a live `createEnvPort()`; threaded through `applyToolCall`/`batch_apply`/`emit_plan` and both live call sites (streamed path + Pi host bridge).
- [x] ✅ Pi extension catalogue + `docs/agent-tools.md` updated in sync (with a worked "get sound back" loop); catalogue↔doc drift gate green; 12 new tests.
- [x] ✅ One-tap **"Ask AI to fix this"** from the DevLog seeds the agent with the current diagnostics (closes the panel, opens the chat pre-filled).

---

## 2. Every instrument fully working and wired up

> *"All the instruments you can select here fully working and wired up."* The
> picker lists 171 instruments across 9 families, but today they lower to one
> shared synthesized voice (so a cello and a sax sound identical) and the generic
> `instrument` picker is silent without a bound sample. We back **every**
> selectable instrument with a distinct, characterful **procedural** voice — zero
> external assets, deterministic, instantly playable — and keep bring-your-own as
> the override.

- [x] ✅ Generalize `defaultInstrument.ts` into a **procedural voice engine** (`voiceSynth.ts`): a `VoiceSpec` (harmonic series, ADSR, brightness, vibrato, tremolo, inharmonicity, breath noise) → deterministic mono PCM.
- [x] ✅ A `VoiceSpec` per instrument **family** (keys, piano, epiano, organ, mallet, bell, pluck, bass, strings, brass, reed, flute, lead, pad, percussion, world) so each sounds like itself.
- [x] ✅ Map every catalogue `instrumentId` → its family `VoiceSpec` (keyword rules + category fallback); "Alto Sax" vs "Cello" produce audibly different tones.
- [x] ✅ Thread `node.data.instrumentId` (not just `node.type`) through **both** executors; re-bind the voice (a `boundVoiceKey` guard) when the picker changes.
- [x] ✅ Make the generic `instrument` / `keys` picker produce sound out of the box.
- [x] ✅ Per-family baked ADSR + character so brass swells, plucks decay, pads bloom, organs hold.
- [x] ✅ A golden test that every catalogue `instrumentId` resolves to a non-silent, finite voice (no silent instrument can ship).
- [x] ✅ Velocity → brightness/level mapping: per-voice velocity-modulated low-pass in the sampler (soft = darker, hard = open), tested.
- [x] ✅ Karplus-backed plucked strings (guitar/bass) routed to the real `KarplusString` primitive (one predicate drives both emit + executor), tested.

---

## 3. Bring your own — samples, SoundFonts, Faust, native plugins

> The procedural voices are the floor, not the ceiling. A professional brings
> their own sound.

- [x] ✅ Plugin manifest schema (`oj-plugin-v1.json`) v1 + TS mirror.
- [x] ✅ Dynamic plugin registry (`registerDynamicPlugin`) — the OPEN half (AI-authored + third-party) with pub/sub.
- [x] ✅ Code-node ABI (`oj_init`/`oj_process`/`oj_param`/`oj_manifest_ptr`) frozen + validated; Faust→wasm authoring (CLI path) + reversible registration.
- [ ] 🟡 **Import your own sample** → bind PCM to a sampler node (the `set_sample` seam exists; add the UI + file decode + persistence).
- [ ] 🟡 **Load a SoundFont (.sf2)** → the `Sf2` primitive + `rustysynth` exist (native); add the picker + bring-your-own `.sf2` path and program selection.
- [ ] ⬜ Execute authored Faust **wasm** on the audio thread (wasmtime native / AudioWorklet browser) — currently audible via the stored-source effect path; promote to the compiled kernel.
- [ ] ⬜ **Native plugin host** (`ojhost`): wire the pure-Rust **CLAP** backend (`clap-host` feature) end-to-end — scan → register → load → play — as the CI-friendly default; JUCE/VST3 behind the heavy feature.
- [ ] ⬜ A "Plugins" surface in the UI: scan folders, list, add to the canvas, parameter automation via `AutoParamPanel`.

---

## 4. Production polish — ready for the stage

- [ ] 🟡 The DevLog is genuinely useful live: keyboard toggle + palette command everywhere, "N dropped" honesty, click-to-correlate. *(shipped; keep refining ergonomics)*
- [ ] ⬜ Panic-safe live UX: no operation on the canvas can drop the `AudioContext` or hang the audio thread; every failure path logs (never panics) and surfaces a calm banner.
- [ ] ⬜ One-screen **"Audio health"** readout (the diagnostics snapshot the AI reads) with a fix-it button.
- [ ] ⬜ Latency: surface the round-trip estimate prominently; nudge toward a USB interface / interactive hint when it's high.
- [ ] ⬜ Performance: keep the main bundle lean (code-split the heavy parsers), 60fps canvas under a full graph, windowed DevLog (done) and node lists.
- [ ] ⬜ Accessibility + theming pass across the new surfaces (DevLog, IssueReporter, settings).
- [ ] ⬜ A polished first-run: pick an instrument, hear it, see the help.

---

## 5. Docs — nothing ships without them

- [x] ✅ `docs/agent-tools.md` covers the diagnostics/settings tools + the worked "get sound back" loop (drift-gated).
- [x] ✅ Architecture logging page + this roadmap.
- [x] ✅ An **"Instruments & sound"** doc (docs site): how voices are synthesized, how to bring your own sample/SoundFont/plugin, the family→voice map.
- [x] ✅ A **"Troubleshooting with the AI"** doc (docs site): what to ask, what it can see + change, the safety boundary.
- [ ] ⬜ Developer doc for the procedural voice engine + the executor sample-binding seam.

---

## 6. Foundations backlog (preserved from the original roadmap)

Still-ahead engineering workstreams (mostly hardware/signing-gated or DRY
refactors of already-green CI). Owner-flippable switches live in
[`OWNER-PROVISIONING.md`](OWNER-PROVISIONING.md).

### CI control plane (Phase 1, C1)
- [ ] ⬜ Composite actions + reusable workflows (collapse the near-duplicate native jobs in `ci.yml` into `setup-rust`/`setup-web` + `engine.yml`/`web.yml`).
- [ ] ⬜ Affected-selection (`changes`) + Lane A/Lane B split driven by `oj plan --json`.

### Testing depth (Phase 4)
- [x] ✅ libm-only DSP enforcement (clippy `disallowed-methods`).
- [x] ✅ Playwright PWA render-smoke (`crossOriginIsolated === true`).
- [x] ✅ Docs-as-requirement (`missing_docs` + `cargo doc -D warnings` + a standing negative fixture).
- [x] ✅ miri over the unsafe ring + hot-swap (Lane B nightly).
- [ ] ⬜ Golden corpus (ULP-banded, per-arch) + `wasm-pack test --node` parity subset.
- [ ] ⬜ Unbounded fuzz of the untrusted parse surface (SF2/WAV/graph JSON) with a per-PR smoke.

### Persistence + delivery (Phase 5)
- [x] ✅ L3 SQLite/FTS5 store (native-first) + FTS5-availability smoke.
- [x] ✅ Production COOP/COEP host config (`public/_headers`).
- [ ] ⬜ R2 native updater (Tauri v2) — needs signing keys (owner).
- [ ] ⬜ R3 PWA auto-update (channel-aware Workbox, apply-on-idle).
- [ ] ⬜ R4 signing + delivery (split stable/canary minisign, `canary.yml`, dual-arch manifest union, post-publish key gate, provenance).
- [ ] ⬜ Loopback latency automation (wire `RecorderSink` into `build_input`).

---

*Design rationale for the foundations items lives in the project's git history and
the [documentation site](https://ponderingbgi.github.io/openjammer/). The product
items above (§0–§5) are tracked to completion here.*
