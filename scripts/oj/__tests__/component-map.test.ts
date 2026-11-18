// scripts/oj/__tests__/component-map.test.ts — the committed component-map.json is
// a set of LINKS, and a link that only works on the machine that generated it is
// not a link.
//
// `codePath` is read by the docs "Find the code" index and glued onto a
// github.com/blob URL to make `githubUrl`, so both have to be repo-relative and
// POSIX-separated on every host. `scripts/oj/design.ts` used to strip a literal
// `${ROOT}/` prefix from the Code Connect file path; `ROOT` comes from `join`,
// so on Windows the prefix never matched and every entry regenerated as an
// absolute `C:\Users\...\Button.tsx` — a map that silently broke the moment a
// Windows contributor ran `bun scripts/oj/index.ts design map`.

import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const map = JSON.parse(readFileSync(join(ROOT, 'component-map.json'), 'utf8')) as {
  coverage: { components: number; withStory: number; withFigma: number };
  components: Array<{ name: string; codePath: string; githubUrl: string; ladleStoryId: string | null; figmaNodeId: string }>;
};

test('every codePath is repo-relative, POSIX-separated, and points at a real file', () => {
  const broken = map.components.filter(
    (c) =>
      c.codePath === '' ||
      c.codePath.includes('\\') ||
      /^[A-Za-z]:/.test(c.codePath) ||
      c.codePath.startsWith('/') ||
      !existsSync(join(ROOT, c.codePath)),
  );
  expect(broken.map((c) => `${c.name}: ${c.codePath}`)).toEqual([]);
});

test('every githubUrl is that same path on the blob URL', () => {
  const wrong = map.components.filter((c) => !c.githubUrl.endsWith(`/${c.codePath}`));
  expect(wrong.map((c) => c.name)).toEqual([]);
});

test('the coverage counts describe the components actually listed', () => {
  expect(map.coverage.components).toBe(map.components.length);
  expect(map.coverage.withStory).toBe(map.components.filter((c) => c.ladleStoryId).length);
  expect(map.coverage.withFigma).toBe(map.components.filter((c) => c.figmaNodeId).length);
});

test('a component that publishes a `states` story links to THAT one', () => {
  // `states` is the canonical overview a Figma reviewer wants to land on; the
  // fallback is only "first id in sort order", which quietly moved Button from
  // `button--states` to `button--loading` when a loading story was added.
  const stateful = map.components.filter((c) => c.ladleStoryId?.endsWith('--states'));
  expect(stateful.length).toBeGreaterThan(10);
  const button = map.components.find((c) => c.name === 'Button');
  expect(button?.ladleStoryId).toBe('primitives--button--states');
});
