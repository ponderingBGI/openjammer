// scripts/oj/checks/version-sync.ts — assert the four version files are equal
// (consistency check, NOT an SSOT). --fix line-surgically aligns them to the
// Cargo workspace canonical. Pure TS via lib/ssot.

import type { CheckResult } from '../lib/report';
import { checkVersionSync, fixVersionSync } from '../lib/ssot';

export const id = 'version-sync';
export const name = 'Version sync across the four version files';

export async function run(opts: { fix?: boolean } = {}): Promise<CheckResult> {
  if (opts.fix) {
    const before = await checkVersionSync();
    if (!before.inSync) {
      const outcome = await fixVersionSync();
      if (!outcome.ok) {
        // Could not fix (e.g. dirty tree). Report current drift as a fail.
        return drift(before, outcome.message);
      }
    }
  }

  const res = await checkVersionSync();
  if (res.inSync) {
    return {
      id,
      name,
      status: 'pass',
      detail: `all four files at "${res.distinct[0]}"`,
    };
  }
  return drift(res);
}

function drift(
  res: Awaited<ReturnType<typeof checkVersionSync>>,
  extra?: string,
): CheckResult {
  const lines = res.files.map((f) => `${f.path} -> ${f.version ?? '(missing/unparsed)'}`);
  const detail = [
    `distinct versions: ${res.distinct.join(', ') || '(none)'}`,
    ...lines,
    ...(extra ? [extra] : []),
  ].join('\n');
  return {
    id,
    name,
    status: 'fail',
    detail,
    fix: `align all four files to the Cargo canonical "${res.canonical ?? '?'}" via: bun scripts/oj/index.ts doctor --check version-sync --fix (clean tree required)`,
  };
}
