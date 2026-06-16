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
| `src-tauri` (`oj-tauri`) | Tauri v2 desktop shell: Rust backend runs `ojcore-native` + instruments and exposes control-rate IPC (`push_graph`, `send_command`); frontend is the web app. |
| `packages/oj-protocol-ts` | Hand-written TS mirror of `ojproto`, kept honest by `crates/ojproto/tests/wire_shapes.rs`. |

The React control plane (`src/`) — node editor, `graphStore`, MIDI, manifest
dispatch, the Ctrl+K command bar — authors graph state and emits the `OjGraph`;
it talks to whichever executor is selected (`OJ_EXECUTOR`): `webaudio` (legacy,
default), `ojcore-native` (Tauri), or `ojcore-wasm` (browser worklet).

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
bun run tauri dev      # run the native shell against the dev server
bun run tauri build    # local installer (CI builds the cross-platform set)
```

System deps (Linux): `libasound2-dev` (cpal) and, for the Tauri shell,
`libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev`.

## CI & releases

- **`.github/workflows/ci.yml`** — the merge gate: the full Rust engine gate
  (fmt/clippy `-D warnings`/test/no_std/wasm32) + the web gate (tsc/test/build).
  Must be green to merge to `main`.
- **`.github/workflows/release.yml`** — on a `v*` tag, builds installers for
  macOS (aarch64+x86_64), Windows (.msi/.exe), and Linux (.deb/.AppImage) via
  `tauri-action` and attaches them to a draft GitHub Release.

## Founder-gated verification (needs real hardware/keys)

- **<5ms latency:** `cargo run -p ojcore-native --bin loopback 48000 64` on a pro
  interface (e.g. MOTU M4) with a MIDI controller (e.g. Arturia MiniLab 3). The
  sandbox is device-less and can only print the buffering floor.
- **Live Faust / AI DSP:** install `libfaust` (+ LLVM), build `ojfaust` with
  `--features libfaust`.
