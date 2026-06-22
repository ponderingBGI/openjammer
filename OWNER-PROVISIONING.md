# Owner provisioning checklist

Everything in the foundations program that **code and CI cannot do for you** —
because it needs a GitHub repo-admin toggle, a paid account, or a secret only the
owner can hold. Each item below is wired in the repository already; this is the
list of switches to flip to light them up. Nothing here blocks development or a
green CI — these gate **release delivery, deployment, and governance enforcement**.

Legend: 🔴 required before first signed release · 🟡 recommended · 🟢 optional.

---

## 1. 🟡 Branch model + protection on `canari` + `main` (governance)

`canari` is the default/integration branch (all feature PRs target it, and it
feeds the canari channel); `main` is the stable branch, advanced only by promoting
`canari` → `main`. Set this up, then bind the single required check — the aggregate
**`Merge gate`** job — to both branches:

1. **Create `canari` from `main`** and make it the default:
   ```sh
   git push origin main:canari
   gh repo edit ponderingBGI/openjammer --default-branch canari
   ```
   Do this only after the release workflow is merged, so automatic releases only
   happen from `main`.
2. **Ruleset on `canari`** (Settings → Rules → Rulesets → New branch ruleset):
   target `canari`; **enforcement: Active**; **Require a pull request before
   merging** (≥1 review); **Require status checks to pass** → add the check named
   exactly **`Merge gate`**.
3. **Ruleset on `main`**: target `main`; **enforcement: Active**; **Require a pull
   request before merging**; require **`Merge gate`**; under repo merge settings
   restrict `main` to **merge commits only**. Only the `canari → main`
   promotion PR and release automation commits land on `main`.
   > ⚠️ Do **not** rename the `gate` job in `.github/workflows/ci.yml` — branch
   > protection binds the literal string `Merge gate` (foundation F6).
4. **Retire `dev`**: delete the branch (`git push origin --delete dev`) and the
   stale `refs/heads/"dev"` ruleset — its role is now `canari`.
5. **Retarget open PRs** from `main`/`dev` onto `canari` (`gh pr edit <n> --base
   canari`); dependabot retargets itself to the new default on its next run.

Optional hardening: a CI assertion that enforcement on `canari`/`main` stays
`active` can be added once the rulesets are live (so a future edit can't silently
disable the gate).

---

## 2. 🟡 GitHub Pages (docs site deploy)

The docs build (`.github/workflows/docs.yml`) build-verifies on every PR already;
only the deploy job needs Pages on:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the **Docs** workflow via *Run workflow*) — the
   `deploy` job publishes `apps/docs/dist` to `https://<owner>.github.io/openjammer/`.

> The PWA app itself is **not** hosted on Pages — see §5 (Pages can't emit the
> COOP/COEP headers the browser engine needs).

---

## 3. 🔴 Release token + update-signing keys

The native auto-updater verifies a minisign signature over each downloaded
installer against a pubkey compiled into the app. Full ceremony, backup, and
rotation policy: [`KEY-MANAGEMENT.md`](KEY-MANAGEMENT.md). In short:

1. Add an automation token as repository secret `OJ_RELEASE_TOKEN`. Use a
   fine-grained PAT or GitHub App token scoped to this repo with **Contents:
   read/write** and **Pull requests: read/write**. The workflows fall back to
   `GITHUB_TOKEN`, but this token avoids recursive-workflow and protected-branch
   edge cases when release automation creates version commits, tags, and sync PRs.
2. Generate **two** keypairs (offline, backed up twice):
   ```sh
   bunx tauri signer generate -w openjammer-stable.key
   bunx tauri signer generate -w openjammer-canary.key
   ```
   (The `.gitignore` already blocks `*.key`/`*.minisign`/`.tauri/`, and a required
   CI credential-scan fails the build if one is ever staged.)
3. Add the private keys as **repository secrets** (Settings → Secrets and
   variables → Actions):
   | Secret | Channel | Used by |
   |---|---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | stable | `release.yml` (tag-scoped only) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | stable | `release.yml` |
   | `TAURI_SIGNING_PRIVATE_KEY_CANARY` | canari | `canary.yml` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD_CANARY` | canari | `canary.yml` |
4. Paste the **public** keys (public = safe to commit; channel is chosen at
   RUNTIME, so the client embeds BOTH and verifies against the active channel's):
   - **Stable** pubkey → `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
     (it ships empty).
   - **Canari** pubkey → `src-tauri/src/updater.rs` → the `CANARY_UPDATER_PUBKEY`
     constant (the canari channel fails closed until filled).

   No build-time pubkey injection and no `OJ_UPDATER_PUBKEY_*` variables — the
   release workflows' `jq` step only flips `bundle.createUpdaterArtifacts` on (it
   ships **off** so key-less builds — `build-installers.yml`, local `tauri build` —
   keep working) and `canary.yml` additionally stamps the numbered canari version.
   Stable uses `releases/latest/download/latest.json`; canari resolves the newest
   numbered prerelease (`vX.Y.Z-canari.N`) from the GitHub releases API.

> The native updater is **Win + Linux only** (macOS is compiled-off until §4), and
> the canari channel additionally requires `CANARY_RELEASES_ENABLED=true` (a repo
> variable). Pin-first-provision-later is intentional.

---

## 4. 🟡 macOS code-signing + notarization (Apple Developer ID)

The macOS auto-updater is **wired and ready** — the code, the audio-safe
`UpdateGate`, the updater commands, and the Settings UI are all in place. It
activates behind the `apple-notarized` Cargo feature on `oj-tauri`
(`src-tauri/src/updater.rs` / `Cargo.toml`). It is OFF by default because a
non-notarized self-updater would be Gatekeeper-quarantined, so a default macOS
build ships a manual `.dmg`. Activation is **provisioning + a build flag — no new
code**:

1. **Apple Developer Program** — enrolled (paid). ✅
2. **Create a Developer ID Application certificate** (Apple Developer →
   Certificates), export it as a `.p12`, and base64-encode it:
   `openssl base64 -in cert.p12 -out cert-b64.txt`.
3. **Add the repo secrets** Tauri's bundler reads (it signs + notarizes
   automatically when they are present):
   - `APPLE_CERTIFICATE` — base64 of the Developer ID Application `.p12`
   - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password
   - `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Name (TEAMID)`
   - notarization, EITHER an App Store Connect API key (recommended for CI):
     `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` — OR an Apple ID:
     `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
4. **Wire CI once** (`release.yml` + `canary.yml`): forward the `APPLE_*` secrets
   into the `tauri-action` `env:` (it skips signing when they are empty, so this
   is safe to add ahead of time), and append `--features apple-notarized` to the
   macOS matrix entries' build `args` when the secrets are present. That flag
   flips `native_update_capability()` to `can_auto_update = true` on macOS and
   registers the updater plugin there.
5. Verify on a **canary** release first (signing/notarization only runs on a real
   Mac/CI runner), then drop this section's 🟡.

---

## 5. 🔴 Header-capable PWA host (cross-origin isolation)

The browser engine's SharedArrayBuffer fast path needs `crossOriginIsolated ===
true`, which requires COOP/COEP response headers in production. **GitHub Pages
cannot set them.** Pick a header-capable host:

- **Netlify / Cloudflare Pages** — the committed [`public/_headers`](public/_headers)
  already emits both headers; just point the host at the repo.
- **Vercel** — add an equivalent `vercel.json` `headers` block (the `_headers`
  file is ignored there).

Then wire the deploy into `canary.yml` (the stable-channel deploy follows the
same pattern). Verify with the post-deploy synthetic header check.

Tracked as Open Question #4.

---

## 6. 🟢 Windows Authenticode (SmartScreen)

Independent of minisign (which signs the *update payload*, not the OS install).
Without an Authenticode / OV identity (e.g. SignPath Foundation for OSS), first
run shows a one-time SmartScreen "unknown publisher" prompt. Acquire the identity
and add it to the Windows leg of `build-installers.yml` to remove the prompt.

---

## 7. 🟢 Org migration + merge queue

GitHub's merge queue is org-only. The `merge_group:` trigger is already wired in
`ci.yml` (no event fires until a queue exists). After migrating the repo to an
org, enabling the queue is a one-line ruleset flip — the `Merge gate` evaluates
identically under `merge_group`. Tracked as Open Question #2.

---

## 8. 🟢 Claude automation secret (optional)

The `claude-*.yml` workflows (now fenced to read/suggest-only, gated to
OWNER/MEMBER/COLLABORATOR) need `ANTHROPIC_API_KEY` as a repo secret to run. Leave
unset to disable the bots entirely.

---

## 9. 🔴 VST2 SDK input for public VST2-enabled installers

VST2 is discontinued by Steinberg. OpenJammer source and CI must **not vendor,
mirror, or auto-download** VST2 headers. Full VST2 support in public binaries is
allowed only when the owner provides a legally obtained SDK/header checkout to the
release builders.

Provisioning contract for the VST2-enabled JUCE host:

1. Keep the VST2 SDK/header checkout outside the repository.
2. Local builds opt in with:
   ```sh
   OJHOST_ENABLE_VST2=1 VST2_SDK_DIR=/path/to/vst2-sdk bun run tauri build
   ```
3. GitHub release/canari builders must receive the SDK through a private owner
   mechanism (for example an encrypted artifact restored into the workspace) and
   export the same two variables. Do not print, cache, or upload the SDK.
4. If the SDK is not provisioned, the app must still build with VST3/CLAP/AU and
   surface VST2 as unavailable rather than pretending it is supported.

This is a hard release gate for the user's requested “full VST2 support”.

---

## Quick reference: what's already done vs. what you flip

| Concern | In-repo (done) | Owner action (this doc) |
|---|---|---|
| Required merge check | `Merge gate` job + self-test | Bind it in a ruleset (§1) |
| Versioning | patch-only stable releases + numbered canari prereleases | `OJ_RELEASE_TOKEN` recommended |
| Release path security | SHA-pinned + zizmor + credential-scan | — (auto) |
| Docs site | built + Pages workflow | Turn Pages on (§2) |
| Update signing | release/canari workflows wired | Provision keys (§3) |
| macOS update | updater code present | Apple Developer ID (§4) |
| Browser COOP/COEP | `public/_headers` committed | Pick a host (§5) |
| Merge queue | `merge_group:` wired | Migrate to org (§7) |
