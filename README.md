<div align="center">

# OpenJammer

### Patch instruments and effects on a canvas, then play live.

**A node-driven instrument — not a web app, not a dashboard.** One real-time-safe Rust
core (`ojcore`) runs native on the desktop and compiled to WebAssembly in your browser.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0--alpha.2-orange.svg)](package.json)
[![Docs](https://img.shields.io/badge/docs-living%20reference-4A7C59.svg)](https://ponderingbgi.github.io/openjammer/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Get OpenJammer

|  ▶ Play now in your browser  |  ⬇ Download the desktop app  |  📖 Read the docs  |
|---|---|---|
| Zero install — open it and start. Honest browser tier, **~15–25 ms** latency. | The full instrument, native low latency: **< 5 ms** MIDI→audio, plus VST3 / AU / CLAP hosting. | A living reference: guides, the node catalog, audio setup, and the architecture. |
| **[→ openjammer.app](https://openjammer.app)** | **[→ Download](https://openjammer.app/download)** · [all builds on GitHub](https://github.com/ponderingBGI/openjammer/releases/latest) | **[→ ponderingbgi.github.io/openjammer](https://ponderingbgi.github.io/openjammer/)** |

> New here? **Play in the browser first** — it's the whole instrument with nothing to
> install. Reach for the desktop app when you want the lowest latency or to host your own
> VST3 / AU / CLAP plugins. OpenJammer is **0.1.0-alpha.2** — expect rough edges, and on
> first launch you may need to allow an unsigned app
> ([install notes](https://ponderingbgi.github.io/openjammer/play/install/)).

---

## What it is

OpenJammer is an **instrument**, and an instrument is judged by how it *feels*. Two
beliefs carry the whole project:

- **Perception is the medium.** A musician feels latency in their fingers and hears a
  glitch before they read a spec. So the audio thread never blocks, editing never drops a
  sample, and `< 5 ms` MIDI→audio (native) is the threshold below which the software
  disappears and only the music is left. The browser tier is an honest `~15–25 ms` — we
  never dress it up as sub-5 ms.
- **A minimal core, made infinite by everyone.** `ojcore` stays tiny and perfect; *every*
  instrument, effect, AI-authored DSP node, and hosted plugin is community territory
  behind one shared contract. When in doubt, it's a plugin — and every user makes it
  their own.

What you get:

- 🎹 **171 instruments out of the box** — distinct procedural voices (piano, strings,
  reed, bell, pluck…), zero sample downloads.
- 🤖 **A Ctrl/Cmd+K AI co-pilot** that builds graphs *and* reads your on-device logs +
  audio diagnostics to fix "there's no sound" — reversibly, undone with plain Ctrl+Z.
- 🩺 **Built for the stage** — an on-device DevLog and one-screen Audio-health readout; a
  panic-safe boundary keeps your audio playing if the UI ever glitches.
- 🎛️ **Bring your own sound** — samples, SoundFonts, Faust/code-node DSP, and your
  installed CLAP/VST3 plugins.
- 🔁 **Layer-based looping** — stack loops as layers, with per-layer mute/delete/effects.
- 📴 **Offline-capable PWA** — works after first visit, no external API calls.

For who plays this and why, see **[PRODUCT.md](PRODUCT.md)**; for the visual system, the
"Living Sketchbook," see **[DESIGN.md](DESIGN.md)**.

---

## Build from source (developers)

You only need this to hack on OpenJammer itself — players use the links above.

```bash
bun install   # bun only — one toolchain, one lockfile
bun dev        # Vite dev server, prints a localhost URL
```

Open the printed URL and click **Start OpenJammer**. First workflow: right-click the
canvas → add a Keyboard node and an Instrument (e.g. Classic Piano), connect them, and
play the Q–P row — or press **Ctrl/Cmd+K** and ask the AI to build it for you.

> OpenJammer uses **`bun`** for every package operation — never `npm`, `yarn`, or `pnpm`
> (one toolchain, one lockfile). See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## How it works — the core

OpenJammer is powered by **`ojcore`**: one minimal, real-time-safe **Rust** audio core
that compiles to **native** (low-latency `cpal`, with VST3/AU/CLAP plugin hosting via a
JUCE/CLAP host) **and** to **WebAssembly** (the zero-install AudioWorklet PWA), driven by
one shared **React 19 + TypeScript** control plane and selected by `OJ_EXECUTOR`. The
audio thread never allocates, locks, or blocks — a guarantee enforced mechanically in CI.

**Stack:** Bun · React 19 + TypeScript · Rust `ojcore` · Zustand · Tauri (desktop) ·
Vercel (static PWA). The crate map, build/run/test commands, and the cross-platform
release setup live in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Documentation

Full guides, the node catalog, audio setup, and the architecture live at the
**[OpenJammer docs](https://ponderingbgi.github.io/openjammer/)**:

- **[Play in 60 seconds](https://ponderingbgi.github.io/openjammer/play/first-patch/)** — build your first instrument.
- **[Audio setup & USB interfaces](https://ponderingbgi.github.io/openjammer/play/audio-and-latency/)** — interface picks, latency tuning, troubleshooting.
- **[Sound & instruments](https://ponderingbgi.github.io/openjammer/play/sound-and-instruments/)** — procedural voices, samples, SoundFonts, CLAP/VST3.
- **[Troubleshooting with the AI](https://ponderingbgi.github.io/openjammer/play/troubleshooting-with-the-ai/)** — let Ctrl/Cmd+K read your logs and fix your setup.
- **[Architecture & real-time safety](https://ponderingbgi.github.io/openjammer/build/architecture/real-time-safety/)** — how the audio thread never blocks.

---

## Contributing

We welcome contributions — new nodes, instruments, effects, and themes. See
**[CONTRIBUTING.md](CONTRIBUTING.md)** for development setup, code guidelines, the PR
process (open PRs against `canari`), and testing requirements. The contributor covenant —
the two beliefs, the code values, and the playbook — is in **[agents.md](agents.md)**.

---

## License

OpenJammer is licensed under the **[AGPL-3.0 License](LICENSE)**:

- ✅ Free to use, modify, and distribute.
- ✅ Open source, community-driven.
- ⚠️ If you run a modified version as a web service, you must share your source code.

---

<div align="center">

**Made with ❤️ for musicians who code and coders who make music**

[Report Bug](https://github.com/ponderingBGI/openjammer/issues) · [Request Feature](https://github.com/ponderingBGI/openjammer/issues) · [Discussions](https://github.com/ponderingBGI/openjammer/discussions)

</div>
