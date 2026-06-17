---
title: Floating-point reproducibility
description: Why DSP output is compared in a ULP band, per-arch — not by bit-exact hash.
sidebar:
  order: 2
---

OpenJammer runs the **same Rust DSP** in two places: natively (via `cpal` —
WASAPI / CoreAudio / ALSA / JACK) and in the browser (compiled to `wasm32` and
run inside an AudioWorklet). The same graph must sound the same in both. But
"the same" for floating-point audio is a band, not an equality.

## The policy: tolerance bands, not bit-equality

Bit-exact output is **not** a stable contract across:

- **targets** — `wasm32` and native x86-64/aarch64 round and contract
  differently;
- **architectures** — aarch64 can fuse a multiply-add (FMA) that x86-64 emits as
  two rounded operations, so the last bit legitimately differs;
- **toolchain bumps** — `-Z build-std` + thin-LTO can re-associate arithmetic
  between two nightlies that are both "correct".

So the golden corpus compares each rendered buffer against its reference within a
**tight ULP (unit-in-the-last-place) band**, and asserts that band **per
architecture** rather than hashing bytes. A bump of the pinned nightly
(`rust-toolchain.toml`) is a deliberate **re-bless** of the goldens, never a
silent drift — that is the whole reason the wasm nightly is pinned to an exact
date.

## The guards

| Guard | What it prevents |
|---|---|
| Per-arch goldens (linux-x64, macos-aarch64, macos-x64) | An arch-specific rounding regression hiding behind another arch's pass. |
| FMA-contraction check (aarch64) | A fused multiply-add silently changing results versus the x86-64 reference. |
| `clippy` disallowed-methods (libm-only transcendentals) | `std`'s platform `sin`/`cos`/`exp` (which differ across libcs) leaking into DSP — the engine routes through `libm` for cross-platform determinism. |
| `target-cpu` / fast-math `RUSTFLAGS` discipline | `-ffast-math`-style reassociation or `target-cpu=native` making a build non-portable. |
| wasm parity subset (per-PR) | The browser float path drifting from native — the device-free `render` golden is replayed through `wasm32` and checked against the same per-arch band. |

## What "real-time safe" adds on top

The reproducibility policy is about **values**; the [real-time safety
invariant](/openjammer/architecture/real-time-safety/) is about **timing**. They
compose: the audio thread must produce the right numbers *and* never allocate,
lock, or block to do it. A non-finite sample (NaN/Inf) is both a correctness bug
and a fault event — it trips the engine's `non_finite` path and surfaces in the
log channel rather than being silently clamped away.

:::note[Enforcement status]
The policy above is the contract DSP changes are reviewed against. The per-arch
native legs and the device-free `render` gate run per-PR today; the full
ULP-banded golden corpus and the `wasm-pack` parity subset are the testing-depth
workstream still being ratcheted in — see the repository's CI for the current
set of required checks.
:::
