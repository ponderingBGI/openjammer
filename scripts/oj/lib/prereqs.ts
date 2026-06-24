// scripts/oj/lib/prereqs.ts — the SINGLE SOURCE OF TRUTH for native-build
// prerequisites, shared by `oj doctor` (the native-readiness check), `oj setup`
// (the installer), and `oj dev` (the soft readiness warning). One matrix, three
// consumers — so detection and install can never diverge (code-value: extend,
// never fork).
//
// SSOT: the Linux system-lib set (DEBIAN_TAURI_LIBS) MIRRORS the apt list in
// .github/actions/setup-rust/action.yml, asserted by
// scripts/oj/__tests__/prereqs-ssot.test.ts so the installer and CI can't drift.
//
// Detection is by DIRECT, robust probes (registry / vswhere / xcode-select /
// pkg-config / `--version`), NOT by parsing `tauri info`: its `--json` flag does
// not exist in the pinned @tauri-apps/cli (2.11.2), and its text output is
// brittle. We point users at `bun run tauri info` for a rich human dump; we never
// parse it.

import { $ } from 'bun';

export type Tier = 1 | 2 | 3;
export type OS = 'win32' | 'darwin' | 'linux';
export type LinuxPm = 'apt' | 'dnf' | 'pacman';

/** The pinned wasm nightly (mirrors rust-toolchain.toml / justfile call sites). */
export const WASM_NIGHTLY = '2026-06-01';

/** WebView2 Evergreen runtime client GUID (Microsoft-documented). */
const WEBVIEW2_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

/**
 * The COMPLETE Debian/apt set the native build needs — build tools (build-essential,
 * cmake for the JUCE/ojhost C++ build, pkg-config), the Tauri/cpal libs, and the
 * freetype/fontconfig/X11/GL libs a Linux build links. MUST equal the apt list in
 * .github/actions/setup-rust/action.yml (enforced by prereqs-ssot.test.ts) so a dev's
 * `oj setup` installs EXACTLY what CI does — no "works in CI, fails on my box" drift.
 */
export const DEBIAN_TAURI_LIBS = [
  'build-essential',
  'cmake',
  'pkg-config',
  'libasound2-dev',
  'libfreetype6-dev',
  'libfontconfig1-dev',
  'libx11-dev',
  'libxext-dev',
  'libxinerama-dev',
  'libxrandr-dev',
  'libxcursor-dev',
  'libgl1-mesa-dev',
  'libwebkit2gtk-4.1-dev',
  'libgtk-3-dev',
  'libsoup-3.0-dev',
  'libjavascriptcoregtk-4.1-dev',
  'librsvg2-dev',
] as const;

// The same six libraries by their pkg-config `.pc` names (for detection) and
// their dnf/pacman package names (for install on Fedora/Arch). The dnf/pacman
// names come from the Tauri v2 prerequisites docs and are UNVERIFIED on a real
// box here — prefer idempotent flags and re-detect after install.
const LINUX_LIBS = [
  { pc: 'alsa', dnf: 'alsa-lib-devel', pacman: 'alsa-lib' },
  { pc: 'webkit2gtk-4.1', dnf: 'webkit2gtk4.1-devel', pacman: 'webkit2gtk-4.1' },
  { pc: 'gtk+-3.0', dnf: 'gtk3-devel', pacman: 'gtk3' },
  { pc: 'libsoup-3.0', dnf: 'libsoup3-devel', pacman: 'libsoup3' },
  // javascriptcoregtk ships inside webkit2gtk on Arch (no separate pacman pkg).
  { pc: 'javascriptcoregtk-4.1', dnf: 'javascriptcoregtk4.1-devel', pacman: null },
  { pc: 'librsvg-2.0', dnf: 'librsvg2-devel', pacman: 'librsvg' },
] as const;

const RUSTUP_HINT = 'install the Rust toolchain via https://rustup.rs';
const MSVC_HINT =
  'install "Desktop development with C++" (MSVC) — VS 2022 Build Tools';
const WEBVIEW2_HINT = 'install the Evergreen WebView2 Runtime (Microsoft)';
const XCODE_HINT = 'xcode-select --install';

// ── DetectResult + Prereq descriptor ────────────────────────────────────────

export interface DetectResult {
  id: string;
  label: string;
  tier: Tier;
  /** true = present, false = absent, null = couldn't determine (probe absent). */
  present: boolean | null;
  /** Version string or short status note. */
  detail: string;
  /** Copy-paste hint shown when absent. */
  fixHint: string;
}

/** A command `oj setup` can run to install a missing prerequisite. */
export interface InstallCmd {
  /** Human display (printed in the plan). */
  display: string;
  /** Argv spawned directly (preferred), OR a `shell` line for pipes. */
  argv?: string[];
  shell?: string;
  /** May trigger UAC / sudo elevation. */
  elevated?: boolean;
}

export interface Prereq {
  id: string;
  label: string;
  tier: Tier;
  detect: () => Promise<DetectResult>;
  /** The install command for this OS/PM, or null if not auto-installable. */
  install: (pm: LinuxPm | null) => InstallCmd | null;
}

function mk(
  id: string,
  label: string,
  tier: Tier,
  present: boolean | null,
  detail: string,
  fixHint: string,
): DetectResult {
  return { id, label, tier, present, detail, fixHint };
}

// ── Low-level probes ─────────────────────────────────────────────────────────

/** First line of `<cmd> --version`, or null when the command is absent/fails. */
async function version(cmd: string, args: string[] = ['--version']): Promise<string | null> {
  try {
    const out = await $`${cmd} ${args}`.quiet().nothrow();
    if (out.exitCode !== 0) return null;
    return (out.text().trim().split('\n')[0] ?? '').trim();
  } catch {
    return null;
  }
}

async function regQueryPv(key: string): Promise<string | null> {
  try {
    const out = await $`reg query ${key} /v pv`.quiet().nothrow();
    if (out.exitCode !== 0) return null;
    const m = out.text().match(/\bpv\b\s+REG_\w+\s+([^\r\n]+)/i);
    return m && m[1] ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function pkgConfigExists(pc: string): Promise<boolean | null> {
  try {
    const out = await $`pkg-config --exists ${pc}`.quiet().nothrow();
    return out.exitCode === 0;
  } catch {
    return null; // pkg-config itself absent
  }
}

// ── Detectors ────────────────────────────────────────────────────────────────

async function detectRust(): Promise<DetectResult> {
  const v = await version('cargo');
  return mk('rust', 'Rust toolchain (cargo/rustc)', 1, v !== null, v ?? 'not found', RUSTUP_HINT);
}

async function detectWebView2(): Promise<DetectResult> {
  const keys = [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`,
    `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_GUID}`,
  ];
  for (const k of keys) {
    const pv = await regQueryPv(k);
    if (pv && pv !== '0.0.0.0') {
      return mk('webview2', 'WebView2 runtime', 1, true, pv, WEBVIEW2_HINT);
    }
  }
  return mk('webview2', 'WebView2 runtime', 1, false, 'not found', WEBVIEW2_HINT);
}

async function detectMsvc(): Promise<DetectResult> {
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = `${pf86}\\Microsoft Visual Studio\\Installer\\vswhere.exe`;
  try {
    if (!(await Bun.file(vswhere).exists())) {
      return mk('msvc', 'MSVC build tools', 1, false, 'vswhere not found', MSVC_HINT);
    }
    const args = [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ];
    const out = await $`${vswhere} ${args}`.quiet().nothrow();
    const path = (out.text().trim().split('\n')[0] ?? '').trim();
    if (out.exitCode === 0 && path.length > 0) {
      return mk('msvc', 'MSVC build tools', 1, true, path, MSVC_HINT);
    }
    return mk('msvc', 'MSVC build tools', 1, false, 'VC tools not installed', MSVC_HINT);
  } catch {
    return mk('msvc', 'MSVC build tools', 1, false, 'detection failed', MSVC_HINT);
  }
}

async function detectXcodeClt(): Promise<DetectResult> {
  try {
    const out = await $`xcode-select -p`.quiet().nothrow();
    const path = out.text().trim();
    if (out.exitCode === 0 && path.length > 0) {
      return mk('xcode-clt', 'Xcode Command Line Tools', 1, true, path, XCODE_HINT);
    }
  } catch {
    /* fall through */
  }
  return mk('xcode-clt', 'Xcode Command Line Tools', 1, false, 'not found', XCODE_HINT);
}

async function detectLinuxLibs(): Promise<DetectResult> {
  const checks = await Promise.all(LINUX_LIBS.map((l) => pkgConfigExists(l.pc)));
  if (checks.every((c) => c === null)) {
    return mk(
      'linux-libs',
      'Tauri/cpal system libraries',
      1,
      null,
      'pkg-config absent — cannot probe',
      'install pkg-config + the Tauri/cpal -dev libraries (see `oj setup`)',
    );
  }
  const missing = LINUX_LIBS.filter((_, i) => checks[i] !== true).map((l) => l.pc);
  const present = missing.length === 0;
  return mk(
    'linux-libs',
    'Tauri/cpal system libraries',
    1,
    present,
    present ? 'all present' : `missing: ${missing.join(', ')}`,
    'run `oj setup` to install the -dev libraries',
  );
}

async function detectWasmTarget(): Promise<DetectResult> {
  try {
    const out = await $`rustup target list --installed`.quiet().nothrow();
    if (out.exitCode !== 0) {
      return mk('wasm-target', 'wasm32-unknown-unknown target', 2, null, 'rustup absent', 'rustup target add wasm32-unknown-unknown');
    }
    const has = out.text().includes('wasm32-unknown-unknown');
    return mk('wasm-target', 'wasm32-unknown-unknown target', 2, has, has ? 'installed' : 'not installed', 'rustup target add wasm32-unknown-unknown');
  } catch {
    return mk('wasm-target', 'wasm32-unknown-unknown target', 2, null, 'rustup absent', 'rustup target add wasm32-unknown-unknown');
  }
}

async function detectWasmNightly(): Promise<DetectResult> {
  const name = `nightly-${WASM_NIGHTLY}`;
  try {
    const out = await $`rustup toolchain list`.quiet().nothrow();
    if (out.exitCode !== 0) {
      return mk('wasm-nightly', `${name} (+rust-src)`, 2, null, 'rustup absent', `rustup toolchain install ${name} --component rust-src`);
    }
    const has = out.text().includes(name);
    return mk('wasm-nightly', `${name} (+rust-src)`, 2, has, has ? 'installed' : 'not installed', `rustup toolchain install ${name} --component rust-src`);
  } catch {
    return mk('wasm-nightly', `${name} (+rust-src)`, 2, null, 'rustup absent', `rustup toolchain install ${name} --component rust-src`);
  }
}

async function detectJust(): Promise<DetectResult> {
  const v = await version('just');
  return mk('just', 'just (recipe runner)', 2, v !== null, v ?? 'not found', 'cargo install just');
}

async function detectBacon(): Promise<DetectResult> {
  const v = await version('bacon');
  return mk('bacon', 'bacon (engine watch loop)', 2, v !== null, v ?? 'not found', 'cargo install --locked bacon');
}

// ── Install-command builders ─────────────────────────────────────────────────

const wingetArgs = (id: string, override?: string): string[] => {
  const base = ['winget', 'install', '--id', id, '-e', '--accept-package-agreements', '--accept-source-agreements'];
  return override ? [...base, '--override', override] : base;
};

function rustInstall(os: OS): InstallCmd {
  if (os === 'win32') {
    return { display: 'winget install Rustlang.Rustup', argv: wingetArgs('Rustlang.Rustup') };
  }
  const line = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y";
  return { display: line, shell: line };
}

function rustPrereq(os: OS): Prereq {
  return { id: 'rust', label: 'Rust toolchain (cargo/rustc)', tier: 1, detect: detectRust, install: () => rustInstall(os) };
}

function linuxLibsInstall(pm: LinuxPm | null): InstallCmd | null {
  if (pm === 'apt') {
    // DEBIAN_TAURI_LIBS already carries build-essential + pkg-config (== the CI set);
    // add `curl` for rustup on a fresh box (CI's runner ships it preinstalled, so it
    // is install-only and not part of the SSOT-checked list).
    return {
      display: `sudo apt-get install -y ${[...DEBIAN_TAURI_LIBS, 'curl'].join(' ')}`,
      argv: ['sudo', 'apt-get', 'install', '-y', ...DEBIAN_TAURI_LIBS, 'curl'],
      elevated: true,
    };
  }
  if (pm === 'dnf') {
    const pkgs = [...LINUX_LIBS.map((l) => l.dnf), 'pkgconf-pkg-config', 'gcc', 'gcc-c++', 'make'];
    return { display: `sudo dnf install -y ${pkgs.join(' ')}`, argv: ['sudo', 'dnf', 'install', '-y', ...pkgs], elevated: true };
  }
  if (pm === 'pacman') {
    const pacmanLibs: string[] = [];
    for (const l of LINUX_LIBS) if (l.pacman) pacmanLibs.push(l.pacman);
    const pkgs = [...pacmanLibs, 'pkgconf', 'base-devel'];
    return { display: `sudo pacman -S --needed --noconfirm ${pkgs.join(' ')}`, argv: ['sudo', 'pacman', '-S', '--needed', '--noconfirm', ...pkgs], elevated: true };
  }
  return null;
}

const cargoInstall = (display: string, argv: string[]): InstallCmd => ({ display, argv });

// ── The matrix ───────────────────────────────────────────────────────────────

function normalizeOs(p: NodeJS.Platform): OS {
  return p === 'win32' || p === 'darwin' ? p : 'linux';
}

const TIER2: Prereq[] = [
  { id: 'wasm-target', label: 'wasm32-unknown-unknown target', tier: 2, detect: detectWasmTarget, install: () => cargoInstall('rustup target add wasm32-unknown-unknown', ['rustup', 'target', 'add', 'wasm32-unknown-unknown']) },
  { id: 'wasm-nightly', label: `nightly-${WASM_NIGHTLY} (+rust-src)`, tier: 2, detect: detectWasmNightly, install: () => cargoInstall(`rustup toolchain install nightly-${WASM_NIGHTLY} --component rust-src`, ['rustup', 'toolchain', 'install', `nightly-${WASM_NIGHTLY}`, '--component', 'rust-src']) },
  { id: 'just', label: 'just (recipe runner)', tier: 2, detect: detectJust, install: () => cargoInstall('cargo install just', ['cargo', 'install', 'just']) },
  { id: 'bacon', label: 'bacon (engine watch loop)', tier: 2, detect: detectBacon, install: () => cargoInstall('cargo install --locked bacon', ['cargo', 'install', '--locked', 'bacon']) },
];

/** The native-build prerequisite matrix for the given OS (defaults to host). */
export function nativePrereqs(os: OS = normalizeOs(process.platform)): Prereq[] {
  // tier-1 build deps FIRST (Windows install order: MSVC → WebView2 → rust, so
  // the linker exists before rustup runs), then rust, then the tier-2 extras.
  let tier1: Prereq[];
  if (os === 'win32') {
    tier1 = [
      { id: 'msvc', label: 'MSVC build tools', tier: 1, detect: detectMsvc, install: () => ({ display: 'winget install Microsoft.VisualStudio.2022.BuildTools (VCTools)', argv: wingetArgs('Microsoft.VisualStudio.2022.BuildTools', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22000'), elevated: true }) },
      { id: 'webview2', label: 'WebView2 runtime', tier: 1, detect: detectWebView2, install: () => ({ display: 'winget install Microsoft.EdgeWebView2Runtime', argv: wingetArgs('Microsoft.EdgeWebView2Runtime'), elevated: true }) },
      rustPrereq(os),
    ];
  } else if (os === 'darwin') {
    tier1 = [
      { id: 'xcode-clt', label: 'Xcode Command Line Tools', tier: 1, detect: detectXcodeClt, install: () => ({ display: 'xcode-select --install', argv: ['xcode-select', '--install'] }) },
      rustPrereq(os),
    ];
  } else {
    tier1 = [
      { id: 'linux-libs', label: 'Tauri/cpal system libraries', tier: 1, detect: detectLinuxLibs, install: (pm) => linuxLibsInstall(pm) },
      rustPrereq(os),
    ];
  }
  return [...tier1, ...TIER2];
}

/** Detect the host's available Linux package manager (apt → dnf → pacman). */
export function linuxPackageManager(): LinuxPm | null {
  if (Bun.which('apt-get')) return 'apt';
  if (Bun.which('dnf')) return 'dnf';
  if (Bun.which('pacman')) return 'pacman';
  return null;
}

/** Run every detector for the requested tiers (default: all) in parallel. */
export async function detectAll(opts: { tiers?: Tier[]; os?: OS } = {}): Promise<DetectResult[]> {
  const os = opts.os ?? normalizeOs(process.platform);
  const tiers = opts.tiers ?? [1, 2, 3];
  const list = nativePrereqs(os).filter((p) => tiers.includes(p.tier));
  return Promise.all(list.map((p) => p.detect()));
}

export interface ReadinessSummary {
  ok: boolean;
  missing: DetectResult[];
  results: DetectResult[];
  lines: string[];
}

/** Status glyph for a detect result (ok / missing / unknown). */
export function glyph(present: boolean | null): string {
  return present === true ? 'ok ' : present === false ? '-- ' : '?? ';
}

/**
 * The tier-1 (native build) readiness summary — used by `oj dev`'s soft warning
 * and `oj doctor`'s native-readiness check.
 */
export async function tier1Summary(): Promise<ReadinessSummary> {
  const results = await detectAll({ tiers: [1] });
  const missing = results.filter((r) => r.present === false);
  const lines = results.map((r) => `${glyph(r.present)} ${r.label}: ${r.present === false ? 'MISSING' : r.detail || 'ok'}`);
  return { ok: missing.length === 0, missing, results, lines };
}
