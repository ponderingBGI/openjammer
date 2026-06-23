// scripts/oj/dev.ts — the one-command native dev loop.
//
//   oj dev            run the native app: Vite HMR + the ojcore-native engine,
//                     one terminal, unified logs, clean Ctrl+C.
//   oj dev --engine   run the windowless engine inner-loop (bacon): sub-second
//                     Rust/DSP iteration against the render/nextest harnesses.
//   oj dev <flags>    any other flags pass straight through to `tauri dev`
//                     (e.g. --release, -f <feature>, --additional-watch-folders).
//
// DELEGATION IS THE DESIGN. The hardest part of a cross-platform dev loop —
// recursive Windows process-tree teardown + correct Ctrl+C — is already solved
// in Rust inside the Tauri CLI (`@tauri-apps/cli`, a pinned devDependency). It
// runs `beforeDevCommand` (`bun run dev` → Vite) via `cmd /S /C` on Windows /
// `sh -c` on Unix and, on shutdown, kills the whole tree (PowerShell recursive
// kill on Windows, embedded shell script on Unix). So this wrapper owns NO
// signal-handling, process-group, or taskkill code: it inherits stdio and lets
// Ctrl+C reach the `tauri` child directly. DO NOT add a SIGINT/SIGTERM handler
// here — on Windows that re-introduces the orphaned-process-tree risk this
// design exists to avoid (Bun's proc.kill() ignores the signal and force-kills
// only the immediate child). agents.md: "fallbacks only at edges we don't own".

import { resolve, join } from 'node:path';
import { tier1Summary } from './lib/prereqs';

const ROOT = resolve(import.meta.dir, '..', '..');

// The absolute path to the running bun binary. On Windows `bun` is often a `.cmd`
// shim (npm global install), which Bun.spawn can't reliably launch in a no-console
// / background context — spawning the real exe by absolute path avoids PATH and
// `.cmd` resolution entirely.
const BUN = process.execPath;

/** Native engine transport selected under Tauri. */
const NATIVE_EXECUTOR = 'ojcore-native';
const PI_PKG = '@earendil-works/pi-coding-agent';
const PI_STAMP = 'src-tauri/binaries/openjammer-pi-runtime.json';

export async function dev(args: string[]): Promise<number> {
  // `oj dev --engine [job …]` → the windowless bacon inner-loop.
  if (args.includes('--engine')) {
    return engineWatch(args.filter((a) => a !== '--engine'));
  }
  return nativeDev(args);
}

/** The full-app native loop: preflight, lazy Pi, then delegate to `tauri dev`. */
async function nativeDev(passthrough: string[]): Promise<number> {
  // 1. Native-readiness soft warning. Probes the tier-1 build prereqs (Rust +
  //    per-OS MSVC/WebView2 / Xcode CLT / Linux libs) and, if any are missing,
  //    names them and points at `oj setup` — then CONTINUES (degraded-but-safe:
  //    tauri/cargo still surfaces the real error, and an expert isn't blocked).
  const readiness = await tier1Summary();
  if (!readiness.ok) {
    const missing = readiness.missing.map((m) => m.label).join(', ');
    process.stdout.write(
      `[oj dev] native build prerequisites missing: ${missing}\n` +
        '          run `bun run oj setup` to install them — continuing anyway…\n',
    );
  }

  // 2. Lazy Pi sidecar: rebuild only when the stamp is stale/missing (moved out
  //    of tauri.conf beforeDevCommand so warm starts are near-instant).
  const piCode = await ensurePiSidecar();
  if (piCode !== 0) {
    process.stdout.write(
      '[pi] sidecar build failed — continuing without it (Ctrl+K AI may be unavailable in dev).\n',
    );
  }

  // 3. Select the native engine transport (explicit value wins, mirroring
  //    src/audio/executor/index.ts; redundant with Tauri's auto-pick but
  //    self-documenting).
  if (!process.env.VITE_OJ_EXECUTOR) process.env.VITE_OJ_EXECUTOR = NATIVE_EXECUTOR;

  // 4. Print the controls once, then delegate the whole lifecycle to the Tauri
  //    CLI. Inherit stdio so logs are unified and Ctrl+C reaches `tauri`
  //    directly. NO keypress/signal handler — the window auto-opens, edits
  //    hot-reload (src) or restart it (Rust), and Tauri owns clean teardown.
  //    A keypress menu would mean taking that teardown back (Bun can't kill a
  //    process tree on Windows) — so we print the controls instead of faking a
  //    Vite-style menu that the non-TTY child can't deliver anyway.
  if (!passthrough.length) printControls();
  return spawnInherited([BUN, 'run', 'tauri', 'dev', ...passthrough], {
    notFoundHint: 'is `@tauri-apps/cli` installed? run `bun install`.',
  });
}

/** The one-time "what's happening + how to drive it" banner for `bun native`. */
function printControls(): void {
  process.stdout.write(
    '\n  OpenJammer · native dev\n' +
      '  The desktop window opens on its own once the engine builds.\n' +
      '    • edit src/**            → window hot-reloads instantly\n' +
      '    • edit Rust (crates/**)  → window rebuilds + restarts\n' +
      '    • Ctrl+C                 → stop everything\n' +
      '  Live logs (Vite + Rust engine) stream below.\n\n',
  );
}

/** The engine inner-loop: bacon owns its own TUI + child lifecycle. */
async function engineWatch(passthrough: string[]): Promise<number> {
  return spawnInherited(['bacon', ...passthrough], {
    notFoundHint: 'install it with `cargo install --locked bacon`.',
  });
}

/**
 * Rebuild the bundled Pi runtime only when needed. Returns 0 when up-to-date or
 * rebuilt successfully, non-zero on a build failure. Never throws — a Pi problem
 * must not block the native dev loop.
 */
async function ensurePiSidecar(): Promise<number> {
  if (truthyEnv(process.env.OJ_DEV_SKIP_PI)) {
    process.stdout.write('[pi] OJ_DEV_SKIP_PI set — skipping sidecar build.\n');
    return 0;
  }

  const installed = await readJson(join(ROOT, 'node_modules', ...PI_PKG.split('/'), 'package.json'));
  const installedVersion = asString(installed?.version);
  if (!installedVersion) {
    process.stdout.write(`[pi] ${PI_PKG} not found in node_modules — skipping sidecar build.\n`);
    return 0;
  }

  const stamp = await readJson(join(ROOT, PI_STAMP));
  const stampVersion = asString(stamp?.version);
  const binaryName = asString(stamp?.binary);
  const binaryPresent =
    !!binaryName && (await Bun.file(join(ROOT, 'src-tauri', 'binaries', binaryName)).exists());

  if (stampVersion === installedVersion && binaryPresent) {
    return 0; // up-to-date — nothing to build, stay quiet
  }

  process.stdout.write(
    `[pi] building sidecar for ${PI_PKG}@${installedVersion} (${stampVersion ?? 'none'} → ${installedVersion})…\n`,
  );
  return spawnInherited([BUN, 'run', 'build:pi-runtime'], {
    notFoundHint: 'run `bun install`.',
  });
}

interface SpawnOpts {
  notFoundHint: string;
}

/**
 * Spawn a child with fully inherited stdio (so logs stream live and Ctrl+C is
 * delivered by the console to the child). Returns the child's exit code; maps a
 * missing executable to a clear message + code 127.
 */
async function spawnInherited(cmd: string[], opts: SpawnOpts): Promise<number> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: ROOT,
      stdio: ['inherit', 'inherit', 'inherit'],
      env: process.env,
    });
    return await proc.exited;
  } catch (e) {
    process.stderr.write(`oj dev: could not run \`${cmd[0]}\` — ${opts.notFoundHint}\n`);
    process.stderr.write(`  (${(e as Error).message})\n`);
    return 127;
  }
}

function truthyEnv(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}
