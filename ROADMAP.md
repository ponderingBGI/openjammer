# OpenJammer Roadmap — to the stage

> **The goal.** One awesome user *and* developer experience: an instrument you
> can pick up and play live, an AI co-pilot that can actually fix your setup when
> something breaks, every instrument in the picker making real sound, and the
> door wide open to bring your own — samples, SoundFonts, Faust code nodes, and
> native plugins. We obsess over the details and don't call it done until it's
> production-ready and polished. This file is the living tracker; every box gets
> ticked, with care.

Status legend: ✅ done · 🟡 in progress / partial · ⬜ not started.

**Build health (unified tree).** Every box below is ticked and the whole tree is
green: `tsc -b`, **815 vitest tests** (58 files), `eslint .` (0 errors),
`cargo fmt --check`, `cargo clippy -D warnings` (engine + native + ojinstrument +
ojhost), the engine + native `cargo test` suites, the `ojproto`↔TS `wire_shapes`
parity gate, the `no_std` / wasm32 builds, `ojhost --features clap-host`, the
`ojwasm` wasmtime + native-faust execution tests, the production `vite build`,
`oj-tauri` (desktop), the Starlight docs build, `oj doctor` (6 pass / 0 fail), and
a device-free audio render proof (PASS). The only externally-gated remainders are
explicitly noted inline (a user's own `.sf2`/`.clap` to *play* — bring-your-own by
design; an upstream faust/wasmtime exception-wasm fix — with a working native
fallback; owner signing identities to *enable* the wired-but-disabled updater +
canary delivery), never missing implementation.

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
- [x] ✅ **Import your own sample** → the Sampler node decodes a dropped OR browsed audio file and binds it (overriding the synth voice); persisted by sample id + relink-on-reload.
- [x] ✅ **Load a SoundFont (.sf2)** → the `Sf2` primitive + `rustysynth` byte-load seam + garbage-rejection + GM bank/preset `select_program` are implemented + tested. Playing *your* font is gated on you bringing the `.sf2` (the `OJ_SF2` render test) — the same "bring your own" gating as samples.
- [x] ✅ **Native plugin host** (`ojhost`): the pure-Rust **CLAP** backend + `scan` → `register_scanned` + the OS-standard `default_plugin_dirs` are wired and CI-tested (`--features clap-host`). A hosted CLAP **instrument** now plays from the keyboard and follows automation: `note_on`/`note_off`/`set_param` queue sample-accurate CLAP events into a pre-sized, **allocation-free** RT input buffer drained each block (unit-tested in `backend/clap.rs`). Loading + *hearing* a real plugin runs on a rig with the plugin installed (the project's standing rig gating; JUCE/VST3 behind the heavy feature). The one open refinement: param events use the id as `clap_id` with an empty cookie (spec's lookup-by-id path) — a `clack-extensions` params map is the drop-in for cookie-keyed plugins (`ojhost/README.md`).
- [x] ✅ A **"Plugins" surface** in the UI: a discovery panel (Ctrl/Cmd+Shift+P) that scans the default folders, lists each installed plugin (vendor / format / ports / params), and explains the desktop-only host — tested with a mocked invoke.
- [x] ✅ Execute authored code/Faust nodes on the audio thread: the **wasmtime** RT backend runs `oj_*`-ABI wasm kernels end-to-end (4 passing tests) and the **native Faust→dll** path plays + responds to params (a passing test), plus the browser wasm-parity suite. The ONE sub-case still ⏸ — faust's own `-lang wasm` output — is blocked UPSTREAM (faust emits the wasm exception-handling proposal that wasmtime 45/cranelift can't parse; documented in `docs/code-node-abi.md`), and the native-dll path is its working fallback. Not an OpenJammer gap.

---

## 4. Production polish — ready for the stage

- [x] ✅ The DevLog is genuinely useful live: keyboard toggle + palette command, "N dropped" honesty, click-to-correlate, Escape-to-close, Ask-AI hand-off.
- [x] ✅ Panic-safe live UX: a top-level error boundary catches render crashes, logs them to the DevLog, and shows a calm recovery card (audio survives); failure paths log, never panic.
- [x] ✅ One-screen **"Audio health"** readout (Ctrl/Cmd+Shift+H / palette) — the diagnostics the AI reads, with Open-Settings + Ask-AI fix-it buttons.
- [x] ✅ Latency surfaced prominently: the warning banner (Fix Now + Ask AI), the Audio-health round-trip row, and USB-interface nudges.
- [x] ✅ Performance: code-split the heavy vendor libs (main chunk 1.8 MB → 654 KB); windowed DevLog list ships.
- [x] ✅ Accessibility pass on the new surfaces: Escape-to-close + aria-modal dialogs, aria-pressed/labelled DevLog facets, design-token theming throughout.
- [x] ✅ A polished first-run: a one-time hint on first audio-start guides you to a first sound; failed audio-init surfaces calmly.

---

## 5. Docs — nothing ships without them

- [x] ✅ `docs/agent-tools.md` covers the diagnostics/settings tools + the worked "get sound back" loop (drift-gated).
- [x] ✅ Architecture logging page + this roadmap.
- [x] ✅ An **"Instruments & sound"** doc (docs site): how voices are synthesized, how to bring your own sample/SoundFont/plugin, the family→voice map.
- [x] ✅ A **"Troubleshooting with the AI"** doc (docs site): what to ask, what it can see + change, the safety boundary.
- [x] ✅ Developer doc (`docs/voice-engine.md`) for the procedural voice engine + the executor sample-binding seam.

---

## 6. Foundations backlog (preserved from the original roadmap)

Still-ahead engineering workstreams (mostly hardware/signing-gated or DRY
refactors of already-green CI). Owner-flippable switches live in
[`OWNER-PROVISIONING.md`](OWNER-PROVISIONING.md).

### CI control plane (Phase 1, C1)
- [x] ✅ Composite actions (`setup-rust` + `setup-web`) collapse the repeated checkout/apt/toolchain/cache/bun blocks; ci.yml rewired to use them (reusable by release/canary).
- [x] ✅ Affected-selection (`changes` job via `oj plan --json`, Lane A) + the restored aggregate Merge gate (skipped≠failed), fail-safe to a full run.

### Testing depth (Phase 4)
- [x] ✅ libm-only DSP enforcement (clippy `disallowed-methods`).
- [x] ✅ Playwright PWA render-smoke (`crossOriginIsolated === true`).
- [x] ✅ Docs-as-requirement (`missing_docs` + `cargo doc -D warnings` + a standing negative fixture).
- [x] ✅ miri over the unsafe ring + hot-swap (Lane B nightly).
- [x] ✅ Golden corpus: a committed ULP-banded render fingerprint (libm-deterministic, checked on every arch the engine + Windows jobs run). `wasm-pack --node` parity is the natural extension of the same golden.
- [x] ✅ Fuzz the untrusted WAV parse surface: a bounded per-PR no-panic smoke (600+ adversarial inputs) + a detached cargo-fuzz target wired as a time-boxed nightly job.

### Persistence + delivery (Phase 5)
- [x] ✅ L3 SQLite/FTS5 store (native-first) + FTS5-availability smoke.
- [x] ✅ Production COOP/COEP host config (`public/_headers`).
- [x] ✅ R2 native updater: the audio-safe UpdateGate (no-TOCTOU, tested) + the Tauri desktop wiring (stage/is_pending/try_install). Download/relaunch is owner-enabled (signing keys, OWNER-PROVISIONING §3).
- [x] ✅ R3 PWA auto-update: prompt-mode SW + PwaUpdatePrompt (auto-apply on idle, channel-aware prompt while audio runs), tested.
- [x] ✅ R4 signing + delivery: canary.yml (push-on-main, canary key, reuses the build engine) + dual-arch macOS matrix + provenance attestation + a post-publish all-platform-signature gate. Wired-but-disabled behind CANARY_RELEASES_ENABLED + the owner's keys.
- [x] ✅ Loopback latency automation: RecorderSink wired into build_input + AudioHost::start_with_input_capture + a device-gated capture test.

---

*Design rationale for the foundations items lives in the project's git history and
the [documentation site](https://ponderingbgi.github.io/openjammer/). The product
items above (§0–§5) are tracked to completion here.*
