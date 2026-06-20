// scripts/oj/__tests__/prereqs-ssot.test.ts — the anti-drift guard. The Debian
// system-lib set in lib/prereqs.ts MUST equal the apt list CI installs in
// .github/actions/setup-rust/action.yml, so `oj setup` and CI can never diverge.
// (Same spirit as the ssot-set-equality doctor check.)

import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { DEBIAN_TAURI_LIBS } from '../lib/prereqs';

const SETUP_RUST = resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  '.github',
  'actions',
  'setup-rust',
  'action.yml',
);

/** Extract the package tokens from the `sudo apt-get install -y ... \` block. */
async function aptPackagesFromCi(): Promise<string[]> {
  const text = await Bun.file(SETUP_RUST).text();
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('apt-get install'));
  if (start === -1) throw new Error('no `apt-get install` line in setup-rust/action.yml');

  // Join the command + its backslash-continued lines.
  let cmd = '';
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    cmd += ' ' + raw.replace(/\\\s*$/, '').trim();
    if (!/\\\s*$/.test(raw)) break;
  }
  const drop = new Set(['sudo', 'apt-get', 'install', '-y']);
  return cmd
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !drop.has(t));
}

test('prereqs.ts Debian libs == the CI apt list (no drift)', async () => {
  const ci = new Set(await aptPackagesFromCi());
  const ours = new Set<string>(DEBIAN_TAURI_LIBS);

  // Set-equality both ways, with a readable diff on failure.
  const missingFromOurs = [...ci].filter((p) => !ours.has(p));
  const extraInOurs = [...ours].filter((p) => !ci.has(p));
  expect({ missingFromOurs, extraInOurs }).toEqual({ missingFromOurs: [], extraInOurs: [] });
});

test('the CI apt list is non-empty (extractor sanity)', async () => {
  expect((await aptPackagesFromCi()).length).toBeGreaterThan(0);
});
