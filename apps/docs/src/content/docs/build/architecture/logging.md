---
title: Logging & observability
description: Log everything, on-device, with smart search — and one-click issue reports.
sidebar:
  order: 2
---

The logging philosophy is simple: **log everything, keep it on the device, and
make it searchable** — nothing is shipped to a server. When something goes wrong,
the full picture is already captured locally, and a single click turns it into a
GitHub issue with the relevant logs attached (redacted).

The pipeline is layered so the real-time path stays untouched while the off-thread
side gets rich, structured, searchable logs.

## L1 — the off-RT `tracing` sink

A `tracing` subscriber (native, `std`-only) fans every structured record to a
human-readable stderr stream **and** a non-blocking, daily-rolling NDJSON file
under the platform log dir (`%APPDATA%`/`~/Library/Application Support`/`$XDG`).
One JSON object per line — greppable, on-device, never uploaded. `tracing` is
strictly off the audio thread (see [Real-time safety](/openjammer/build/architecture/real-time-safety/)).

## L2 — one event schema across the seam

A single versioned `EventKind` taxonomy lives in `ojproto` (mirrored to
TypeScript, parity-gated). Its RT-safe `Copy` subset, `RtEvent`, is encoded by a
fixed-size byte codec (`event_frame`) onto a wait-free `ByteRing` from the audio
thread. The schema is the same whether an event originates natively or in the
browser worklet — no second vocabulary.

## L3 — drain & dispatch

A dedicated, default-priority **drain thread** (never RT-promoted) is the sole
consumer of the event ring. It pops each compact `RtEvent` at ~1 ms cadence,
lifts it into a full `Event` envelope (sequence, severity, source, timestamp),
projects it into the L1 `tracing` sink, and buffers it for the UI. This decouples
capture (immediate, native) from display (the UI polls when it wants).

## L4 — the in-app DevLog

A searchable in-app panel (Ctrl/Cmd+Shift+L) tails a bounded ring of recent
entries with live level/scope facets, full-text filtering, and click-to-correlate.
Both engine events and the app's own logs flow here: a `log` facade
(`src/utils/log.ts`) routes every `console.*` call site through the same store, so
*all* app logging is structured and searchable in one place — enforced by a
`no-console` lint rule so raw `console.*` can't silently bypass it.

## L5 — one-click issue reporter

A "Report a problem" action gathers a **fail-closed** diagnostic snapshot
(version, channel, executor, cross-origin isolation, platform — an allowlist, so
nothing sensitive leaks by construction) plus a tail of the DevLog, renders a
**redacted** markdown report, and opens a pre-filled GitHub issue. A dedicated
redactor scrubs secrets, API keys, home-directory paths, and LAN addresses before
anything leaves the app — and the user sees the exact body in a preview before
sending. Secret-leak regressions are caught by a maintained secret-corpus test.
