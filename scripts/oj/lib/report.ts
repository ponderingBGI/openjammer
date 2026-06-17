// scripts/oj/lib/report.ts — the CheckResult shape + human / --json rendering,
// the summary line, and the exit-code policy. Shared by every subcommand.
//
// Exit-code policy: the process exits non-zero ONLY if at least one check has
// status === 'fail'. 'warn' and 'skip' never fail the run (cargo-absent legs,
// missing-host probes, etc. must never crash or fail a clean tree).

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  /** Stable machine id, e.g. "version-sync". Used by --check <id>. */
  id: string;
  /** Human-friendly name shown in the text report. */
  name: string;
  status: CheckStatus;
  /** Optional one-or-more lines of context. */
  detail?: string;
  /** Optional human hint describing how to fix a warn/fail. */
  fix?: string;
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skip: 'SKIP',
};

/** True when any result is a hard failure (the only thing that fails the run). */
export function hasFailure(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'fail');
}

/** Process exit code derived from the result set. */
export function exitCodeFor(results: CheckResult[]): number {
  return hasFailure(results) ? 1 : 0;
}

/** Render a single result as one or more human lines. */
function renderHuman(r: CheckResult): string {
  const head = `[${STATUS_GLYPH[r.status]}] ${r.id} — ${r.name}`;
  const lines = [head];
  if (r.detail) {
    for (const line of r.detail.split('\n')) lines.push(`       ${line}`);
  }
  if (r.fix) lines.push(`       fix: ${r.fix}`);
  return lines.join('\n');
}

/** Print the full report (human or JSON) and return the exit code. */
export function renderReport(results: CheckResult[], json: boolean): number {
  if (json) {
    const counts = summarize(results);
    const payload = {
      ok: !hasFailure(results),
      summary: counts,
      checks: results.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        detail: r.detail ?? null,
        fix: r.fix ?? null,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return exitCodeFor(results);
  }

  const blocks = results.map(renderHuman);
  process.stdout.write(blocks.join('\n') + '\n');
  const c = summarize(results);
  process.stdout.write(
    `\nsummary: ${c.pass} pass, ${c.warn} warn, ${c.fail} fail, ${c.skip} skip\n`,
  );
  return exitCodeFor(results);
}

export interface Summary {
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  total: number;
}

export function summarize(results: CheckResult[]): Summary {
  const s: Summary = { pass: 0, warn: 0, fail: 0, skip: 0, total: results.length };
  for (const r of results) s[r.status] += 1;
  return s;
}
