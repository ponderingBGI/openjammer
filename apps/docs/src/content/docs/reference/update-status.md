---
title: Update-status matrix
description: How each platform gets updates — and which paths are owner-gated today.
sidebar:
  order: 3
---

OpenJammer ships as a native desktop app (Tauri) and as a browser PWA. Auto-update
behaves differently per platform, and some paths are intentionally **gated off**
until owner-provisioned credentials exist — a wrong auto-update is worse than a
manual one.

## Native desktop (Tauri v2 updater)

The native updater downloads a release asset and verifies a **minisign**
signature over its bytes against a public key compiled into the running binary
before installing. See the [signing root-of-trust runbook](https://github.com/ponderingBGI/openjammer/blob/main/KEY-MANAGEMENT.md).

| Platform | Auto-update | Why |
|---|---|---|
| **Windows** | ✅ Enabled | Installs the signed `.msi`/NSIS update. Until an Authenticode identity is provisioned, first-run may show a SmartScreen "unknown publisher" prompt — a one-time OS trust step, separate from minisign payload signing. |
| **macOS** | ⛔ Gated **off** → manual `.dmg` | Gatekeeper quarantines a swapped `.app` without **notarization** (Apple Developer ID). The updater is `cfg`-gated off on macOS and users are pointed at the manual `.dmg` until that identity is acquired. A green minisign check does nothing for Gatekeeper. |
| **Linux** | ✅ Enabled **only** under AppImage | Gated on the `APPIMAGE` env var so `.deb`/`.rpm` users are never prompted for an in-place swap that fights their package manager. |

The updater's install step is a locked-out `UpdatePending` **state**, not a
one-shot check: it refuses to re-arm the audio transport, treats any LAN peer as
blocking, and waits for full audio-device release before applying — so an update
can never yank the `AudioContext` out from under a live set.

## Browser PWA

A prompt-style, channel-aware Workbox service worker checks for a new build and
**asks** before applying, then applies **on idle** — never mid-session, so it
can't interrupt audio. There are no signing keys in the browser path; the host's
TLS + the immutable build hash are the integrity story.

## Channel behaviour

Both the native updater feed and the PWA service worker are channel-aware (see
[Channels & versions](/openjammer/reference/channels-and-versions/)). The canary
feed points at an **immutable per-build tag**, never a moving `/latest/`, so a
client polling mid-rebuild never sees a 404 or a signature mismatch.

:::caution[Owner-gated prerequisites]
macOS auto-update (Apple Developer ID + notarization), Windows SmartScreen
removal (Authenticode / an OV identity), the split stable/canary signing keys,
and a header-capable PWA host are owner-provisioned. The release workflows are
wired to consume those secrets the moment they exist — no code change is needed,
only repository secrets and a host config.
:::
