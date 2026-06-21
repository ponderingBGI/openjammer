---
title: Loopback latency runbook
description: The per-backend manual check that OpenJammer's low-latency round trip still holds on real hardware.
sidebar:
  order: 4
---

OpenJammer's defining native constraint is a **low-latency** input→output round
trip. The engine asks the device for a small **64-frame buffer (~1.3 ms)** — that
figure is the buffer/scheduling *floor*, reachable on a capable device. How low the
real round trip actually lands is **device-dependent**: many devices grant the small
buffer **even on the default Windows WASAPI-shared path** (we measured ~1.3 ms,
`Fixed(64)` @ 48 kHz, on a Windows test machine — genuinely sub-5 ms), while some
devices or drivers reject it and fall back to a larger device period (~10 ms+). A
**WASAPI-exclusive / ASIO / Core Audio** backend guarantees the low buffer on any
device. We never advertise one fixed figure we can't keep on every device. No
automated test can measure true acoustic/driver latency on a CI runner without an
audio device, so this is a **manual release-gate checklist**: run it per backend
before tagging a stable release.

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

1. Select the backend and the smallest stable buffer your device allows. The engine
   requests a 64-frame buffer; confirm what it actually negotiated from the stream
   log line (e.g. `ojcore: audio stream negotiated: 2 ch @ 48000 Hz, buffer
   Fixed(64)`). A capable device on WASAPI-shared may grant `Fixed(64)`; otherwise
   it falls back to the device period, or you can force the small buffer with a
   WASAPI-exclusive / CoreAudio / ALSA / JACK backend.
2. Arm input and output on the loopback path and play an impulse (a single click)
   from the engine.
3. Capture the returned impulse and read the sample offset between emit and
   capture. Round-trip latency = `offset / sample_rate`.
4. Record the figure **and the negotiated buffer** in the release checklist.
   **Gate: on a backend that granted the small buffer, the measured round trip is
   ≤ 5 ms** (the `Fixed(64)` @ 48 kHz floor is ~1.3 ms). When the device forced a
   larger period, record the figure and note the buffer rather than failing the
   gate — that is a device limit, not a regression.

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
logs](/openjammer/build/architecture/logging/). A non-zero xrun count during the
measurement invalidates the run — fix the buffer/threading first, then re-measure.

:::note[Why there is no device-free automated version]
The input-capture seam is fully wired — `start_with_input_capture` records the
duplex input into a `Recorder` on the RT thread, and the
`loopback_capture_records_input` test exercises it end to end. That test is
`#[ignore]`d because it needs a real duplex device plus a physical (or software)
loopback cable, which a headless CI runner does not have — the same reason this
whole runbook is manual. So this manual runbook is the authoritative latency
gate. The xrun counter is the automated complement — observable on every run,
but not a latency measurement.
:::
