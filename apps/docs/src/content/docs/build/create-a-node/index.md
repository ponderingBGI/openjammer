---
title: Create a node
description: Author a new DSP node — one manifest, one DspInstance, the same shape as every built-in.
---

Every instrument, effect, and AI-authored DSP node in OpenJammer is a **plugin** behind
one contract: a `PluginManifest` plus one CLAP-shaped `DspInstance` trait. A built-in node
and a node written this morning are the same shape to the engine — so authoring your own
means satisfying that one contract, not patching the core.

The node-authoring guides live at the repository root (they evolve alongside the engine
crates, so they are linked here rather than copied — read them on GitHub for the version
that matches `main`):

- **[Creating nodes](https://github.com/ponderingBGI/openjammer/blob/main/docs/creating-nodes.md)**
  — the end-to-end walkthrough: declare the manifest, implement `DspInstance`, wire ports
  and parameters, and register the node so the picker can find it.
- **[Node standards](https://github.com/ponderingBGI/openjammer/blob/main/docs/node-standards.md)**
  — the conventions a node must follow: port types and colors (`audio` → blue,
  `technical` → grey), naming, parameter ranges, and the real-time-safety rules every node
  inherits from the core.
- **[Code-node ABI](https://github.com/ponderingBGI/openjammer/blob/main/docs/code-node-abi.md)**
  — the application binary interface for Faust / code nodes: how author-supplied DSP source
  is compiled and run on the real-time kernel (native and wasm), and what the host guarantees
  it across the seam.

## Before you author

A node is real-time code: it runs while audio is flowing, so it **never allocates, locks,
or blocks** on the audio thread — the same guarantee the core proves for itself. Read
[Real-time safety](/openjammer/build/architecture/real-time-safety/) first; it is the
contract your `process` block lives under.

A node others cannot safely author is not finished — docs are part of the feature. When you
add a node type, document its ports, its parameters, and the sound it makes.
