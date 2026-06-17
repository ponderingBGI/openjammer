---
title: Troubleshooting with the AI
description: The Ctrl+K assistant can read your logs and settings and fix your setup — reversibly.
sidebar:
  order: 2
---

When something breaks mid-session — no sound, crackle, a node that won't connect —
you shouldn't have to leave the stage to debug it. OpenJammer's AI assistant
(behind **Ctrl/Cmd+K**) can **see what the app is doing** and **change the knobs**,
so "there's no sound" becomes a question it answers from evidence and then fixes.

## What the assistant can see and do

On top of building and editing the node graph, the assistant has a
diagnostics-and-settings tool surface (documented in full in
[`docs/agent-tools.md`](https://github.com/PonderingBGI/openjammer/blob/main/docs/agent-tools.md)):

| Tool | What it does |
| --- | --- |
| `get_logs` | Tails the on-device DevLog — engine xruns, node faults, MIDI, asset/plugin events, and every captured `console.*` line. Filterable by level / scope / text. |
| `get_diagnostics` | Reads the environment + live audio: app version/channel, whether the AudioContext is running, the measured round-trip latency, sample rate, the selected output device, and cross-origin isolation. |
| `get_settings` | Reads the settings it may change: audio sample rate, latency hint, low-latency mode, input/output device, theme, default velocity. |
| `update_settings` | Changes those settings through the **same store verbs the Settings panel uses** — for example, select your USB interface or switch to the interactive latency hint. |

The reads are side-effect-free. `update_settings` is **reversible**: it goes
through the ordinary settings store and exposes an undo, so anything the
assistant changes you can take back with Ctrl+Z (or by rejecting the turn). The
assistant can never reach past what you could do by clicking around the Settings
panel yourself — that boundary is the design, not a modal.

## A worked "get my sound back" loop

Tell the assistant *"I hear nothing"* and it can work the problem the way you
would, but instantly:

1. **`get_diagnostics`** — is the AudioContext even running? Is a USB interface
   selected? Is the round-trip latency sane?
2. **`get_logs`** with `{ "levels": ["Warn", "Error"] }` — surface xruns, node
   faults, or an empty sampler.
3. Then either **`update_settings`** to repair the obvious cause (e.g. select the
   interface, or `{ "patch": { "lowLatencyMode": true } }`), or **`find_nodes` +
   `emit_plan`** to wire the missing path from your instrument to a speaker.

Every step is visible in the chat and undoable.

## Where this lives

- The logs the assistant reads are the same ones the **DevLog** panel shows
  (Ctrl/Cmd+Shift+L). Every `console.*` line in the app is captured into that
  ring at startup, so the panel and the assistant share one source of truth.
- The assistant is native/desktop-first (it spawns a sandboxed coding agent). In
  a plain browser the AI path reports itself unavailable, but the DevLog and the
  one-click [issue reporter](/openjammer/build/architecture/logging/) still work for manual
  diagnosis.

## Privacy

The diagnostics snapshot the assistant reads is a fail-closed **allowlist** of
known-safe facts (version, platform, audio state). It never reads device labels
into a report, LAN peers, file paths, or your prompts. The one-click issue
reporter additionally redacts secrets, home-directory paths, and LAN addresses
before anything leaves the device, and shows you the full text first.
