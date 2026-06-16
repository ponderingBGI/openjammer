---
title: Channels & versions
description: One version SSOT, two release channels.
sidebar:
  order: 1
---

## One version, everywhere

OpenJammer has **one** version string, written in lockstep across all four files
by [release-please](https://github.com/googleapis/release-please) (the single
version brain):

- `Cargo.toml` (`[workspace.package].version` — the canonical seed)
- `package.json`
- `src-tauri/tauri.conf.json`
- `packages/oj-protocol-ts/package.json`

A consistency check (`oj doctor --check version-sync`) asserts the four agree;
`release-please` owns the bump, so they never drift by hand. The app reads this
version at build time (the `__APP_VERSION__` define), so the About panel and the
issue reporter always show the real shipped version.

## Two channels

Exactly two release channels, defined once:

| Channel | Tag | Audience |
|---|---|---|
| **stable** | a `v*` tag **without** a `-` (e.g. `v0.2.0`) | everyone |
| **canary** | a single force-moved `canary` prerelease tag | early adopters |

The canonical "is this a prerelease?" test is `contains(ref_name, '-')`. The same
two identifiers drive the release workflow, the updater endpoints, the canary
build, and the `VITE_OJ_CANARY` build flag the UI reads to enable dev/canary-only
surfaces (like the DevLog panel).

:::caution[Owner-gated]
Signed installers + auto-update delivery are gated on owner-provisioned
credentials (a code-signing identity, split stable/canary signing keys) and a
header-capable PWA host. Until then: macOS ships a manual `.dmg`, and the browser
build runs without the SharedArrayBuffer fast path unless served with COOP/COEP.
:::
