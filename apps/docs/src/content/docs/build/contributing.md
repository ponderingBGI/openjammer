---
title: Development setup
description: Get the dual-target build running locally.
sidebar:
  order: 1
---

OpenJammer is a Rust engine workspace plus a React + TypeScript control plane,
targeting both a native Tauri desktop app and a browser PWA.

## Prerequisites

- **Bun** — the package manager + script runner (npm/yarn/pnpm are blocked by a
  `preinstall` guard; use `bun install`).
- **Rust** (stable + the pinned nightly for the wasm leg) — for the engine and
  the native desktop app.
- Platform audio/UI system libraries for the Tauri build (ALSA + WebKitGTK on
  Linux; bundled on macOS/Windows).

## Frontend (control plane)

```sh
bun install
bun run dev        # Vite dev server (COOP/COEP headers on, for SharedArrayBuffer)
bun run test:run   # vitest
bun run lint       # eslint (incl. the no-console facade rule)
bun run build      # tsc + production PWA build
```

## Engine + native app

```sh
cargo test --workspace                       # engine tests + golden render
cargo nextest run -p ojcore                  # the audio-thread no-alloc gate
cargo build -p oj-tauri                      # the native desktop shell
cargo run -p ojcore-native --bin render --features demo -- out.wav 2   # device-free render
```

## CI is the source of truth

Every PR runs four jobs that must be green: **Engine** (fmt + clippy `-D warnings`
+ workspace tests + the no-alloc gate + `no_std`/wasm builds), **Web** (typecheck
+ lint + tests + build), and the native **Windows** and **macOS (aarch64)** legs
(build + golden render). Local hooks are fast feedback only — GitHub Actions is
authoritative.

## A few invariants

- **Never allocate/lock/block on the audio thread** — see
  [Real-time safety](/openjammer/build/architecture/real-time-safety/).
- **Log through the facade** — route `console.*` through `src/utils/log.ts` so it
  lands in the searchable DevLog; the `no-console` rule enforces this.
- **The wire schema is one source** — `ojproto` is canonical; its TypeScript
  mirror is parity-gated, and the `PrimitiveKind` set is locked by a cross-language
  equality gate. Change both sides together.
- **The docs site is workspace-isolated** — `apps/docs/` has its own lockfile and
  is not a member of the root workspace; install + build from inside it.
