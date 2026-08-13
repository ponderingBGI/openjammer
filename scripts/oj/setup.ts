// scripts/oj/setup.ts — the native-build onboarding installer.
//
//   oj setup              detect prereqs, print the plan, confirm [y/N], install
//   oj setup --install    non-interactive: install without prompting (CI/scripts)
//   oj setup --yes        alias for --install
//   oj setup --dry-run    print the plan, install NOTHING
//   oj setup --wasm       also install the browser-worklet wasm nightly + target
//   oj setup --json       machine-readable detection + plan (report-only)
//
// Detection + the per-OS install commands live in lib/prereqs.ts (the SSOT shared
// with the `native-readiness` doctor check and `oj dev`). Safety: a non-TTY shell
// with no --install/--yes NEVER installs (no surprise UAC / multi-GB downloads in
// CI or pipes). Exit code reflects install-command success; re-detection after is
// informational (Rust/MSVC land on PATH only in a NEW shell).

import type { DetectResult, InstallCmd, Prereq } from './lib/prereqs';
import { nativePrereqs, linuxPackageManager, glyph } from './lib/prereqs';

// Bun provides the `prompt` global at runtime; the scripts tsconfig lib (ES2023)
// doesn't declare it, so declare the shape we use.
declare const prompt: (message?: string) => string | null;

export interface SetupArgs {
  install: boolean; // --install (non-interactive yes)
  yes: boolean; // --yes (alias)
  dryRun: boolean; // --dry-run
  wasm: boolean; // --wasm (include the wasm nightly leg)
  json: boolean; // --json (report-only)
}

interface Candidate {
  prereq: Prereq;
  cmd: InstallCmd;
}

export async function setup(_rest: string[], args: SetupArgs): Promise<number> {
  const isLinux = process.platform !== 'win32' && process.platform !== 'darwin';
  const pm = isLinux ? linuxPackageManager() : null;

  // Target tier-1 (the native build) always; tier-2 wasm only with --wasm.
  const prereqs = nativePrereqs().filter(
    (p) => p.tier === 1 || (args.wasm && (p.id === 'wasm-target' || p.id === 'wasm-nightly')),
  );
  const detected = await Promise.all(prereqs.map(async (p) => ({ p, d: await p.detect() })));

  // Candidates: anything not confirmed-present that has an install command here.
  const candidates: Candidate[] = [];
  for (const { p, d } of detected) {
    if (d.present === true) continue;
    const cmd = p.install(pm);
    if (cmd) candidates.push({ prereq: p, cmd });
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          os: process.platform,
          linuxPackageManager: pm,
          prerequisites: detected.map(({ d }) => slim(d)),
          plan: candidates.map((c) => c.cmd.display),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  // ── Human report ────────────────────────────────────────────────────────────
  process.stdout.write('oj setup — native build prerequisites\n\n');
  for (const { d } of detected) {
    process.stdout.write(`  ${glyph(d.present)} ${d.label}: ${d.present === false ? 'MISSING' : d.detail || 'ok'}\n`);
  }

  if (isLinux && pm === null && candidates.length === 0) {
    process.stdout.write('\nNo supported package manager (apt/dnf/pacman) detected — see docs/ARCHITECTURE.md for manual install.\n');
  }

  if (candidates.length === 0) {
    process.stdout.write('\n✓ native build prerequisites satisfied. Run `bun run dev:native` to start.\n');
    return 0;
  }

  process.stdout.write('\nTo install:\n');
  for (const c of candidates) {
    process.stdout.write(`  • ${c.cmd.display}${c.cmd.elevated ? '   (may require admin / sudo)' : ''}\n`);
  }

  if (args.dryRun) {
    process.stdout.write('\n(dry run — nothing installed)\n');
    return 0;
  }

  // ── Decide whether to install ────────────────────────────────────────────────
  const isTty = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  let proceed: boolean;
  if (args.install || args.yes) {
    proceed = true;
  } else if (isTty) {
    const ans = prompt('\ninstall now? [y/N] ');
    proceed = ans !== null && /^y(es)?$/i.test(ans.trim());
  } else {
    process.stdout.write('\nNon-interactive shell — re-run with `--install` to apply.\n');
    return 0;
  }
  if (!proceed) {
    process.stdout.write('aborted — nothing installed.\n');
    return 0;
  }

  // ── Install (in matrix order: build deps before rust) ────────────────────────
  let failures = 0;
  for (const c of candidates) {
    process.stdout.write(`\n→ ${c.cmd.display}${c.cmd.elevated ? '   (may prompt for admin / sudo)' : ''}\n`);
    const code = c.cmd.argv ? await runInherited(c.cmd.argv) : await runShell(c.cmd.shell ?? '');
    if (code !== 0) {
      failures += 1;
      process.stdout.write(`  ✗ exit ${code} — may need manual steps or admin rights.\n`);
    } else {
      process.stdout.write('  ✓ done\n');
    }
  }

  // ── Re-detect (informational; PATH for Rust/MSVC only updates in a NEW shell) ─
  process.stdout.write('\nPost-install status (open a NEW terminal if Rust/MSVC still show missing — PATH updates per shell):\n');
  const after = await Promise.all(prereqs.map((p) => p.detect()));
  for (const d of after) {
    process.stdout.write(`  ${glyph(d.present)} ${d.label}: ${d.present === false ? 'MISSING' : d.detail || 'ok'}\n`);
  }

  if (failures > 0) {
    process.stdout.write(`\n${failures} install step(s) failed — see output above.\n`);
    return 1;
  }
  process.stdout.write('\n✓ done. Verify with `bun run oj doctor --check native-readiness` (in a fresh shell).\n');
  return 0;
}

function slim(d: DetectResult) {
  return { id: d.id, label: d.label, tier: d.tier, present: d.present, detail: d.detail, fix: d.fixHint };
}

/** Spawn an argv with fully inherited stdio so installers can prompt the user. */
async function runInherited(cmd: string[]): Promise<number> {
  try {
    const proc = Bun.spawn(cmd, { stdio: ['inherit', 'inherit', 'inherit'], env: process.env });
    return await proc.exited;
  } catch (e) {
    process.stderr.write(`  could not run \`${cmd[0]}\`: ${(e as Error).message}\n`);
    return 127;
  }
}

/** Run a shell line (for pipe installers like rustup's curl | sh). */
async function runShell(line: string): Promise<number> {
  const cmd = process.platform === 'win32' ? ['cmd', '/c', line] : ['sh', '-c', line];
  return runInherited(cmd);
}
