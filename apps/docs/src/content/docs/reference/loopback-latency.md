---
title: Loopback latency runbook
description: The per-backend manual check that OpenJammer's <5 ms round-trip still holds.
sidebar:
  order: 4
---

OpenJammer's defining native constraint is a **sub-5-millisecond** input→output
round trip. No automated test can measure true acoustic/driver latency on a CI
runner without an audio device, so this is a **manual release-gate checklist**:
run it per backend before tagging a stable release.

:::note[Why this is manual]
End-to-end latency includes the OS audio stack and the device buffer, which a
headless CI runner does not have. The device-free `render` gate proves the engine
produces correct audio every PR; this runbook proves the *live* path is still
fast on real hardware.
:::

## What you need

- A physical or virtual **loopback** from output back into input (a TRS patch
  cable out→in, or an OS loopback device such as BlackHole / VB-CABLE).
- A build of the native app for the backend under test.

## The measurement

1. Select the backend and the smallest stable buffer your device allows
   (WASAPI exclusive / CoreAudio / ALSA / JACK).
2. Arm input and output on the loopback path and play an impulse (a single click)
   from the engine.
3. Capture the returned impulse and read the sample offset between emit and
   capture. Round-trip latency = `offset / sample_rate`.
4. Record the figure in the release checklist. **Gate: the measured round trip is
   ≤ 5 ms** at the target buffer size for that backend.

| Backend | OS | Typical low-latency buffer |
|---|---|---|
| WASAPI (exclusive) | Windows | 64–128 frames |
| CoreAudio | macOS | 64–128 frames |
| ALSA | Linux | 64–128 frames |
| JACK | Linux (pro audio) | server-configured |

## Observability: the xrun counter

Glitches (buffer under/overruns) are surfaced through the **L2 `EventKind`**
log channel as an xrun counter, so even without the manual loopback you can see
whether a session stayed glitch-free in the [DevLog and on-device
logs](/openjammer/architecture/logging/). A non-zero xrun count during the
measurement invalidates the run — fix the buffer/threading first, then re-measure.

:::caution[Current state]
The in-engine input capture used for an *automated* loopback assertion is not yet
wired (the loopback test is `#[ignore]`d and the input-recorder sink is a stub),
so this manual runbook is the authoritative latency gate until that lands. The
xrun counter is the automated complement — observable, but not a latency
measurement.
:::
