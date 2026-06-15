# OpenJammer native desktop shell (`oj-tauri`)

The installable native app for macOS / Windows / Linux. It is the **back** half
of OpenJammer's hybrid architecture:

- **Front:** the existing Vite web app (`src/`, the repo's React UI) loaded into
  the Tauri webview — unchanged. In dev it is served by `bun run dev`
  (`http://localhost:5173`); in a release build it is the bundled `../dist`.
- **Back:** the native, low-latency `ojcore` engine running on a `cpal` audio
  stream (`ojcore-native::AudioHost`), targeting the `<5 ms` round trip.

The two talk over Tauri's `invoke` IPC, which is strictly **control-rate**:
`OjGraph` and `RtCommand` cross the boundary as JSON; **no audio sample buffer
ever does**.

## Crate layout

| Path | What |
| --- | --- |
| `Cargo.toml` | The `oj-tauri` crate (binary `openjammer`, lib `oj_tauri_lib`). A workspace member. |
| `src/main.rs` | Desktop entry point; calls `oj_tauri_lib::run()`. |
| `src/lib.rs` | Tauri builder + the `#[tauri::command]` IPC seam. |
| `src/engine.rs` | `EngineBackend`: the native RT engine wiring (registry, compile, `AudioHost`, command ring, program swap). |
| `tauri.conf.json` | Tauri v2 config. Frontend = the root Vite app. |
| `capabilities/` | Tauri v2 capability/permission set for the webview. |
| `icons/` | Desktop app icons (regenerate with `bun run tauri icon <png>`). |

## Backend wiring (`src/engine.rs`)

On startup the backend:

1. Builds a `PluginRegistry` and registers the built-in **GainLoader** plus the
   `ojinstrument` **Osc / Sampler / Karplus** loaders ("everything is a plugin").
2. Compiles a minimal starter `OjGraph` (a gain into the master `SpeakerOut`)
   into a `CompiledProgram`, wraps it in an `Engine`.
3. Starts an `AudioHost` (`StreamRequest`: 48 kHz, 64-frame buffer, stereo).
   The host owns the engine inside its realtime-promoted audio callback (its own
   thread). A device-less environment (CI / headless) is non-fatal — the host
   stays idle and the UI still runs.

### Tauri commands (the UI -> RT seam)

| Command | Effect |
| --- | --- |
| `push_graph(graph: OjGraph)` | Recompile the graph against the registry, publish it to the `ProgramSwap` mailbox, and adopt it into the running engine. |
| `send_command(cmd: RtCommand)` | Enqueue a note/param/transport command onto the wait-free UI -> RT ring the audio callback drains each block. |
| `query_stream()` | Return the negotiated stream + buffering-floor latency. |
| `engine_running()` | Whether an audio stream is currently running. |

> **Program swap note.** `push_graph` publishes the freshly compiled program to
> the `ProgramSwap` mailbox (the publish point of record). Because the public
> `AudioHost` API moves the engine wholesale into its callback and has no
> per-block swap hook of its own, adoption is currently realised by rebuilding
> the host around a fresh `Engine`. When `AudioHost` gains an in-callback
> `install_into` hook this collapses to "publish only" with no IPC change.

## Local development

From the **repo root** (not this directory):

```bash
bun install                 # installs @tauri-apps/cli (+ web deps)
bun run tauri dev           # launches the native window with the live Vite UI
```

`bun run tauri dev` runs the config's `beforeDevCommand` (`bun run dev`), waits
for `http://localhost:5173`, then opens the native window with hot reload of both
the web UI and (on save) the Rust backend.

### Linux build dependencies

The native shell needs the system webview + audio dev libraries:

```bash
sudo apt install \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev librsvg2-dev libasound2-dev pkg-config
```

macOS and Windows need only the Rust toolchain + Xcode CLT / MSVC build tools.

## Building / verifying

```bash
cargo build -p oj-tauri                       # compile the native backend
cargo clippy -p oj-tauri -- -D warnings       # lint clean
cargo fmt --all -- --check                    # format clean
cargo test -p oj-tauri                         # backend unit tests (device-less safe)
```

A full `bun run tauri build` produces the platform installer locally; it is
heavy, so CI (below) is the canonical installer build.

## Release flow (CI)

`.github/workflows/release.yml` builds and publishes the installers:

1. Push a version tag: `git tag v0.1.0 && git push origin v0.1.0`.
2. The workflow fans out over `macos-latest` (arm64 **and** x86_64),
   `ubuntu-latest`, and `windows-latest`, installing the Linux webview deps in
   the Ubuntu job.
3. `tauri-apps/tauri-action` runs the config's `beforeBuildCommand`
   (`bun run build`) to build the web frontend, then `tauri build` to produce
   each platform's installers:
   - macOS: `.app`, `.dmg`
   - Linux: `.deb`, `.AppImage`
   - Windows: `.msi`, `.exe`
4. The artifacts are attached to a **draft** GitHub Release named
   `OpenJammer <tag>`. Review the draft, then publish.
