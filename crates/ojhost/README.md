# ojhost — third-party plugin host (UNIT U-JUCE)

Hosts **VST3 / CLAP** (and **AU** on macOS) plugins so professional users can run
their existing tools inside OpenJammer. A hosted plugin is "just a plugin": it
implements [`ojcore::DspInstance`] and is minted by an [`ojcore::PluginLoader`]
registered under the `host.plugin` manifest id, lowering to
[`ojproto::PrimitiveKind::PluginHost`]. The engine drives it through the exact
same node surface as a built-in.

**NATIVE-ONLY** — never compiled to `wasm32`. **All of OpenJammer's C++ is
confined to this crate** (the JUCE backend); the rest of the engine stays Rust.

## Backends (feature-gated, like `ojfaust`)

| Build | Formats | Native deps | Notes |
|-------|---------|-------------|-------|
| **default (scaffold)** | none | none | `scan` returns empty; `load` is `Unavailable`. Always builds + tests with no toolchain and no network. |
| `--features clap-host` | CLAP | none (pure Rust) | Real CLAP hosting via [`clack`] (MIT). **Recommended path** in a CMake-less environment. |
| `--features juce` | VST3 + CLAP (+ AU on macOS) | CMake + C++ + (VST3 SDK) | Bundled C++ JUCE 8, built by `build.rs` via CMake FetchContent. |

The scaffold default is deliberate: the descriptor marshalling, scan cache,
crash-blacklist, and the `DspInstance` bridge are all fully present and
unit-tested without any heavy dependency. Turning on a feature only swaps the
*backend that actually opens a plugin*.

```rust
use ojhost::{scan, HostedPlugin, HostingBackend};
let found = scan(&[std::path::PathBuf::from("/path/to/plugins")]).unwrap();
// scaffold: empty; clap-host: real CLAP descriptors; juce: VST3/CLAP/AU
```

## Out-of-process scanning posture

True OOP scanning (fork a child, probe one plugin, treat the child dying as
"bad") is the safest default but needs a second executable + IPC. **This unit
defers full OOP** and ships the two pieces that make in-process scanning
*recoverable*:

* **blacklist-on-crash** (`Blacklist`): a path is persisted to the blacklist
  *before* it is probed and removed *after* a clean probe — so a hard crash
  mid-probe leaves the path blacklisted and the next scan skips it. The same
  crash never kills two scans.
* **on-disk cache** (`ScanCache`): clean results are persisted, so a restart
  lists plugins instantly without re-probing.

The JUCE backend additionally uses JUCE's `PluginDirectoryScanner` +
dead-man's-pedal file, the same mechanism, and can later be promoted to genuine
OOP without changing the cache/blacklist file formats.

## Licensing posture

* **JUCE 8** — used under **AGPL-3.0**, which matches OpenJammer's own
  AGPL-3.0-only license, so JUCE 8 is **free to use** here (no commercial JUCE
  license required). Shipping a closed-source binary would require a commercial
  JUCE license; OpenJammer is AGPL, so this is a non-issue.
* **VST3 SDK** (Steinberg) — hosting VST3 needs the Steinberg VST3 SDK, which has
  **its own license** (dual GPLv3 / proprietary). Under GPLv3 it is compatible
  with AGPL distribution. The founder must accept Steinberg's terms and provide
  the SDK (JUCE can fetch it, or point `VST3_SDK_DIR` at a local checkout).
* **CLAP** — **MIT**. No restrictions. Both the `clack` (pure-Rust) and JUCE CLAP
  paths host CLAP plugins under MIT.

## Founder setup — to host a REAL plugin

### Option A: CLAP only, no C++ (fastest)

1. Build with the pure-Rust backend:
   `cargo build -p ojhost --features clap-host`
   (or for the app: `cargo build -p oj-tauri --features ojhost/clap-host`).
2. From the UI, call `scan_plugins(dirs)` with your CLAP directories, e.g.
   `~/.clap`, `/usr/lib/clap`, `/Library/Audio/Plug-Ins/CLAP` (macOS).
3. No extra system deps. CLAP only (no VST3/AU).

### Option B: full JUCE host (VST3 + CLAP + AU)

1. Install CMake and a C++17 toolchain:
   `sudo apt-get install -y cmake build-essential` (Linux),
   Xcode command-line tools (macOS), or Visual Studio (Windows).
   Linux also needs JUCE's hosting deps:
   `sudo apt-get install -y libasound2-dev libfreetype6-dev libx11-dev`.
2. Build with the JUCE backend:
   `cargo build -p ojhost --features juce`
   (or `cargo build -p oj-tauri --features ojhost/juce`).
   The first build clones JUCE 8 via CMake FetchContent (a few hundred MB) and
   compiles it — expect several minutes.
3. **VST3**: accept the Steinberg VST3 SDK license. JUCE 8 can fetch it; if your
   environment blocks that, point CMake at a local SDK and ensure
   `JUCE_PLUGINHOST_VST3=1` (set in `cpp/CMakeLists.txt`).
4. **CLAP via JUCE**: the CMake build opts in to the community
   `clap-juce-extensions` (`-DOJHOST_WITH_CLAP=ON`, the build.rs default). If it
   cannot be fetched, prefer Option A's pure-Rust CLAP path.
5. Plugin directories (defaults vary by OS):
   * VST3: `~/.vst3`, `/usr/lib/vst3` (Linux) · `~/Library/Audio/Plug-Ins/VST3`,
     `/Library/Audio/Plug-Ins/VST3` (macOS) · `C:\Program Files\Common
     Files\VST3` (Windows).
   * AU (macOS): `~/Library/Audio/Plug-Ins/Components`,
     `/Library/Audio/Plug-Ins/Components`.

## What remains to ship the JUCE path end-to-end

The JUCE C ABI (`cpp/ojhost_juce.h`), the C++ implementation
(`cpp/ojhost_juce.cpp`), the CMake wiring (`cpp/CMakeLists.txt`), the `build.rs`
cmake driver, and the Rust FFI binding (`src/backend/juce.rs`) are all present
and type-check. To finish enabling it in a real environment:

* install CMake + toolchain (above) and run a `--features juce` build to compile
  JUCE + the shim (cannot be verified in the scaffold sandbox: no CMake there);
* confirm/extend the platform link libraries in `build.rs` for your OS;
* wire CLAP param/note events on the `clack` path (`set_param` is currently a
  no-op there — it needs the `clack-extensions` params extension; the JUCE path
  already forwards params + MIDI notes).

[`clack`]: https://github.com/prokopyl/clack
[`ojcore::DspInstance`]: ../ojcore/src/dsp.rs
[`ojcore::PluginLoader`]: ../ojcore/src/loader.rs
