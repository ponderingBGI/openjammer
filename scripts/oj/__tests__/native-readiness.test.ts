// scripts/oj/__tests__/native-readiness.test.ts — the check returns a well-formed
// CheckResult and never throws, regardless of what's installed on the runner.

import { test, expect } from 'bun:test';
import { run, id, name } from '../checks/native-readiness';

test('native-readiness returns a valid CheckResult', async () => {
  const r = await run();
  expect(r.id).toBe(id);
  expect(r.id).toBe('native-readiness');
  expect(r.name).toBe(name);
  // WARN-never-fail: it must never hard-fail a clean tree.
  expect(['pass', 'warn', 'skip']).toContain(r.status);
  expect(typeof r.detail).toBe('string');
  expect((r.detail ?? '').length).toBeGreaterThan(0);
  if (r.status === 'warn') {
    expect(r.fix ?? '').toContain('oj setup');
  } else {
    // tier-1 satisfied on this runner — nothing to assert about fixes.
    expect(r.status).toBe('pass');
  }
// Toolchain probes can initialize rustup on a fresh CI runner. Keep this
// bounded, but allow more than Bun's five-second default for that real work.
}, 30_000);
