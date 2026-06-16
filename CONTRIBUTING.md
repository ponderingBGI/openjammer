# Contributing to OpenJammer

Thanks for your interest in OpenJammer! This is a quick-start for contributors.
The full architecture, the real-time-safety invariant, the logging model, and the
release/version model live in the **[documentation site](https://ponderingbgi.github.io/openjammer/)**
(source in [`apps/docs`](apps/docs)); the design plans are in [`docs/plans`](docs/plans).

## What OpenJammer is

A **dual-target** audio app: the *same* Rust engine (`ojcore`) runs both as a
native Tauri desktop app (on a small-buffer audio stream, `<5 ms` latency) and
compiled to `wasm32` inside a browser AudioWorklet. The UI is a React + TypeScript
control plane (Vite). You patch a signal graph on a canvas and perform live.

## Development setup

### Prerequisites

- **[Bun](https://bun.sh)** — the package manager + script runner. npm/yarn/pnpm
  are blocked by a `preinstall` guard; use `bun`.
- **Rust** (stable, plus the pinned nightly for the wasm leg) — for the engine
  crates and the native desktop app.
- Platform audio/UI system libraries for the Tauri build (ALSA + WebKitGTK on
  Linux; bundled on macOS/Windows).

### Frontend (control plane)

```bash
bun install
bun run dev        # Vite dev server → http://localhost:5173 (COOP/COEP on)
bun run test:run   # vitest
bun run lint       # eslint (incl. the no-console logging-facade rule)
bun run build      # tsc + production PWA build
```

### Engine + native desktop app

```bash
cargo test --workspace                    # engine tests + the device-free golden render
cargo test -p ojcore --features devlog    # the audio-thread no-allocation gate
cargo build -p oj-tauri                   # the native desktop shell
```

## Project structure

```
openjammer/
├── crates/            # the Rust engine workspace (no_std-friendly core + std edges)
│   ├── ojproto/       # the wire schema (IR, EventKind, RtCommand) — the one source
│   ├── ojcore/        # compile + Engine + the wait-free rings + metering/events
│   ├── ojcore-dsp/    # pure DSP kernels (libm; native ↔ wasm reproducible)
│   ├── ojcore-native/ # the cpal AudioHost + the L1 tracing log sink
│   ├── ojcore-wasm/   # the wasm32 AudioWorklet host
│   └── …              # ojinstrument, ojhost, ojfaust, ojcore-midiring
├── src-tauri/         # oj-tauri — the native desktop shell (control-rate IPC ↔ engine)
├── src/               # the React + TS control plane (canvas, nodes, stores, DevLog)
├── packages/          # oj-protocol-ts — the hand-maintained, parity-gated TS wire mirror
├── apps/docs/         # the Starlight documentation site (workspace-isolated)
└── docs/plans/        # the foundations design plans
```

## A few load-bearing invariants

- **Never allocate, lock, or block on the audio thread.** This is enforced
  mechanically (`assert_no_alloc` + the `no_std` core). All UI↔RT communication is
  wait-free. See the docs site's *Real-time safety* page.
- **Log through the facade, not `console.*`.** Route logging through
  `src/utils/log.ts` (`logInfo`/`logWarn`/`logError`) so it lands in the searchable
  on-device DevLog; a `no-console` lint rule enforces this in app code.
- **The wire schema is one source.** `ojproto` is canonical; its TypeScript mirror
  (`packages/oj-protocol-ts`) is parity-gated and the `PrimitiveKind` set is locked
  by a cross-language equality gate. Change both sides together.
- **CI is authoritative.** Every PR runs four required jobs — **Engine** (fmt +
  clippy `-D warnings` + workspace tests + the no-alloc gate + no_std/wasm builds),
  **Web** (typecheck + lint + tests + build), and the native **Windows** and
  **macOS (aarch64)** legs. Local hooks are fast feedback only.

## Pull requests

1. Fork + branch (`git checkout -b feat/your-feature`).
2. Make focused changes that match the surrounding code; add tests.
3. Keep CI green locally (`bun run lint && bun run test:run && bun run build`, and
   `cargo test --workspace` if you touched Rust).
4. Use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`,
   `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `ci:`) — they drive automated
   versioning (release-please).
5. Open the PR; describe what changed and why, with screenshots/GIFs for visual
   changes.

## Reporting bugs

The fastest path is the in-app **"Report a problem"** action (Settings → About):
it bundles a redacted diagnostic snapshot + a recent log tail into a pre-filled
GitHub issue (secrets, home paths, and LAN addresses are scrubbed automatically;
you review the full text before posting). Otherwise, open a GitHub Issue with your
OS, build version, and steps to reproduce.

## License

By contributing, you agree your contributions are licensed under **AGPL-3.0**.

---

**Questions?** Open a GitHub Issue or discussion — we're happy to help.
