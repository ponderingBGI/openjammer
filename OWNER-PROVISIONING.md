# Owner provisioning checklist

Everything in the foundations program that **code and CI cannot do for you** —
because it needs a GitHub repo-admin toggle, a paid account, or a secret only the
owner can hold. Each item below is wired in the repository already; this is the
list of switches to flip to light them up. Nothing here blocks development or a
green CI — these gate **release delivery, deployment, and governance enforcement**.

Legend: 🔴 required before first signed release · 🟡 recommended · 🟢 optional.

---

## 1. 🟡 Branch protection on `main` (governance)

CI already exposes the single required check — the aggregate **`Merge gate`** job.
Bind it:

1. **Settings → Rules → Rulesets → New branch ruleset** (or edit the existing
   `main` ruleset, which currently has `enforcement: disabled`).
2. Target `main`; set **enforcement: Active**.
3. Enable **Require a pull request before merging**.
4. Enable **Require status checks to pass** and add the check named exactly
   **`Merge gate`**.
   > ⚠️ Do **not** rename the `gate` job in `.github/workflows/ci.yml` — branch
   > protection binds the literal string `Merge gate` (foundation F6).
5. Resolve the stale `dev` ruleset: it targets a malformed `refs/heads/"dev"` for
   a branch that doesn't exist — either create a real `dev` branch or delete the
   ruleset.

Optional hardening: a CI assertion that `main` enforcement stays `active` can be
added once the ruleset is live (so a future edit can't silently disable the gate).

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

## 3. 🔴 Update-signing keys (minisign — split stable/canary)

The native auto-updater verifies a minisign signature over each downloaded
installer against a pubkey compiled into the app. Full ceremony, backup, and
rotation policy: [`KEY-MANAGEMENT.md`](KEY-MANAGEMENT.md). In short:

1. Generate **two** keypairs (offline, backed up twice):
   ```sh
   bunx tauri signer generate -w openjammer-stable.key
   bunx tauri signer generate -w openjammer-canary.key
   ```
   (The `.gitignore` already blocks `*.key`/`*.minisign`/`.tauri/`, and a required
   CI credential-scan fails the build if one is ever staged.)
2. Add the private keys as **repository secrets** (Settings → Secrets and
   variables → Actions):
   | Secret | Channel | Used by |
   |---|---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | stable | `release.yml` (tag-scoped only) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | stable | `release.yml` |
   | `TAURI_SIGNING_PRIVATE_KEY_CANARY` | canary | `canary.yml` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD_CANARY` | canary | `canary.yml` |
3. Embed **both** public keys in `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey` (the app trusts stable + canary).

> The release path is already SHA-pinned and `zizmor`-audited (Phase 0 §0.5), and
> the stable key is scoped `if: startsWith(github.ref, 'refs/tags/v')` so it is
> never reachable from a PR/push job. Pin-first-provision-later is intentional.

---

## 4. 🔴 macOS code-signing + notarization (Apple Developer ID)

Without an Apple Developer ID + notarization, Gatekeeper quarantines a swapped
`.app`, so the macOS updater is `cfg`-gated **off** and Mac users get a manual
`.dmg`. To enable macOS auto-update:

1. Enrol in the **Apple Developer Program** (~$99/yr).
2. Add the signing identity + notarization credentials as repo secrets (Apple
   Team ID, Developer ID cert + password, an app-specific password / API key).
3. Flip the macOS updater from `cfg`-off to on.

Tracked as Open Question #3 (release-credentials funding).

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

## Quick reference: what's already done vs. what you flip

| Concern | In-repo (done) | Owner action (this doc) |
|---|---|---|
| Required merge check | `Merge gate` job + self-test | Bind it in a ruleset (§1) |
| Versioning | release-please + three-way gate | — (auto) |
| Release path security | SHA-pinned + zizmor + credential-scan | — (auto) |
| Docs site | built + Pages workflow | Turn Pages on (§2) |
| Update signing | release/canary workflows wired | Provision keys (§3) |
| macOS update | updater code present | Apple Developer ID (§4) |
| Browser COOP/COEP | `public/_headers` committed | Pick a host (§5) |
| Merge queue | `merge_group:` wired | Migrate to org (§7) |
