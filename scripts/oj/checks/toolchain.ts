// scripts/oj/checks/toolchain.ts — presence checks for the dev toolchain via
// Bun.$. WARN (never fail) when a Rust tool is absent, because this repo's
// primary contributor rig may not have cargo/rustc/just installed (the wasm leg
// runs in CI). Prints copy-paste fix hints. bun absence would be self-evident
// (this very process is bun), so it is reported as pass.

import { $ } from 'bun';
import type { CheckResult } from '../lib/report';

export const id = 'toolchain';
export const name = 'Rust + Bun toolchain presence';

interface ToolProbe {
  cmd: string;
  args: string[];
  label: string;
  hint: string;
  required: boolean; // required => contributes to fail-as-warn; here all are soft
}

const PROBES: ToolProbe[] = [
  { cmd: 'bun', args: ['--version'], label: 'bun', hint: 'install from https://bun.sh', required: true },
  { cmd: 'rustc', args: ['--version'], label: 'rustc', hint: 'install via https://rustup.rs', required: false },
  { cmd: 'cargo', args: ['--version'], label: 'cargo', hint: 'install via https://rustup.rs', required: false },
  { cmd: 'just', args: ['--version'], label: 'just', hint: 'cargo install just (or: winget install Casey.Just)', required: false },
];

async function probe(p: ToolProbe): Promise<{ ok: boolean; version: string }> {
  try {
    const out = await $`${p.cmd} ${p.args}`.quiet();
    return { ok: out.exitCode === 0, version: out.text().trim().split('\n')[0] ?? '' };
  } catch {
    return { ok: false, version: '' };
  }
}

async function hasWasmTarget(): Promise<boolean | null> {
  // null => cargo/rustup absent, can't tell.
  try {
    const out = await $`rustup target list --installed`.quiet();
    if (out.exitCode !== 0) return null;
    return out.text().includes('wasm32-unknown-unknown');
  } catch {
    return null;
  }
}

export async function run(): Promise<CheckResult> {
  const results = await Promise.all(PROBES.map(async (p) => ({ p, r: await probe(p) })));
  const present = results.filter((x) => x.r.ok);
  const absent = results.filter((x) => !x.r.ok);

  const detailLines: string[] = [];
  for (const { p, r } of results) {
    detailLines.push(`${r.ok ? 'ok ' : '-- '} ${p.label}: ${r.ok ? r.version : 'not found'}`);
  }

  const wasm = await hasWasmTarget();
  if (wasm === true) detailLines.push('ok  wasm32-unknown-unknown target installed');
  else if (wasm === false) detailLines.push('--  wasm32-unknown-unknown target NOT installed');
  else detailLines.push('--  wasm32 target: unknown (rustup absent)');

  const hints: string[] = [];
  for (const { p } of absent) hints.push(`${p.label}: ${p.hint}`);
  if (wasm === false) hints.push('wasm target: rustup target add wasm32-unknown-unknown');

  // A truly required tool (bun) missing would be a fail; everything else WARN.
  const requiredMissing = absent.filter((x) => x.p.required);
  if (requiredMissing.length > 0) {
    return {
      id,
      name,
      status: 'fail',
      detail: detailLines.join('\n'),
      fix: hints.join('\n'),
    };
  }

  if (absent.length > 0 || wasm !== true) {
    return {
      id,
      name,
      status: 'warn',
      detail: [
        ...detailLines,
        '',
        'Rust tooling is absent on this machine; the Rust legs run in CI / on a Rust-equipped rig.',
      ].join('\n'),
      fix: hints.join('\n'),
    };
  }

  return {
    id,
    name,
    status: 'pass',
    detail: detailLines.join('\n'),
  };
}
