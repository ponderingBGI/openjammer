// scripts/oj/checks/test-collection.ts — the META-GATE under every other gate.
//
// Every `*.test.ts` / `*.spec.ts` on disk MUST be collected by a runner CI actually
// runs, or it is BORN DEAD: it runs nowhere and reads green — the most dangerous
// lie in a repo, a proof harness that proves nothing. (This check exists because the
// whole scripts/oj/__tests__ suite — including an SSOT drift guard — was silently
// uncollected, hiding real config drift until it was un-blinded.)
//
// Two runners, two homes:
//   • vitest (`bun run test:run`): src/** and packages/oj-ui/src/** (jsdom tests).
//   • bun test (`bun run test:cli`): scripts/oj/__tests__ (Bun CLI tests using
//     `bun:test` + `Bun.file`, which vitest cannot run).
// A test anywhere else is flagged here so it can never silently rot.

import { resolve } from 'node:path';
import { Glob } from 'bun';
import type { CheckResult } from '../lib/report';

export const id = 'test-collection';
export const name = 'Every test file is collected by a CI runner (no born-dead tests)';

/** Path prefixes a runner CI invokes actually collects, each mapped to its runner.
 * A test outside all of these runs nowhere. */
const COVERED_PREFIXES = [
  'src/', // vitest — `bun run test:run`
  'packages/oj-ui/src/', // vitest — `bun run test:run`
  'scripts/oj/__tests__/', // bun test — `bun run test:cli`
  'e2e/', // playwright — `bun run test:e2e`
  'pi-extensions/permission-gate/', // node --test — `bun run test:pi-ext`
];

/** Build-output / vendored / dependency dirs whose test files are not ours. */
function isVendored(norm: string): boolean {
  return (
    norm.includes('node_modules/') ||
    norm.includes('dist/') ||
    norm.includes('target/') || // Cargo build output (e.g. vendored JUCE examples)
    norm.startsWith('.')
  );
}

export async function run(): Promise<CheckResult> {
  const root = resolve(import.meta.dir, '..', '..', '..');
  const glob = new Glob('**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}');
  const orphans: string[] = [];
  let total = 0;
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
    const norm = file.replace(/\\/g, '/');
    if (isVendored(norm)) continue;
    total++;
    if (!COVERED_PREFIXES.some((p) => norm.startsWith(p))) orphans.push(norm);
  }

  if (orphans.length === 0) {
    return {
      id,
      name,
      status: 'pass',
      detail: `${total} test files all live under a runner CI runs (vitest test:run, or bun test:cli).`,
    };
  }
  return {
    id,
    name,
    status: 'fail',
    detail: [
      `${orphans.length} test file(s) live where NO CI runner collects them — they run NOWHERE and read green:`,
      ...orphans.map((o) => `  ${o}`),
      'Move them under src/ (vitest) or scripts/oj/__tests__ (bun test:cli), or add their glob to a runner.',
    ].join('\n'),
    fix: 'put each test where a CI runner collects it (vitest include or the test:cli scope)',
  };
}
