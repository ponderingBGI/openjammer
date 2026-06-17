---
title: Real-time safety
description: The audio thread never allocates, locks, or blocks — and CI proves it.
sidebar:
  order: 1
---

OpenJammer's defining constraint is **hard real-time audio**: the audio callback
runs on a tiny buffer (64 frames at 48 kHz ≈ 1.3 ms) and must finish every block
on time. A single heap allocation, mutex, or syscall on that thread can miss the
deadline and produce an audible glitch (an *xrun*). So the rule is absolute:

> **The audio thread never allocates, never locks, never blocks.**

## How it is enforced

This is not a convention you have to remember — it is checked mechanically.

- **`assert_no_alloc`** — the engine's RT tests run the render loop inside a
  global allocator guard that *aborts* on any heap touch. A dedicated CI step
  (`cargo test -p ojcore --features devlog`) trips the real fault paths inside
  that guard, so a regression that allocates on the audio thread fails the build.
- **`no_std` core** — `ojcore` / `ojcore-dsp` build with `--no-default-features`
  (no `std`), so whole classes of blocking APIs simply are not in scope on the
  engine path. The same code compiles to `wasm32` for the browser worklet.
- **No `tracing` on the audio thread** — structured logging is an *off*-thread
  concern (see [Logging & observability](/openjammer/build/architecture/logging/)). The
  engine core has no logging dependency at all, so a log call on the audio thread
  cannot even compile there.

## Talking to the audio thread

Because the audio thread can't lock, all communication with it is **wait-free**:

- **UI → RT** commands (note on/off, parameter changes, transport) ride a
  wait-free SPSC command ring; the callback drains it at the top of each block.
- **RT → control** results (level meters, and fault *events*) ride dedicated
  wait-free `ByteRing`s. The producer encodes a small fixed record onto a stack
  buffer and does a single non-blocking push; on a full ring it drops-and-counts
  rather than waiting.
- **Graph hot-swap** publishes a freshly-compiled program into a lock-free
  mailbox the callback adopts between blocks — no edit ever stalls audio.

Faults detected on the audio thread (a non-finite sample, an over-budget node, an
auto-bypass) are emitted as compact `RtEvent`s onto the event ring and lifted
off-thread into full structured events — again, see
[Logging & observability](/openjammer/build/architecture/logging/).

## Floating-point reproducibility

The native and browser engines run the *same* DSP, so their output must match
within a tight tolerance. DSP math uses `libm` (not `std` float intrinsics) for
determinism across targets, and the device-free **golden render** tests assert
correctness (clean pitch, exact gain, expected filter response) within tolerance
bands — run per-PR on Linux, Windows, **and macOS/aarch64**, so a per-arch
floating-point drift surfaces immediately rather than in a release build.
