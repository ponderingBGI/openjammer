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

## Branch model

Two branches map onto the two channels:

| Branch | Role | Feeds |
|---|---|---|
| **`canari`** | default / integration — every feature PR targets it | the **canary** channel (each push builds + publishes the rolling `canary` prerelease) |
| **`main`** | stable / release | the **stable** channel (the `release-please` PR tags `v*` → installers) |

A new version is minted by **promoting `canari` → `main`** with a **merge commit**
(not a squash), so `release-please` — pinned to `target-branch: main` because the
repo default is `canari` — sees every conventional commit and computes the right
bump. Feature PRs into `canari` may squash freely (one clean commit each).

### Canary versioning

Each canary build is stamped (in `canary.yml`) with a **monotonic prerelease**
version: `<base>.canary.<run>` (or `<base>-canary.<run>` when `<base>` has no
prerelease), where `<run>` is the CI run number. Semver precedence then makes a
later canary supersede an earlier one, **and** a future stable supersede the
canary — which is exactly what makes the channel switch *upstream-only*.

## Native auto-update (desktop)

On Windows + Linux the desktop app keeps itself current the way Ableton Live does:
with auto-update on (the default), a new build on your channel downloads silently
in the background and **installs when you quit** — no mid-session prompts, no
"Update now" button anywhere (the Live Performance Rule). An install is gated
through the audio-safe `UpdateGate`, so the binary is never swapped while audio is
live. The only explicit surface is **Settings → Updates**: the channel selector,
the auto-update toggle, and — right after you switch channels — the available
build with an "Update & restart now".

The **channel is chosen at runtime**, so the client embeds both pubkeys (stable in
`tauri.conf.json`, canary in `updater.rs`) and verifies against the active
channel's key. Switching is **upstream-only**: Canary → Stable never downgrades —
you stay on your build until Stable reaches it. macOS auto-update is compiled-off
until notarization (manual `.dmg`); Linux auto-update covers the **AppImage** (the
`.deb` updates via your package manager).

:::caution[Owner-gated]
Signed installers + auto-update delivery are gated on owner-provisioned
credentials (a code-signing identity, split stable/canary signing keys) and a
header-capable PWA host. Until then: macOS ships a manual `.dmg`, and the browser
build runs without the SharedArrayBuffer fast path unless served with COOP/COEP.
:::
