# VST3 First-Class Support Plan

## Context
- OpenJammer currently scans installed plugin folders from the Plugins panel via `scan_plugins({ dirs: [] })`.
- The installed Windows machine has VST3 plugins under `C:\Program Files\Common Files\VST3`, but the app build only enables the pure-Rust CLAP host (`ojhost/clap-host`).
- `ojhost` already contains a feature-gated JUCE backend intended for VST3 + CLAP (+ AU on macOS), but it is not currently the shipped desktop path and is documented as not fully verified.
- Current hosted plugins share the single manifest id `host.plugin`; this is not truly first-class for multiple VST3 plugins because the plugin registry keeps only one loader per manifest id (`register_scanned` comment: last registered wins).

## Approach
- Make VST3 a first-class native plugin format by finishing and enabling the JUCE backend for the desktop build, then fixing the hosted-plugin identity/model so each scanned VST3 is independently addressable, visible, addable, serializable, and loadable.
- Keep CLAP support working; JUCE becomes the full desktop host path for Windows/macOS/Linux builds that include VST3 support.
- Treat VST2 `.dll` plugins as explicitly unsupported unless separately requested.

## Files to modify
- `src-tauri/Cargo.toml`
- `crates/ojhost/Cargo.toml`
- `crates/ojhost/build.rs`
- `crates/ojhost/cpp/CMakeLists.txt`
- `crates/ojhost/cpp/ojhost_juce.h`
- `crates/ojhost/cpp/ojhost_juce.cpp`
- `crates/ojhost/src/backend/juce.rs`
- `crates/ojhost/src/scan.rs`
- `crates/ojhost/src/lib.rs`
- `crates/ojhost/src/node.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/engine.rs`
- `src/components/Plugins/PluginsPanel.tsx`
- `src/components/Plugins/__tests__/PluginsPanel.test.tsx`
- Additional graph/UI files still to identify for adding a scanned plugin as an actual node.

## Reuse
- Existing `ojhost` backend feature seam: `crates/ojhost/src/backend.rs`.
- Existing JUCE C ABI and shim: `crates/ojhost/cpp/ojhost_juce.h`, `crates/ojhost/cpp/ojhost_juce.cpp`.
- Existing scanner, blacklist, and cache path: `crates/ojhost/src/scan.rs`.
- Existing hosted plugin node wrapper and loader: `crates/ojhost/src/node.rs`.
- Existing native Tauri commands: `scan_plugins`, `plugin_dirs`, and `reveal_path` in `src-tauri/src/lib.rs`.
- Existing Plugins panel UI and tests: `src/components/Plugins/PluginsPanel.tsx`.

## Steps
- [ ] Confirm scope decisions: Windows first vs all desktop platforms; VST3-only vs VST3+CLAP in one JUCE build; whether hosted plugins need plugin editor windows in this milestone.
- [ ] Verify the current JUCE backend builds on Windows with CMake + MSVC and a VST3 SDK path.
- [ ] Add missing Windows/MSVC link settings and build-script configuration for the JUCE backend.
- [ ] Change the desktop app feature set so VST3-capable builds use `ojhost/juce` instead of only `ojhost/clap-host`.
- [ ] Update plugin directory reporting so the Plugins panel shows VST3 folders as well as CLAP folders, and can reveal both safely.
- [ ] Fix hosted plugin identity: each scanned VST3/CLAP plugin needs a stable unique plugin id instead of all plugins colliding on `host.plugin`.
- [ ] Update graph/serialization/UI code so a scanned hosted plugin can be added as its own node and round-trips in saved projects.
- [ ] Improve JUCE scan details: expose VST3 names, vendor, audio port counts, instrument/effect classification, latency, and parameters consistently.
- [ ] Add diagnostics for unsupported formats, failed scans, blacklisted/crashing plugins, and missing VST3 backend/toolchain in dev builds.
- [ ] Extend tests for VST3 directory discovery, plugin list rendering, unique hosted-plugin ids, serialization, and no-crash behavior when VST3s exist but hosting is unavailable.
- [ ] Document local setup and release-builder requirements for VST3/JUCE builds.

## Verification
- Build the app on Windows with the JUCE backend enabled.
- Confirm the Plugins panel lists installed VST3 plugins from `C:\Program Files\Common Files\VST3`.
- Add at least two different VST3 plugins to a graph and verify both remain distinct.
- Save/reload a workflow containing VST3 plugin nodes and verify they resolve back to the same installed plugins.
- Verify audio processing with one instrument VST3 and one effect VST3.
- Run targeted Rust tests for `ojhost` and Tauri plugin commands.
- Run frontend tests for `PluginsPanel` and graph/plugin serialization.

## Open questions
- Should this milestone target Windows first, or must Windows/macOS/Linux all be release-ready at once?
- Is first-class support expected to include opening the plugin’s native editor UI, or is auto-generated parameter controls enough for the first milestone?
- Should the shipped public build include JUCE/VST3 by default, accepting the heavier toolchain and license obligations, or should VST3 be an opt-in founder/developer build feature initially?
- Do you want VST2 `.dll` plugins explicitly out of scope, or should the UI explain why VST2 plugins found on disk are unsupported?
