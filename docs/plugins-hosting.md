# Hosting third-party plugins

OpenJammer treats a hosted instrument or effect as an engine node, but it does not trust
foreign code as if it were part of the engine. This page is the public reliability contract:
what the host guarantees, which formats are ready, and what happens when a plugin misbehaves.

## Reliability contract

For every supported plugin OpenJammer promises to:

- scan it outside the live audio path and quarantine a binary that crashes while being read;
- instantiate, restore state, activate, process, deactivate, and destroy it in the order required
  by the plugin format;
- deliver sample-offset note and parameter events and preserve the plugin's opaque project state;
- sanitize every output block: NaN, infinity, and denormals become silence, and unsafe amplitudes
  are bounded before they reach the master;
- watch processing time, release held notes, and auto-bypass an instance that misses its block
  budget while unrelated tracks keep flowing;
- publish plugin latency and tail information where the backend exposes it; and
- report failures as a calm Bench card without opening a modal or stealing focus.

The current host is in-process. A native crash can therefore still take down the application;
the crash marker benches that binary on the next launch. Full crash isolation requires a future
out-of-process audio host. The watchdog can detect a completed late block, but Rust cannot safely
kill foreign code that never returns.

## Formats and support tiers

| Format | Support | Backend and limits |
|---|---|---|
| CLAP | First-class on desktop | Pure-Rust `clack` host behind `ojhost/clap-host`; conformance, hostile probes, and the nightly OSS matrix cover params, notes, state, latency, tail, lifecycle, and output guarding. |
| VST3 | Desktop, build-gated | JUCE 8 behind `ojhost/juce`; baseline scan/lifecycle is exercised nightly. It is not part of the fast hermetic CI lane. |
| Audio Unit | macOS, build-gated | JUCE backend only; requires the macOS release toolchain and is not claimed on Linux or Windows. |
| VST2 | Owner-provisioned legacy path | Disabled by default. OpenJammer does not distribute the discontinued SDK. |

JUCE 8 does not host CLAP, and `clap-juce-extensions` is a plugin wrapper rather than a host
format. The nightly JUCE lane therefore performs the honest fallback: scan and lifecycle against
the VST3 build of Dexed. Full CLAP conformance belongs to the pure-Rust clack lane; there is no
claimed cross-backend CLAP parity.

Plugin GUI embedding is pending a `clack`/window-hosting upgrade. The pure-Rust CLAP path hosts DSP
and a generic parameter surface today; do not interpret that as a promise that every vendor editor
can be embedded. JUCE-gated builds can open supported editors in a native child window.

## Quarantine and the Bench

Scanning happens in a disposable helper process. Before a candidate is opened, the host writes a
marker; a clean scan clears it. A crash leaves an explanation in the quarantine store, and a second
crash benches the binary. **Try again** clears one entry; **Un-bench** is an explicit player choice.
The project keeps the node id and opaque state even when its binary is missing or benched.

At runtime the OutputGuard and watchdog operate per instance. A broken track is silenced or bypassed;
other graph branches are not rebuilt or muted. The Bench card says what happened, what OpenJammer did,
and offers one recovery action. Saving remains available after the fault.

## The verified OSS matrix

The checked-in matrix is
[`crates/ojhost/tests/fixtures/realworld-plugins.toml`](../crates/ojhost/tests/fixtures/realworld-plugins.toml).
It currently covers Surge XT, Dexed, Airwindows Consolidated, and ChowKick. Release asset URLs,
versions/commits, source and binary licenses, SHA-256 hashes, plugin kind, and render policy are all
reviewed data. Synths must produce finite, non-silent audio with a repeatable RMS envelope;
deterministic effects use tolerance-banded fingerprints.

To propose support for another plugin:

1. Choose an official, redistributable OSS release that includes a Linux x86_64 CLAP binary.
2. Add an immutable asset name and SHA-256 to the manifest; document both source and combined-binary
   licenses when they differ.
3. Run `OJ_PLUGIN_IDS=your-id scripts/ci/fetch-plugins.sh`.
4. Run `OJ_REALWORLD_PLUGINS=1 OJ_PLUGIN_IDS=your-id cargo test -p ojhost --features clap-host --test realworld -- --nocapture`.
5. Add a fingerprint only when repeated renders show the DSP is deterministic. Synths and randomized
   effects use the envelope policy instead of a brittle sample hash.

Default CI never downloads these binaries. The environment gate keeps ordinary test runs hermetic;
the nightly lane restores `.cache/oj-plugins`, verifies every artifact again, and runs the full matrix.

## Troubleshooting

- **Nothing appears after scanning:** confirm the desktop build includes `plugin-host-clap` or
  `plugin-host-juce`, and that the `.clap` file is under a standard CLAP directory or the directory
  selected in the Plugins panel.
- **Plugin is quarantined:** open its detail, preserve the reason for a bug report, then use **Try
  again** only after updating or replacing the binary.
- **Plugin is on the Bench:** repeated scan crashes caused the denylist. **Un-bench** opts back in;
  it does not make the plugin safe.
- **A track went silent mid-set:** look for an OutputGuard or auto-bypass Bench card. The host has
  isolated that instance's output to protect the master and released its held notes.
- **State does not return:** the plugin must implement its format's state extension. Include the
  plugin version, format, state hash, and scan report in an issue; do not attach proprietary presets.
- **Vendor GUI does not open on the CLAP-only build:** use the generic parameter surface, or a
  JUCE-enabled desktop build where supported. Embedded CLAP editors remain pending.

For timeline insertion, automation, persistence, and export, see [timeline.md](timeline.md).
