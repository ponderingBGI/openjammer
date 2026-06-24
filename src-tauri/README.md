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
| `scan_plugins(dirs)` | Scan for VST3 / CLAP (+ AU) plugins and register them as nodes. |
| `ai_run(prompt, providerKey?, channel)` | **(U20)** Spawn Pi in a throwaway worktree, stream its tool calls back as Tauri events on `channel`. See [AI agent](#ai-agent-u20). |
| `ai_faust_compile(source)` | **(U20)** Compile an AI-authored Faust DSP via `ojfaust`. `Ok(None)` in the default build (no libfaust); the agent stores the source instead. |

> **Program swap note.** `push_graph` publishes the freshly compiled program to
> the `ProgramSwap` mailbox (the publish point of record). Because the public
> `AudioHost` API moves the engine wholesale into its callback and has no
> per-block swap hook of its own, adoption is currently realised by rebuilding
> the host around a fresh `Engine`. When `AudioHost` gains an in-callback
> `install_into` hook this collapses to "publish only" with no IPC change.

## AI agent (U20)

The Ctrl/Cmd+K command bar's **Ask AI** half (`src/ai/**`,
`src/components/CommandBar/**`) drives a "Pi-inspired" agent: type a request,
press Tab, and the agent proposes graph edits / new DSP nodes that apply live to
the canvas, each undoable with plain **Ctrl+Z** (no Approve/Reject gate —
reversibility plus the OS/Pi sandbox is the boundary). AI is **native/hybrid
only** — in a plain
browser the Tab -> AI path shows *"AI requires the desktop app"* and is disabled;
only inside this Tauri shell does the Rust `ai_run` command drive Pi.

`src/ai.rs` is the native driver. It treats **Pi as an untrusted generator,
never a trusted runner** (Pi has no permission system — its tool calls
auto-execute with the launching user's privileges, so sandboxing is the host's
job):

- **Persistent jailed workspace.** Pi runs with `HOME` pointed at
  `~/.openjammer/agent/` and cwd inside that agent workspace, so sessions and
  memory persist while the permission gate confines writes.
- **Env allowlist.** In jailed mode the child starts from an empty environment;
  only process basics plus the **one** provider key the user supplied are
  forwarded. Every other secret is stripped. OpenJammer never stores the key.
- **Tool calls are forwarded, not executed natively.** Graph mutations are
  surfaced to the frontend and applied live as the same reversible `graphStore`
  verbs the UI uses, each undoable with Ctrl+Z (no Approve/Reject gate).

### AI setup (one-time)

Pi is bundled with **native desktop releases only**. The browser/PWA build does
not ship or run Pi; it continues to show the desktop-required state.

1. **Use the desktop app.** `bun native` (lazily — only when stale) and
   `bun run tauri build --features plugin-host-juce` (always, for release-like
   installers) run `bun run build:pi-runtime`, which compiles the pinned Pi sidecar
   into `src-tauri/binaries/` and bundles it as a Tauri
   resource. At runtime
   OpenJammer copies that resource into `~/.openjammer/pi-runtime/<version>/`
   and launches it over `--mode rpc`. Developers can override with
   `OPENJAMMER_PI_BIN=/abs/path/to/pi`.

2. **Configure a provider key** — your own credentials, one provider. Let the UI
   collect it and forward it to the child under the provider's env var, or set
   that env var yourself. Override the forwarded var name with
   `OPENJAMMER_AI_KEY_VAR` (e.g. `OPENJAMMER_AI_KEY_VAR=ANTHROPIC_API_KEY`).

3. **(Optional) DSP authoring with real Faust compilation.** The
   `author_dsp_node` tool generates Faust source. Without libfaust the source is
   stored against the node (compile later); to compile in-app, build with
   `--features ojfaust/libfaust` after installing libfaust — see
   `crates/ojfaust/README.md`.

### Pi RPC schema

`ai.rs` normalizes Pi's LF-delimited JSONL RPC (split **only** on `\n`) against
the pinned protocol: `tool_execution_start` -> `tool-call`, a `message_update`
`text_delta` -> `thought`, `agent_end` -> `result`, and `extension_ui_request`
-> `ui-request`; every other lifecycle/partial event is skipped (no
thought-spam). The frontend mirror is `src/ai/PiAgentBackend.ts`.

### Testing without Pi

The whole tool-call -> graph-verb apply-live + undo path is
proven with Pi **mocked** (`MockAgentBackend`) — `bun run test:run` covers
`src/ai/__tests__` and `src/store/__tests__/agentSessionStore.test.ts`. The
native `ai.rs` env-stripping + JSONL parsing have Rust unit tests
(`cargo test -p oj-tauri ai::`). Real-Pi behaviour in desktop builds uses the
bundled sidecar; no test here depends on a global Pi install.

## Local development

Run the desktop app from the **repo root** (not this directory):

```bash
bun native   # Vite HMR + the native engine; opens the window, streams logs
```

Setup, per-OS prerequisites (`bun run oj setup`), and the dev controls are documented once in
**[CONTRIBUTING.md § Native desktop](../CONTRIBUTING.md#native-desktop-tauri)** — don't duplicate
them here. In short: `bun native` delegates the whole Vite+cargo lifecycle and Ctrl+C teardown to
the Tauri CLI (the edge that already does recursive process-tree kill on every OS — never add a
sibling orchestrator here); it runs the config's `beforeDevCommand` (`bun run dev` →
`http://localhost:5173`), opens the window with web-UI HMR, and recompiles + restarts the window on
Rust edits. The default plugin host is the fast scaffold (no VST/AU scan, no JUCE/CMake build), so
normal app work starts like a dev server. The raw `bun run tauri dev` still works for debugging the
shell directly.

**Tauri-specific knobs.** The bundled Pi (Ctrl+K AI) sidecar builds **lazily** — only on first run
or after a Pi upgrade; set `OJ_DEV_SKIP_PI=1` to skip it, or `OPENJAMMER_PI_BIN` to point at an
external Pi. Use `bun native --all` for the full JUCE VST3/CLAP/AU host (first build can take
minutes; `--plugins` is an alias), `bun native --clap` for the pure-Rust CLAP host, and
`bun native --engine` for the windowless [bacon](https://dystroy.org/bacon/) Rust/DSP loop over the `render`/`nextest` harnesses
(`cargo install --locked bacon`).

## Building / verifying

```bash
cargo build -p oj-tauri                       # compile the native backend
cargo clippy -p oj-tauri -- -D warnings       # lint clean
cargo fmt --all -- --check                    # format clean
cargo test -p oj-tauri                         # backend unit tests (device-less safe)
```

A full `bun run tauri build --features plugin-host-juce` produces the platform installer locally
with the same hosted-plugin backend as releases; it is heavy, so CI (below) is the canonical
installer build.

## Release flow (CI)

`.github/workflows/release.yml` builds and publishes the installers:

1. Merge the standing `canari -> main` promotion PR. The workflow computes the
   next patch version (`v0.0.1`, `v0.0.2`, ...), commits the four version files
   on `main`, and tags the commit. To start a new line, run the promotion
   workflow with `target_version=0.1.0` before merging.
2. The workflow fans out over `macos-latest` (arm64 **and** x86_64),
   `ubuntu-latest`, and `windows-latest`, installing the Linux webview deps in
   the Ubuntu job.
3. `tauri-apps/tauri-action` runs the config's `beforeBuildCommand`
   (`bun run build`) to build the web frontend, then `tauri build --features plugin-host-juce` to
   produce each platform's installers:
   - macOS: `.app`, `.dmg`
   - Linux: `.deb`, `.AppImage`
   - Windows: `.msi`, `.exe`
4. The artifacts are attached to a published GitHub Release named
   `OpenJammer <tag>`.

Canari builds are published by `.github/workflows/canary.yml` as numbered
prereleases like `v0.0.1-canari.1`. The `0.0.1` part is the stable version the
current `canari -> main` promotion will publish.
