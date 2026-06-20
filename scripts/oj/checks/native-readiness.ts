// scripts/oj/checks/native-readiness.ts — the OS-aware native-build prerequisite
// check (the build-specific sibling of the general `toolchain` check). Detection
// lives in lib/prereqs.ts (the SSOT shared with `oj setup` and `oj dev`).
//
// Status reflects TIER-1 only — "can this box build the native app?" — so a
// missing optional extra (just/bacon) never red-walls it. WARN-never-fail: a
// web-only contributor or a Rust-less maintainer rig must not fail a clean tree.

import type { CheckResult } from '../lib/report';
import { detectAll, glyph } from '../lib/prereqs';

export const id = 'native-readiness';
export const name = 'Native build prerequisites (Rust, MSVC/WebView2, system libs)';

export async function run(): Promise<CheckResult> {
  const results = await detectAll({ tiers: [1, 2] });
  const detailLines = results.map(
    (r) => `${glyph(r.present)} ${r.label}: ${r.present === false ? 'MISSING' : r.detail || 'ok'}`,
  );

  const tier1Missing = results.filter((r) => r.tier === 1 && r.present === false);

  if (tier1Missing.length > 0) {
    const hints = tier1Missing.map((r) => `${r.label}: ${r.fixHint}`);
    hints.push('install all at once: `bun run oj setup`  (full report: `bun run tauri info`)');
    return {
      id,
      name,
      status: 'warn',
      detail: [
        ...detailLines,
        '',
        `Native build prerequisites missing (${tier1Missing.length}). The native app will not compile until these are present.`,
      ].join('\n'),
      fix: hints.join('\n'),
    };
  }

  // Tier-1 satisfied → the native build works (PASS). Tier-2 extras are shown in
  // the detail for visibility but never change the status (the general `toolchain`
  // check owns those). No `fix` on a pass, to keep the report clean.
  return {
    id,
    name,
    status: 'pass',
    detail: detailLines.join('\n'),
  };
}
