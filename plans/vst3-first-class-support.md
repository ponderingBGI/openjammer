# First-Class VST2/VST3 Plugin Support Plan

## Context
- The current desktop build scans plugins from the Plugins panel via `scan_plugins({ dirs: [] })`, but `src-tauri/Cargo.toml` enables only `ojhost/clap-host`, so installed VST3/VST2 plugins are not hostable.
- This machine has VST3 plugins in `C:\Program Files\Common Files\VST3` and VST2 `.dll` plugins in `C:\Program Files\VstPlugins`, confirming the user-visible failure mode.
- `crates/ojhost` already has the right architectural seam: a feature-gated JUCE backend (`juce`) with a C ABI, scanner, live backend, and `PluginHostNode` wrapper. It currently targets VST3/CLAP/AU and is documented as not fully verified.
- Current hosted plugins are not truly first-class: every scanned plugin registers under the single manifest id `host.plugin`, and `register_scanned` documents that the registry keeps only the last one.
- The frontend already has an open dynamic identity path (`pluginId`, `dynamicRegistry`, `resolveNodeDefinition`, serialization), but `manifestForDynamic` currently assumes dynamic plugins are `WasmHost`, not `PluginHost`.
- User scope decisions: ship on Windows/macOS/Linux, include full native plugin editor windows, enable in the public build by default, and include VST2 as well as VST3.

## Approach
- Promote `ojhost/juce` to the shipped desktop plugin backend and expand it to VST2 + VST3 + CLAP (+ AU on macOS), with CI/release builders installing the required native deps.
- Make every scanned hosted plugin a stable dynamic node with its own `pluginId`/manifest id (`host.<format>.<hash>` or equivalent), so multiple VST2/VST3 plugins can coexist, be added from the UI, serialize, reload, and resolve to the correct installed binary.
- Use JUCE-owned top-level native editor windows for plugin editors instead of embedding editor views inside the React canvas; React/Tauri will request open/close/focus, and JUCE will own the platform-native editor lifetime on the UI/message thread.
- Add out-of-process scan probing before public default VST/VST3 support so a crashing plugin cannot take down OpenJammer during discovery; keep the existing cache/blacklist format as the recovery layer.
- Keep CLAP support working through the JUCE path. AU remains macOS-only. VST2 support is included, but must pass a licensing/header availability gate before release.

## Files to modify
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/engine.rs`
- `src/audio/executor/OjcoreNativeExecutor.ts`
- `src/audio/ojgraph/emit.ts`
- `src/engine/dynamicRegistry.ts`
- `src/engine/manifest.ts`
- `src/engine/registry.ts`
- `src/engine/serialization.ts`
- `src/store/graphStore.ts`
- `src/components/Plugins/PluginsPanel.tsx`
- `src/components/Plugins/PluginsPanel.css`
- `src/components/Plugins/__tests__/PluginsPanel.test.tsx`
- `src/components/Nodes/NodeWrapper.tsx`
- `src/components/params/AutoParamPanel.tsx`
- `crates/ojhost/Cargo.toml`
- `crates/ojhost/build.rs`
- `crates/ojhost/cpp/CMakeLists.txt`
- `crates/ojhost/cpp/ojhost_juce.h`
- `crates/ojhost/cpp/ojhost_juce.cpp`
- `crates/ojhost/src/descriptor.rs`
- `crates/ojhost/src/backend.rs`
- `crates/ojhost/src/backend/juce.rs`
- `crates/ojhost/src/scan.rs`
- `crates/ojhost/src/lib.rs`
- `crates/ojhost/src/node.rs`
- `.github/workflows/build-installers.yml`
- `.github/workflows/canary.yml`
- `.github/workflows/release.yml`
- `.github/actions/setup-rust/action.yml`
- `docs/TESTING.md`
- `crates/ojhost/README.md`

## Reuse
- `crates/ojhost/src/backend.rs`: existing backend dispatch seam; `juce` already wins over `clap-host` when compiled.
- `crates/ojhost/cpp/ojhost_juce.*`: existing C ABI and JUCE scanner/loader/process bridge.
- `crates/ojhost/src/scan.rs`: existing candidate walking, scan cache, and blacklist; extend rather than replace.
- `crates/ojhost/src/node.rs`: existing `PluginHostNode` / `PluginHostLoader` wrapper around hosted plugins.
- `src-tauri/src/lib.rs`: existing `scan_plugins`, `plugin_dirs`, and `reveal_path` Tauri command pattern.
- `src/engine/dynamicRegistry.ts`, `src/engine/serialization.ts`, `src/engine/registry.ts`: existing open `pluginId` identity and round-trip path.
- `src/audio/ojgraph/emit.ts`: existing dynamic manifest lowering hook used for AI-authored native code nodes.
- `src/components/params/AutoParamPanel.tsx`: existing auto UI for plugin parameters; add editor-window actions here or next to it.

## Steps
- [ ] Resolve VST2 legal/header distribution path before implementation is merged to public release builds.
- [ ] Verify and fix JUCE backend builds on Windows, macOS, and Linux with current JUCE 8, including platform link libraries in `crates/ojhost/build.rs`.
- [ ] Update CI/release deps for JUCE builds: CMake, C++ toolchains, Linux X11/freetype/ALSA/WebKit deps, and any required Steinberg SDK/VST2 SDK inputs.
- [ ] Change the shipped desktop dependency from CLAP-only to the full JUCE host feature; keep a scaffold/no-host feature for tests and constrained dev environments.
- [ ] Extend `PluginFormat` and the C ABI to include VST2, with platform-aware extensions/directories: Windows `.dll` under VST folders, macOS `.vst`, Linux `.so`/VST folders, plus existing VST3/CLAP/AU.
- [ ] Expand default plugin directories and `plugin_dirs()` reporting so the UI lists VST2, VST3, CLAP, and macOS AU folders and safely reveals only known plugin locations.
- [ ] Add out-of-process scan helper/protocol: parent enumerates candidates, helper probes one plugin/bundle, parent caches success or blacklists failures/crashes.
- [ ] Improve JUCE scan descriptors: stable uid, name, vendor, format, instrument/effect flag, audio I/O, parameter names/defaults/ranges, latency where available, and a clear scan/load error diagnostic.
- [ ] Replace the single `host.plugin` id with stable per-plugin manifest ids and register every scanned descriptor into the Rust `PluginRegistry` under its unique id.
- [ ] Add a hosted-plugin dynamic definition builder in TypeScript so scan results register matching `pluginId`s, names, ports, params, category, and `PluginHost` manifests in the frontend.
- [ ] Generalize `manifestForDynamic` / `emit.ts` so dynamic `PluginHost` nodes lower to `PrimitiveKind::PluginHost` under their unique manifest id in the native executor, not to `WasmHost` or the closed `effect` fallback.
- [ ] Add UI affordances to insert scanned plugins from the Plugins panel and command palette; effects should default to audio-in/audio-out, instruments to audio-out plus MIDI/note affordances where available.
- [ ] Persist enough descriptor data in node `data`/serialization to self-heal hosted-plugin definitions on project reload, then re-resolve against current scan results by uid/path/format.
- [ ] Add native editor lifecycle: Tauri commands such as `plugin_editor_open(node_id)` / `plugin_editor_close(node_id)`, Rust engine lookup from visual node to hosted plugin instance, JUCE C ABI for create/show/focus/close editor, and cleanup on node removal/app close.
- [ ] Add frontend editor controls on hosted plugin nodes: “Open editor”, “Focus editor”, and status when the plugin has no editor or failed to open.
- [ ] Audit RT safety for hosted plugin parameter and MIDI/note delivery; ensure editor/UI parameter changes do not allocate or lock on the audio thread.
- [ ] Add blacklisting/quarantine UX for plugins that crash scanning or fail loading, with a reset/rescan path.
- [ ] Update tests across Rust scanner/descriptor/registry, TypeScript dynamic manifest/serialization/emit, Plugins panel rendering/insertion, and editor command error paths.
- [ ] Update docs for installing plugins, supported formats, VST2/VST3 licensing/toolchain requirements, and platform-specific troubleshooting.

## Verification
- Windows: public build lists and loads installed VST3 plugins from `C:\Program Files\Common Files\VST3` and VST2 plugins from `C:\Program Files\VstPlugins`.
- macOS: public build lists and loads VST3, VST2 `.vst`, CLAP, and AU where installed.
- Linux: public build lists and loads VST3, VST2, and CLAP from standard user/system folders.
- Add at least two different VST2/VST3 plugins to the same graph and verify both keep distinct manifest ids and audio behavior.
- Save/reload a workflow containing multiple hosted plugins and verify they resolve back to the same installed plugins or show actionable missing-plugin diagnostics.
- Open, focus, close, remove-node, and app-quit plugin editor windows on all platforms without leaks or crashes.
- Verify one VST instrument receives notes/MIDI and one VST effect processes incoming audio.
- Verify scan crash isolation by testing a deliberately bad/non-plugin candidate in VST folders; OpenJammer must remain running and quarantine the candidate.
- Run Rust tests for `ojhost` scan/descriptor/node registration and Tauri plugin commands.
- Run frontend tests for Plugins panel, dynamic hosted manifests, graph emission, serialization, and node editor controls.
- Run full installer workflows for Windows/macOS/Linux.

## Open questions / external gates
- VST2 is discontinued by Steinberg. Full public VST2 support requires a legal SDK/header path that CI and release builders can use; decide whether the project has/accepts that dependency or whether VST2 must ship behind a disabled-until-configured gate.
