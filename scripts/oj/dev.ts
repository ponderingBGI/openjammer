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

type PluginHostMode = 'scaffold' | 'clap' | 'juce';
type HostSource = 'default' | 'env' | 'flag' | 'tauri-features';

interface NativeDevOptions {
  passthrough: string[];
  pluginHost: PluginHostMode;
  hostSource: HostSource;
}

const PLUGIN_HOST_FEATURE: Record<Exclude<PluginHostMode, 'scaffold'>, string> = {
  clap: 'plugin-host-clap',
  juce: 'plugin-host-juce',
};

export async function dev(args: string[]): Promise<number> {
  // `oj dev --engine [job …]` → the windowless bacon inner-loop.
  if (args.includes('--engine')) {
    return engineWatch(args.filter((a) => a !== '--engine'));
  }
  return nativeDev(args);
}

/** The full-app native loop: preflight, lazy Pi, then delegate to `tauri dev`. */
async function nativeDev(rawArgs: string[]): Promise<number> {
  const opts = parseNativeDevOptions(rawArgs);
  if ('error' in opts) {
    process.stderr.write(`oj dev: ${opts.error}\n`);
    return 2;
  }

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

  // 4. Default to the scaffold plugin host so `bun native` opens quickly. The
  //    heavy JUCE CMake/MSBuild path is still one flag away (`--plugins`) but is
  //    never sprung on a normal dev-server launch.
  const tauriArgs = withPluginHostFeature(opts.passthrough, opts.pluginHost);

  // 5. Print the controls once, then delegate the whole lifecycle to the Tauri
  //    CLI. Inherit stdio so logs are unified and Ctrl+C reaches `tauri`
  //    directly. NO keypress/signal handler — the window auto-opens, edits
  //    hot-reload (src) or restart it (Rust), and Tauri owns clean teardown.
  //    A keypress menu would mean taking that teardown back (Bun can't kill a
  //    process tree on Windows) — so we print the controls instead of faking a
  //    Vite-style menu that the non-TTY child can't deliver anyway.
  printControls(opts.pluginHost, opts.hostSource);
  return spawnInherited([BUN, 'run', 'tauri', 'dev', ...tauriArgs], {
    notFoundHint: 'is `@tauri-apps/cli` installed? run `bun install`.',
  });
}

/** The one-time "what's happening + how to drive it" banner for `bun native`. */
function printControls(pluginHost: PluginHostMode, hostSource: HostSource): void {
  const host = pluginHostSummary(pluginHost, hostSource);
  process.stdout.write(
    '\n  OpenJammer · native dev\n' +
      '  The desktop window opens on its own once the engine builds.\n' +
      `  Plugin host: ${host}\n` +
      '    • edit src/**            → window hot-reloads instantly\n' +
      '    • edit Rust (crates/**)  → window rebuilds + restarts\n' +
      '    • Ctrl+C                 → stop everything\n' +
      '  Live logs (Vite + Rust engine) stream below.\n\n',
  );
}

function parseNativeDevOptions(args: string[]): NativeDevOptions | { error: string } {
  const passthrough: string[] = [];
  const requested: { host: PluginHostMode; source: 'flag' }[] = [];
  const envRaw = process.env.OJ_DEV_PLUGIN_HOST;
  let envHost: PluginHostMode | null = null;

  if (envRaw && envRaw.trim()) {
    envHost = parsePluginHostValue(envRaw);
    if (!envHost) {
      return {
        error:
          'OJ_DEV_PLUGIN_HOST must be one of scaffold, clap, or juce ' +
          `(got ${JSON.stringify(envRaw)})`,
      };
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--plugins' || arg === '--juce' || arg === '--plugin-host-juce') {
      requested.push({ host: 'juce', source: 'flag' });
      continue;
    }
    if (arg === '--clap' || arg === '--plugin-host-clap') {
      requested.push({ host: 'clap', source: 'flag' });
      continue;
    }
    if (arg === '--scaffold' || arg === '--no-plugins' || arg === '--plugin-host-scaffold') {
      requested.push({ host: 'scaffold', source: 'flag' });
      continue;
    }
    if (arg === '--plugin-host') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) return { error: 'missing value for --plugin-host' };
      const host = parsePluginHostValue(value);
      if (!host) return { error: `unknown --plugin-host value ${JSON.stringify(value)}` };
      requested.push({ host, source: 'flag' });
      i += 1;
      continue;
    }
    if (arg.startsWith('--plugin-host=')) {
      const value = arg.slice('--plugin-host='.length);
      const host = parsePluginHostValue(value);
      if (!host) return { error: `unknown --plugin-host value ${JSON.stringify(value)}` };
      requested.push({ host, source: 'flag' });
      continue;
    }
    passthrough.push(arg);
  }

  const explicitHosts = new Set(requested.map((r) => r.host));
  if (explicitHosts.size > 1) {
    return { error: 'choose only one plugin host: scaffold, clap, or juce' };
  }

  const tauriFeatureHost = inferPluginHostFromTauriFeatures(passthrough);
  const explicit = requested.at(-1);
  const selectedHost = explicit?.host ?? envHost ?? tauriFeatureHost ?? 'scaffold';
  if ((explicit || envHost) && tauriFeatureHost && tauriFeatureHost !== selectedHost) {
    const selectedSource = explicit ? 'plugin host flag' : 'OJ_DEV_PLUGIN_HOST';
    return {
      error:
        `${selectedSource} selects ${selectedHost}, but passthrough Tauri features select ` +
        `${tauriFeatureHost}`,
    };
  }

  return {
    passthrough,
    pluginHost: selectedHost,
    hostSource: explicit?.source ?? (envHost ? 'env' : tauriFeatureHost ? 'tauri-features' : 'default'),
  };
}

function parsePluginHostValue(value: string): PluginHostMode | null {
  switch (value.trim().toLowerCase()) {
    case 'scaffold':
    case 'none':
    case 'off':
    case 'no':
      return 'scaffold';
    case 'clap':
    case 'clap-only':
      return 'clap';
    case 'juce':
    case 'plugins':
    case 'full':
    case 'vst':
    case 'vst3':
      return 'juce';
    default:
      return null;
  }
}

function inferPluginHostFromTauriFeatures(args: string[]): PluginHostMode | null {
  // Tauri accepts `--features plugin-host-juce`, `-f plugin-host-juce`, and
  // comma-separated feature lists. We only need to recognize our three feature
  // names so the banner remains honest when a developer passes raw Tauri flags.
  const joined = args.join(' ');
  if (/\bplugin-host-juce\b/.test(joined)) return 'juce';
  if (/\bplugin-host-clap\b/.test(joined)) return 'clap';
  if (/\bplugin-host-scaffold\b/.test(joined)) return 'scaffold';
  return null;
}

function withPluginHostFeature(args: string[], host: PluginHostMode): string[] {
  if (host === 'scaffold' || inferPluginHostFromTauriFeatures(args)) return args;
  const feature = PLUGIN_HOST_FEATURE[host];
  const separator = args.indexOf('--');
  if (separator === -1) return [...args, '--features', feature];
  return [...args.slice(0, separator), '--features', feature, ...args.slice(separator)];
}

function pluginHostSummary(host: PluginHostMode, source: HostSource): string {
  const origin = source === 'default' ? 'default' : source === 'env' ? 'OJ_DEV_PLUGIN_HOST' : 'selected';
  switch (host) {
    case 'scaffold':
      return `${origin} fast scaffold (no VST/AU scan; use \`bun native --plugins\` for JUCE)`;
    case 'clap':
      return `${origin} CLAP-only host (pure Rust; no CMake/JUCE)`;
    case 'juce':
      return (
        `${origin} JUCE host (VST3/CLAP/AU; first CMake build can take minutes — ` +
        'plain `bun native` skips it)'
      );
  }
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
