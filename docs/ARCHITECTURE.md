# OpenJammer Architecture (ojcore rewrite)

OpenJammer is being rewritten ground-up around **one minimal, real-time-safe Rust
DSP core (`ojcore`) that compiles to two targets** — native (for the <5ms,
plugin-hosting, live-performance experience) and `wasm32` (for the zero-install
browser/PWA tier) — driven by the existing React control plane. This document is
the contributor map; see `/home/wsl/.claude/plans/` history for the decision record.

## North star

- **Lean core, zero duplication, every line earns its place.** Everything beyond
  the core is a plugin: one `PluginManifest` + one CLAP-shaped `DspInstance` trait
  is implemented by built-in DSP, instruments, Faust/AI nodes, and (native)
  hosted VST3/AU/CLAP alike.
- **<5ms MIDI→audio** on the native build with a pro interface; the browser tier
  is honestly ~15–25ms and never marketed as sub-5ms.
- **The audio thread never allocates, locks, or blocks** — enforced mechanically
  (`assert_no_alloc` in CI, a compile-time size guard on `RtCommand`, an
  acyclic-schedule invariant proven in the compiler).

## Crate map (`crates/` + `src-tauri/`)

| Crate | Role |
|---|---|
| `ojproto` | The single UI↔engine wire contract: the flat `OjGraph` IR (closed `PrimitiveKind` + open `manifest_id`), `RtCommand`, `ParamPatch`, `EngineFrame`. Control-rate only; no audio buffers. `no_std`. |
| `ojcore-dsp` | Pure `no_std`+`libm` DSP kernels (RBJ biquad, waveshaper, delay, one-pole smoother, oscillator, Karplus). Shared by native + wasm. |
| `ojcore` | The engine: `compile` (Kahn topo-sort, hard cycle/port rejection) → alloc-free `process_block`; `std`-gated rtrb command queue + ArcSwap/basedrop graph swap; transport clock, metering, RT-resilience. `no_std` core. |
| `ojinstrument` | Sound generation: Osc/Sampler/Karplus/SF2 (rustysynth) `DspInstance`s + loaders. |
| `ojcore-native` | `cpal` real-time host (CoreAudio/WASAPI/ASIO/JACK/ALSA), `AudioHost`, content-addressed `AssetCatalog`, and the **loopback latency harness** (`bin/loopback`). |
| `ojcore-wasm` | `wasm-bindgen` AudioWorklet host wrapping the **same** `ojcore` core. |
| `ojcore-midiring` | `#[repr(C)]` wait-free SPSC byte ring for the JS↔wasm SharedArrayBuffer boundary. |
| `ojfaust` | Faust runtime-compilation scaffold (feature-gated on `libfaust`) + agentic compile-repair loop, for AI-authored DSP nodes. |
| `ojhost` | **Native-only** third-party plugin host: runs VST3 / CLAP (AU on macOS) behind the same `DspInstance` trait (`host.plugin` → `PrimitiveKind::PluginHost`). Default build is a dependency-free scaffold; real hosting is feature-gated (`clap-host` pure-Rust, or `juce`). All of OpenJammer's C++ is confined to this crate. |
| `ojwasm` | **Native-only** host for AI-/hand-authored **code nodes**: runs an `oj_*`-ABI wasm32 DSP module behind `DspInstance` (`PrimitiveKind::WasmHost`) via `wasmtime`, every output sample forced through the `OutputGuard` chain *outside* the sandbox. Default build is a scaffold; real execution is feature-gated (`wasmtime-host`). |
| `src-tauri` (`oj-tauri`) | Tauri v2 desktop shell: Rust backend runs `ojcore-native` + instruments and exposes control-rate IPC (`push_graph`, `send_command`); frontend is the web app. |
| `packages/oj-protocol-ts` | Hand-written TS mirror of `ojproto`, kept honest by `crates/ojproto/tests/wire_shapes.rs`. |

The React control plane (`src/`) — node editor, `graphStore`, MIDI, manifest
dispatch, the Ctrl+K command bar — authors graph state and emits the `OjGraph`;
it talks to whichever executor is selected (`VITE_OJ_EXECUTOR`): `ojcore-native`
(Tauri, the <5ms path) or `ojcore-wasm` (browser worklet, the default). The legacy
`webaudio` executor was removed in the U-DEDUP migration — `ojcore` is the one engine now.

**Which side of the core boundary does a given piece of code belong on — Rust or
TypeScript?** That is the subject of [BOUNDARY.md](./BOUNDARY.md): the four tiers, the
three gates that place any new logic, and why the translation membrane (`emitOjGraph`,
`resolveKeyboardNotes`) is correctly TypeScript rather than Rust despite feeling
"performance-critical."

## Build · run · test

```bash
# Engine (Rust workspace)
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo build -p ojcore --no-default-features        # the no_std core (wasm-friendly)
bash crates/ojcore-wasm/build.sh                    # wasm32 worklet build (needs nightly+wasm32+rust-src)

# Web control plane
bun install
bunx tsc --noEmit -p tsconfig.app.json
bun run test:run
bun run build

# Native desktop app (Tauri)
bun native                    # run the desktop app: Vite HMR + ojcore-native, fast scaffold plugin host
bun native --all              # same app with full JUCE VST3/CLAP/AU host (heavy first build)
bun native --engine           # windowless Rust/DSP inner-loop via bacon
bun run tauri build --features plugin-host-juce  # local installer matching release plugin hosting
```

### The committed wasm artefact — when it MUST be rebuilt

`src/audio/wasm/pkg/` (`ojcore_wasm.js` + `ojcore_wasm_bg.wasm`) is a **checked-in
build artefact**, so a fresh clone builds the app with no Rust toolchain. That
trade has exactly one failure mode, and it has already cost us a stage-breaking
bug: the artefact silently going stale against `crates/`.

**Rebuild it — `bash src/audio/wasm/build-wasm.sh --release` — and commit the two
files whenever you change anything the worklet reaches through
`wasm-bindgen`:** a new/renamed/removed `#[wasm_bindgen]` export in
`crates/ojcore-wasm`, or a change to `ojcore` / `ojcore-dsp` / `ojinstrument` /
`ojproto` behaviour you expect the browser tier to have. The engine crates are
statically linked into that binary; an untouched `pkg/` means the browser is
running a different engine from the one in `crates/`.

Prereqs (once): `rustup toolchain install nightly`,
`rustup +nightly target add wasm32-unknown-unknown`,
`rustup +nightly component add rust-src`, and
`cargo install wasm-bindgen-cli --version 0.2.125` — the CLI version **must**
match the `wasm-bindgen` pin in `crates/ojcore-wasm/Cargo.toml`.

**The guards — two of them.** First, `build-wasm.sh` emits `ojcore_wasm.d.ts` and it
is committed beside the glue, so `tsc` sees the engine's real export list: calling
an export the artefact does not have is a **compile error**. (The imports used to
carry `@ts-expect-error`, which is exactly how a non-existent `drain_transport`
went unnoticed for 17 commits.) Second,
`src/audio/worklets/__tests__/wasmExportParity.test.ts` parses the committed glue's
export list, the `.wasm` binary's own export section, and every `wasm.<name>(` call
in the worklet, and fails the web gate when they disagree — naming the missing
export. The declarations catch a *missing* export; the parity test additionally
catches the two halves of the artefact being committed **out of sync with each
other**, which types alone cannot see. It exists because the previous mitigation was the
opposite of a guard: the worklet soft-probed for exports with
`Reflect.get(wasm, 'drain_transport')` "so the committed pre-W3 glue stays
usable", the probe was always false, and the browser tier shipped for months with
**no transport return path and no timeline loaders at all** — every Play told the
player "the audio engine did not acknowledge the transport command" while the
engine was rolling fine, and every song's notes were dropped in silence. A
missing engine export is now a red test, never an invisible no-op (code-value #4:
fallbacks are exceptional, and never over the core's own contract).

Note that CI's `wasm32 build` step (`.github/workflows/ci.yml`) only proves the
crate *compiles* for `wasm32`; it does not regenerate or diff the artefact. The
parity test is what ties the shipped bytes to the source.

### Known gap: the wasm return path allocates on the render thread

Stated here rather than left to be rediscovered, because it looks like a
real-time-safety violation and the reason it is tolerated is not obvious.

`OjcoreProcessor.process()` — the AudioWorklet **render callback** — drains the
engine every 4 render quanta (~10 ms, i.e. **~94×/s** at 48 kHz/128) via
`drain_meters`, `drain_looper`, `drain_looper_edges`, `drain_events` and
`drain_transport`. Each returns a Rust `Vec`, the generated glue copies it into a
fresh JS typed array, and the worklet then adds a `TextDecoder`/`JSON.parse` and a
structured-clone `postMessage`. That is several allocations per drain, on the audio
thread, and it is the long-standing shape of the browser tier's return path — not
something any one change introduced. The wasm allocator is dlmalloc inside linear
memory, so there is no syscall, no OS lock and no priority inversion of the kind a
native `malloc` would cause; but a `memory.grow` on the render thread is still a
dropout waiting to happen.

**No CI gate covers any of this.** The required no-alloc gate is
`cargo nextest run -p ojcore`, and its `assert_no_alloc` scopes
(`crates/ojcore/tests/engine.rs`) wrap `Engine::process_block` on the **native**
target with **no meter ring attached**. So neither `ojcore-wasm`, nor
`Engine::publish_levels` (and therefore nor `Engine::transport_frame`), nor the
worklet's JS drains sit inside any gate. `transport_frame` is alloc-free by
inspection — `position_at` is pure arithmetic and `tempo_snapshot` is an `Arc`
refcount bump — but nothing proves it mechanically.

**Follow-up (named, not fixed here): `OJ-RT-WASM-RING`.** Move the wasm drains onto
a pre-allocated `SharedArrayBuffer` ring, the way native already publishes through
`meter::MeterRing`, so the render callback writes into fixed memory and the main
thread decodes; and extend the no-alloc gate to cover `publish_levels` with a ring
attached.

Setup + per-OS prerequisites live in one place: **[CONTRIBUTING.md § Native desktop](../CONTRIBUTING.md#native-desktop-tauri)**
(`bun run oj setup` installs them — a set derived from CI, asserted by a unit test, so local matches CI).

`bun native` is a **thin front-door**: it delegates the whole Vite+cargo lifecycle and process-tree
teardown to the Tauri CLI (the edge we don't own), so Ctrl+C is clean and **identical on
Windows/macOS/Linux** — never reintroduce a sibling orchestrator (Bun can't reliably kill a process
tree on Windows; the Tauri CLI already does, in Rust). It deliberately offers **no Vite-style keypress
menu**: a custom one would force the wrapper to take that teardown back, so it prints a controls
banner instead. The default plugin host is the scaffold (no VST/AU scan, no JUCE/CMake build) so
`bun native` behaves like a fast app dev loop; hosted-plugin testing opts in with `bun native --all`
(JUCE VST3/CLAP/AU; `--plugins` alias) or `bun native --clap` (pure-Rust CLAP). Editing `src/**` is Vite HMR in place
(canvas/AudioContext preserved); editing `crates/**` or `src-tauri/**` recompiles and **restarts** the
native window — for fast DSP iteration use `bun native --engine` (bacon: re-runs the
`render`/`nextest` harnesses on save, audible pass/fail, no window). The Pi sidecar rebuilds lazily on
first run / after a Pi upgrade (`OJ_DEV_SKIP_PI=1` to skip).

## CI & releases

**Branch model.** `canari` is the default/integration branch — every feature PR
targets it, and each push to `canari` feeds the **canari** delivery channel. A
new version is minted by promoting `canari` → `main` (a **merge commit**, never a
squash). `main` is the stable branch; the release workflow publishes `v0.0.1`
first, then increments patch on each automatic promotion. A maintainer can run
the promotion workflow with a target like `0.1.0` to start a new minor line.

- **`.github/workflows/ci.yml`** — the merge gate: the full Rust engine gate
  (fmt/clippy `-D warnings`/test/no_std/wasm32) + the web gate (tsc/test/build).
  Must be green to merge to `canari` (and to promote `canari` → `main`).
- **`.github/workflows/release.yml`** — the stable release path. Runs after
  promotion to `main`, stamps all four version files, tags `vX.Y.Z`, builds
  installers, stable-signs them, and publishes the GitHub Release.
- **`.github/workflows/promotion-pr.yml`** — keeps one standing `canari → main`
  "release candidate" PR open, titled with the stable version that will publish
  once it is merged.
- **`.github/workflows/canary.yml`** — on push to `canari` (owner-gated), builds +
  canari-signs installers and publishes numbered prereleases like
  `v0.0.2-canari.1` with signed updater metadata.

Native auto-update (Tauri `tauri-plugin-updater`) is active on **Windows + Linux**,
and ready on **macOS** behind the `apple-notarized` feature — it activates once the
build is signed/notarized (OWNER-PROVISIONING.md §4). It's quiet
by design: a new build downloads in the background and **installs silently after you
close OpenJammer** (no mid-session prompts and no self-reopen), gated through
`ojcore_native::UpdateGate` so the binary is never swapped while audio is live. The
channel (Stable / Canari) is a **runtime** choice in Settings → Updates; switching is
upstream-only (never downgrades). See
[channels-and-versions](../apps/docs/src/content/docs/build/internals/channels-and-versions.md).

## Founder-gated verification (needs real hardware/keys)

- **<5ms latency:** `cargo run -p ojcore-native --bin loopback 48000 64` on a pro
  interface (e.g. MOTU M4) with a MIDI controller (e.g. Arturia MiniLab 3). The
  sandbox is device-less and can only print the buffering floor.
- **Live Faust / AI DSP:** install `libfaust` (+ LLVM), build `ojfaust` with
  `--features libfaust`.

## Migration debt (tracked, not silently kept)

Code-value #8 says *every production line is used* — so the per-OS code that is
compiled-but-dormant today is listed here rather than left to rot unnoticed. Each
item is an honest gap with a defined unblock, not a permanent twin. Remove the row
when the gap closes.

- **macOS native updater — ready, pending signing credentials.** The updater is
  wired for macOS behind the `apple-notarized` feature (`updater.rs` gates on
  `any(windows, target_os = "linux", all(target_os = "macos", feature = "apple-notarized"))`).
  A default macOS build keeps the commands inert and ships a manual `.dmg`, because a
  non-notarized self-swapped `.app` is Gatekeeper-quarantined. *Activate:* provide the
  Apple Developer ID signing secrets and set the feature in CI — no code change
  (OWNER-PROVISIONING.md §4).
- **Windows/macOS sandbox `Jail` — constructed but unenforced.** `src-tauri/src/sandbox.rs`
  builds a `Jail` (writable/readable roots) in every jailed run, but only the
  **Linux** path enforces it (Landlock via `pre_exec`); on Windows/macOS `apply()`
  is a no-op and `jail_supported()` reports `false`, so the in-Pi permission-gate is
  the only active layer there. The `Jail` fields read as dead code off Linux (hence
  the `#[allow(dead_code)]`). *Unblock:* a Windows restricted-token + Job Object
  confinement and a macOS Seatbelt profile; until then the gap is surfaced honestly
  at spawn time ("OS-level file jail isn't available on this platform"). *Note:* the
  Windows **Job Object** added for Pi process-tree reaping (`ai.rs`) is a
  lifecycle/orphan-reap mechanism only — it is **not** the filesystem jail and does
  not close this row.
