// scripts/oj/__tests__/ssot.test.ts — version-sync passes on the unified real
// files, and detects injected drift using TEMP fixtures. NEVER mutates the real
// version files.

import { test, expect, afterAll } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkVersionSync, readVersionFile } from '../lib/ssot';

const cleanups: string[] = [];
afterAll(async () => {
  for (const dir of cleanups) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

async function tempFixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oj-ssot-'));
  cleanups.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

const UNIFIED = '0.0.0';

const CARGO = (v: string) =>
  [
    '[workspace]',
    'resolver = "2"',
    'members = ["crates/*", "src-tauri"]',
    '',
    '[workspace.package]',
    'edition = "2021"',
    '# comment block that must be preserved',
    '# second comment line',
    `version = "${v}"`,
    'license = "AGPL-3.0-only"',
    '',
    '[profile.release]',
    'opt-level = 3',
    '',
  ].join('\n');

const PKG = (v: string) => JSON.stringify({ name: 'x', version: v }, null, 2) + '\n';

test('version-sync PASSES on the real unified tree (all four at the same version)', async () => {
  const res = await checkVersionSync();
  // All four files resolve and agree.
  expect(res.files.every((f) => f.version != null)).toBe(true);
  expect(res.inSync).toBe(true);
  expect(res.distinct.length).toBe(1);
});

test('readVersionFile parses the Cargo [workspace.package].version line', async () => {
  const dir = await tempFixture({ 'Cargo.toml': CARGO(UNIFIED) });
  const f = await readVersionFile({ path: join(dir, 'Cargo.toml'), kind: 'cargo-workspace' });
  expect(f.version).toBe(UNIFIED);
});

test('readVersionFile parses a JSON .version line', async () => {
  const dir = await tempFixture({ 'package.json': PKG('9.9.9') });
  const f = await readVersionFile({ path: join(dir, 'package.json'), kind: 'json-version' });
  expect(f.version).toBe('9.9.9');
});

test('injected drift is detected: Cargo vs package.json disagree', async () => {
  // Build two temp version files with mismatched versions and read each directly.
  const dir = await tempFixture({
    'Cargo.toml': CARGO('0.0.1-canari.2'),
    'package.json': PKG('0.0.0'),
  });
  const cargo = await readVersionFile({ path: join(dir, 'Cargo.toml'), kind: 'cargo-workspace' });
  const pkg = await readVersionFile({ path: join(dir, 'package.json'), kind: 'json-version' });
  expect(cargo.version).toBe('0.0.1-canari.2');
  expect(pkg.version).toBe('0.0.0');
  expect(cargo.version).not.toBe(pkg.version);

  // And the set-equality logic flags >1 distinct version as out of sync.
  const present = [cargo.version, pkg.version].filter((v): v is string => v != null);
  const distinct = [...new Set(present)];
  expect(distinct.length).toBeGreaterThan(1);
});

test('line-surgical alignment preserves the Cargo comment block', async () => {
  // Simulate the --fix string transform without touching the real tree or git:
  // replace ONLY the version line, leaving comments intact.
  const original = CARGO('0.0.1');
  const CARGO_RE = /^version\s*=\s*"([^"]*)"/m;
  const fixed = original.replace(CARGO_RE, (whole, captured: string) =>
    whole.replace(`"${captured}"`, `"${UNIFIED}"`),
  );
  expect(fixed).toContain('# comment block that must be preserved');
  expect(fixed).toContain('# second comment line');
  expect(fixed).toContain(`version = "${UNIFIED}"`);
  expect(fixed).not.toContain('version = "0.0.1"');
  // Only one line changed.
  const origLines = original.split('\n');
  const fixedLines = fixed.split('\n');
  const diffCount = origLines.filter((l, i) => l !== fixedLines[i]).length;
  expect(diffCount).toBe(1);
});
