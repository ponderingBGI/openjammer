---
title: Channels & versions
description: One version SSOT, two release channels.
sidebar:
  order: 1
---

## One version, everywhere

OpenJammer has **one** version string, written in lockstep across all four files
by the OpenJammer release workflow:

- `Cargo.toml` (`[workspace.package].version` — the canonical seed)
- `package.json`
- `src-tauri/tauri.conf.json`
- `packages/oj-protocol-ts/package.json`

A consistency check (`oj doctor --check version-sync`) asserts the four agree;
the release script owns the bump, so they never drift by hand. The app reads
this version at build time (the `__APP_VERSION__` define), so the About panel
and the issue reporter always show the real shipped version.

## Two channels

Exactly two release channels, defined once:

| Channel | Tag | Audience |
|---|---|---|
| **stable** | a `vX.Y.Z` tag without a prerelease suffix (e.g. `v0.0.1`) | everyone |
| **canari** | numbered prerelease tags such as `v0.0.1-canari.1` | early adopters |

Stable releases start at `v0.0.1`. Each automatic `canari -> main` promotion
increments the patch number only: `v0.0.1`, `v0.0.2`, `v0.0.3`. When the project
is ready for a new minor line, the maintainer runs the promotion workflow with
an exact target such as `0.1.0`; automatic releases then continue as `0.1.1`,
`0.1.2`, and so on.

## Branch model

Two branches map onto the two channels:

| Branch | Role | Feeds |
|---|---|---|
| **`canari`** | default / integration — every feature PR targets it | the **canari** channel (numbered prereleases) |
| **`main`** | stable / release | the **stable** channel |

A new version is minted by **promoting `canari` → `main`** with a **merge commit**
(not a squash). The standing promotion PR title is the stable version that will
publish after merge, for example `Release v0.0.2 (canari -> main)`. Feature PRs
into `canari` may squash freely (one clean commit each).

### Canari versioning

Each canari build is stamped (in `canary.yml`) with a numbered prerelease:
`<next-stable>-canari.<n>`. If the next stable promotion will publish `v0.0.2`,
canari builds are `v0.0.2-canari.1`, `v0.0.2-canari.2`, and so on. That makes it
easy to find an older canari build by the stable line it was previewing, while
SemVer still makes the final `v0.0.2` supersede every `v0.0.2-canari.N` build.

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
`tauri.conf.json`, canari in `updater.rs`) and verifies against the active
channel's key. Stable uses GitHub's latest full release; canari resolves the
newest numbered `vX.Y.Z-canari.N` prerelease and downloads that release's
`latest.json`. Switching is **upstream-only**: Canari → Stable never downgrades
— you stay on your build until Stable reaches it. macOS auto-update is ready and
activates once the build is notarized (manual `.dmg` until then); Linux
auto-update covers the **AppImage** (the `.deb` updates via your package manager).

:::caution[Owner-gated]
Signed installers + auto-update delivery are gated on owner-provisioned
credentials (a code-signing identity, split stable/canary signing keys) and a
header-capable PWA host. Until then: macOS ships a manual `.dmg`, and the browser
build runs without the SharedArrayBuffer fast path unless served with COOP/COEP.
:::
