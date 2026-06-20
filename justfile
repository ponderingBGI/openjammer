# justfile — the ONE command surface. CI workflows AND lefthook both call these
# recipes; no merge-gating command is ever encoded twice. (Plan: docs/plans/07-reference-configs.md §5,
# docs/plans/01-testing-and-reliability.md §T1, docs/plans/00-overview.md §F1.)

# The maintainer's primary box is Windows 11 / PowerShell. Without this, `just`
# defaults to `sh` (absent on a fresh Windows dev box) and every recipe fails.
set windows-shell := ['powershell.exe', '-NoLogo', '-Command']

# OS-aware temp WAV for the device-free `render` gate. CI's windows-native job and
# the ubuntu engine job both render here; locals get an OS-correct scratch path.
# Prefer RUNNER_TEMP (CI), fall back to TEMP (local Windows shells), then a default.
# Evaluated by `just` (env_var_or_default), so it works in CI and on a local dev box.
wav := if os() == "windows" { env_var_or_default("RUNNER_TEMP", env_var_or_default("TEMP", "C:\\Windows\\Temp")) + "\\oj-render.wav" } else { "${RUNNER_TEMP:-/tmp}/oj-render.wav" }

# Default: list available recipes.
default:
    @just --list

# ── Static analysis ────────────────────────────────────────────────────────────
fmt:
    cargo fmt --all -- --check

clippy:
    cargo clippy --workspace --all-targets -- -D warnings

# ── Tests ────────────────────────────────────────────────────────────────────
# nextest gives process-per-test isolation — STRICTLY safer than `cargo test`'s
# shared process for the global-allocator swap `assert_no_alloc` installs.
test:
    cargo nextest run --workspace

# MANDATORY companion: nextest skips doctests, so run them explicitly.
doctest:
    cargo test --workspace --doc

# RT no-alloc gate (Phase 2: the `devlog` feature is added to ojcore in Phase 2).
# Trips over_budget / auto_bypass / non_finite (crates/ojcore/src/exec.rs) INSIDE
# assert_no_alloc with both the meter ring and the event ring attached. Wired as a
# `needs:` of the aggregate `gate` — a REQUIRED per-PR check, never nightly-only.
test-rt:
    cargo nextest run -p ojcore --features devlog

# ── Build legs ─────────────────────────────────────────────────────────────────
# `ojcore` defaults to ["std"]; --no-default-features compiles the no_std core
# the wasm32 AudioWorklet shares (Cargo.toml:12-13).
nostd:
    cargo build -p ojcore --no-default-features

# The ONLY ojcore-wasm compile path: the pinned nightly + -Z build-std. The date
# matches rust-toolchain.toml's documented wasm nightly so local and CI agree.
wasm:
    cargo +nightly-2026-06-01 build -p ojcore-wasm --target wasm32-unknown-unknown -Z build-std=std,panic_abort

# Device-free `render` gate: render an Osc->Biquad->Delay->Speaker arpeggio to a
# WAV and assert finite, non-silent, sane-RMS output — no audio device needed.
# `render` is required-features=["demo"] and takes <wav-path> <seconds>.
render:
    cargo clippy -p ojcore-native --features demo --all-targets -- -D warnings
    cargo run -p ojcore-native --bin render --features demo -- "{{wav}}" 2

# Real pure-Rust CLAP backend (clack, MIT). The default ojhost build is a
# dependency-free scaffold, so this leg is the only one that exercises real hosting.
clap-host:
    cargo clippy -p ojhost --features clap-host --all-targets -- -D warnings
    cargo test -p ojhost --features clap-host

# ── Web control plane ────────────────────────────────────────────────────────
# Mirrors the verified ci.yml `web` job: frozen install, typecheck, lint, test, build.
web:
    bun install --frozen-lockfile
    bunx tsc --noEmit -p tsconfig.app.json
    bun run lint
    bun run test:run
    bun run build

# ── Aggregates the CI lanes call (dependency form: run in listed order) ────────
# NOTE: `test-rt` is intentionally NOT in `rust` yet — it requires the ojcore
# `devlog` feature, a Phase-2 addition. Run it standalone (`just test-rt`) only
# after Phase 2 lands; it joins the per-PR gate then (docs/plans/02 + 00 §F3).
rust: fmt clippy test doctest nostd wasm render clap-host

ci: rust web

# ── Local fast-feedback entry point (Layer 2) ──────────────────────────────────
# Shells to the merged `oj` Bun CLI, which DECIDES which recipes to run
# (cache hits + affected-selection) — it never re-encodes a command.
preflight *ARGS:
    bun scripts/oj/index.ts preflight {{ARGS}}

# ── Native dev loops ───────────────────────────────────────────────────────────
# The one-command native loop: Vite HMR + the ojcore-native engine in one
# terminal, unified logs, clean Ctrl+C. `oj dev` delegates lifecycle + teardown
# to the Tauri CLI (the edge we don't own), so this recipe stays a thin shell.
dev *ARGS:
    bun scripts/oj/index.ts dev {{ARGS}}

# The windowless engine inner-loop: bacon re-runs the render/nextest harnesses on
# save for sub-second DSP iteration (no cargo-rebuild + window-restart tax).
engine-watch *ARGS:
    bacon {{ARGS}}
