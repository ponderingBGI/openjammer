# Roadmap — remaining foundations work

The foundations program (Phases 0–6) is largely landed and CI-green: one version
SSOT, the pinned toolchain, the fenced/SHA-pinned release path, the credential +
`zizmor` gates, the aggregate **Merge gate** with an adversarial self-test, the
`EventKind`/`event_frame`/`drain_frames` event spine with the `assert_no_alloc`
gate, the L1 tracing sink + L4 DevLog + console facade, the D1 schema SSOT, the
Starlight docs hub (incl. generated TypeDoc API), and the L5 redacted one-click
issue reporter.

This file tracks what is **deliberately still ahead** — the larger engineering
workstreams and the owner-gated switches — so deleting the design plans doesn't
lose the thread. Owner-flippable switches live in
[`OWNER-PROVISIONING.md`](OWNER-PROVISIONING.md); this file is the *engineering*
backlog.

> Why these are staged, not done now: each needs either hardware/runtime this
> repo's CI can't exercise from a Windows-only, device-free dev box (real audio
> latency, a browser with COOP/COEP, a signing identity), or it is a refactor of
> already-green CI whose payoff is DRY/speed, not new capability — sequenced after
> the capabilities land. None of them block the green tree.

---

## CI control plane (Phase 1, C1)

- **Composite actions + reusable workflows.** Collapse the repeated
  checkout/Bun/toolchain/cache/apt blocks in `ci.yml` into `setup-rust` /
  `setup-web` composite actions and `engine.yml` / `web.yml` reusable workflows,
  so `release.yml` and `canary.yml` call the *same* build engine. Entry point:
  `.github/workflows/ci.yml` (the three near-duplicate native jobs).
- **Affected-selection (`changes`) + Lane A/Lane B split.** A selector job that
  reads `oj plan --json` to run only affected `just` recipes per PR (Lane A),
  with the heavy correctness suite on nightly+canary (Lane B). The `oj` CLI
  already implements affected-selection (`scripts/oj/preflight.ts`); this wires
  it into CI as the gate's `changes` need.

## Testing depth (Phase 4: T2/T3/T4/X2)

- **Golden corpus (ULP-banded, per-arch).** Device-free `render` goldens compared
  in a tight ULP band on linux-x64 / macos-aarch64 / macos-x64, plus a
  `wasm-pack test --node` parity subset per-PR. Policy is documented at
  `/reference/floating-point/`; the corpus + harness are the build-out.
- **libm-only enforcement.** The DSP crates already route every transcendental
  through `libm` (verified); add the clippy `disallowed-methods` guard (carefully
  scoped so non-DSP std math isn't caught) to keep it that way.
- **miri + fuzz (Lane B).** miri over existing tests; unbounded fuzz of the
  untrusted parse surface (SF2 via `rustysynth`, WAV via `symphonia`, graph JSON)
  with a per-PR smoke.
- **Playwright PWA smoke.** A blocking PWA + render-smoke suite with a mocked
  `__TAURI__`, asserting `crossOriginIsolated === true`, plus a post-deploy
  synthetic header check against the real host (production COOP/COEP).
- **Docs-as-requirement.** Rust `missing_docs` + `cargo doc -D warnings` with a
  committed permanently-failing-doc fixture as a standing negative test; the TS
  `doc-check` baseline-ratchet.

## Persistence + delivery (Phase 5: L3/R2/R3/R4)

- **L3 SQLite/FTS5 store (native-first).** Persist decoded events; columns mirror
  the `EventKind` taxonomy; an FTS5-availability smoke (`CREATE VIRTUAL TABLE …
  USING fts5` + a `MATCH` query) as a gated check. Consumes the L4 `logStore`
  shape already in `src/`.
- **R2 native updater.** Wire the Tauri v2 updater (compares
  `src-tauri/tauri.conf.json` version): `cfg`-off on macOS until notarization,
  Linux gated on `APPIMAGE`, install as a locked-out audio-safe `UpdatePending`
  state (no TOCTOU). Needs the signing keys (owner).
- **R3 PWA auto-update.** Prompt-style, channel-aware Workbox service worker
  (reads the canary build flag), apply-on-idle so it never yanks the
  `AudioContext`.
- **R4 signing + delivery.** Split stable/canary minisign keypairs; `canary.yml`
  (push-on-main, canary key only) reusing the build engine; a serialized
  `assemble-manifest` that unions the dual-arch macOS `latest.json`; a hard
  post-publish all-four-platform-keys gate; `attest-build-provenance` for
  auditors. Workflows wire to owner-provided secrets (see OWNER-PROVISIONING §3).
- **Loopback latency automation.** Wire `RecorderSink` into `build_input` so the
  `#[ignore]`d loopback test can run; until then the manual runbook at
  `/reference/loopback-latency/` is the gate, with the xrun counter as the
  observable complement.

---

*Design rationale for every item above lives in the project's git history (the
`docs/plans/` design set, removed from `HEAD` once implemented) and, for
user-facing topics, in the [documentation site](https://ponderingbgi.github.io/openjammer/).*
