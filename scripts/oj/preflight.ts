// scripts/oj/preflight.ts — the affected-selection layer. Maps the files changed
// vs the base ref (origin/main) to the subset of `just` recipes that need to run,
// shells to `just` via Bun.$, and uses a content-addressed cache so an unchanged
// recipe input set is a no-op.
//
//   preflight              run the affected recipes (skipping cache hits)
//   preflight --affected   alias for the default (explicit selection)
//   preflight --plan       DRY: print the selected recipes, run nothing
//
// just / cargo may be ABSENT locally (the maintainer rig has neither). A dry
// --plan must NEVER crash on that; a real run reports a clear message and skips
// the recipe rather than throwing.

import { $ } from 'bun';
import { changedVsBase } from './lib/git';
import { recipeHash, isCached, markCached } from './lib/cache';

// rust-toolchain.toml is an ALWAYS_INPUT to every recipe hash so a toolchain
// bump busts the cache. (The file may not exist yet; cache.ts tolerates that.)
const ALWAYS_INPUTS = ['rust-toolchain.toml', 'justfile'];

interface RecipeSpec {
  /** The `just` recipe name. */
  recipe: string;
  /** Repo-relative input files whose bytes feed the cache hash. */
  inputs: string[];
  /** Predicate: does this changed-file set select this recipe? */
  selects: (changed: string[]) => boolean;
}

const norm = (p: string) => p.replace(/\\/g, '/');
const anyMatch = (changed: string[], pred: (p: string) => boolean) =>
  changed.map(norm).some(pred);

// Paths that affect NEITHER CI leg (the engine workspace or the web control
// plane): docs have their own Docs workflow; markdown/meta files gate nothing.
// CONSERVATIVE on purpose — anything NOT listed here and NOT mapped to a recipe
// is treated as "unrecognized" and forces the FULL gate (fail closed), so a new
// kind of input can never silently skip a leg.
const ciIrrelevant = (p: string): boolean =>
  p.endsWith('.md') ||
  p.startsWith('docs/') ||
  p.startsWith('apps/docs/') ||
  p === 'LICENSE' ||
  p === '.gitignore' ||
  p === '.gitattributes' ||
  p === 'CODEOWNERS' ||
  p.startsWith('.github/ISSUE_TEMPLATE/');

// The mapping from changed files -> just recipes. Conservative: when in doubt,
// select the recipe (a false-positive is a wasted-but-correct run; a false
// negative would skip a needed gate).
const RECIPES: RecipeSpec[] = [
  {
    recipe: 'fmt',
    inputs: ['Cargo.toml', 'Cargo.lock'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/') || p.startsWith('src-tauri/')),
  },
  {
    recipe: 'clippy',
    inputs: ['Cargo.toml', 'Cargo.lock'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/') || p.startsWith('src-tauri/')),
  },
  {
    recipe: 'test',
    inputs: ['Cargo.toml', 'Cargo.lock', '.config/nextest.toml'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/') || p.startsWith('src-tauri/')),
  },
  {
    recipe: 'doctest',
    inputs: ['Cargo.toml', 'Cargo.lock'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/')),
  },
  {
    recipe: 'nostd',
    inputs: ['crates/ojcore/Cargo.toml'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/ojcore/') || p.startsWith('crates/ojproto/')),
  },
  {
    recipe: 'wasm',
    inputs: ['rust-toolchain.toml', 'crates/ojcore-wasm/Cargo.toml'],
    selects: (c) =>
      anyMatch(c, (p) => p.startsWith('crates/ojcore-wasm/') || p.startsWith('crates/ojcore/')),
  },
  {
    recipe: 'render',
    inputs: ['crates/ojcore-native/Cargo.toml'],
    selects: (c) =>
      anyMatch(c, (p) => p.startsWith('crates/ojcore-native/') || p.startsWith('crates/ojinstrument/')),
  },
  {
    recipe: 'clap-host',
    inputs: ['crates/ojhost/Cargo.toml'],
    selects: (c) => anyMatch(c, (p) => p.startsWith('crates/ojhost/')),
  },
  {
    recipe: 'web',
    inputs: ['package.json', 'bun.lock', 'tsconfig.app.json'],
    // The web job runs typecheck + lint + unit tests + production build + the
    // Playwright PWA smoke test, so its inputs are the whole TS/JS app AND its
    // tooling: source, packages, the e2e suite, public assets baked into the
    // bundle, the HTML entry, and every build/test/lint config. (e2e/ and the
    // configs were previously unmapped — an e2e-only change skipped the gate.)
    selects: (c) =>
      anyMatch(
        c,
        (p) =>
          p.startsWith('src/') ||
          p.startsWith('packages/') ||
          p.startsWith('public/') ||
          p.startsWith('e2e/') ||
          p === 'index.html' ||
          p === 'package.json' ||
          p === 'bun.lock' ||
          p.startsWith('tsconfig') ||
          p === 'vite.config.ts' ||
          p === 'vitest.config.ts' ||
          p === 'playwright.config.ts' ||
          p === 'eslint.config.js',
      ),
  },
];

export interface PreflightArgs {
  json: boolean;
  plan: boolean; // dry-run: print selection only
  base?: string; // base ref, default origin/main
}

interface Selection {
  recipe: string;
  inputs: string[];
}

/**
 * Compute which recipes the changed-file set selects (registry order).
 *
 * `ok` is false when the diff was UNTRUSTWORTHY (base unresolvable / shallow /
 * git error) — callers must then run the FULL gate, never skip. `unrecognized`
 * lists changed files that map to no recipe and are not known CI-irrelevant; a
 * non-empty list also forces the full gate (a file of unknown impact may affect
 * a leg the mapping doesn't model yet).
 */
export async function selectRecipes(base?: string): Promise<{
  ok: boolean;
  changed: string[];
  selected: Selection[];
  unrecognized: string[];
}> {
  let changed: string[];
  try {
    changed = await changedVsBase(base ?? 'origin/main');
  } catch {
    return { ok: false, changed: [], selected: [], unrecognized: [] };
  }
  const selected: Selection[] = [];
  for (const spec of RECIPES) {
    if (spec.selects(changed)) {
      selected.push({ recipe: spec.recipe, inputs: dedupe([...spec.inputs, ...ALWAYS_INPUTS]) });
    }
  }
  const unrecognized = changed
    .map(norm)
    .filter((p) => !ciIrrelevant(p) && !RECIPES.some((spec) => spec.selects([p])));
  return { ok: true, changed, selected, unrecognized };
}

async function justPresent(): Promise<boolean> {
  try {
    const out = await $`just --version`.quiet().nothrow();
    return out.exitCode === 0;
  } catch {
    return false;
  }
}

export async function preflight(args: PreflightArgs): Promise<number> {
  const { ok, changed, selected, unrecognized } = await selectRecipes(args.base);

  if (args.plan) {
    if (args.json) {
      process.stdout.write(
        JSON.stringify(
          {
            mode: 'plan',
            ok, // false => untrustworthy diff => CI MUST run the full gate
            base: args.base ?? 'origin/main',
            changedCount: changed.length,
            recipes: selected.map((s) => s.recipe),
            unrecognizedCount: unrecognized.length,
            unrecognized: unrecognized.slice(0, 20),
          },
          null,
          2,
        ) + '\n',
      );
      // Non-zero exit on an untrustworthy plan so the CI fail-safe runs everything.
      return ok ? 0 : 1;
    }
    process.stdout.write('oj preflight --plan (dry run; nothing executed)\n');
    process.stdout.write(`base: ${args.base ?? 'origin/main'}\n`);
    if (!ok) {
      process.stdout.write('plan: UNTRUSTWORTHY (could not diff vs base) — CI runs the full gate.\n');
      return 1;
    }
    process.stdout.write(`changed files: ${changed.length}\n`);
    if (unrecognized.length > 0) {
      process.stdout.write(
        `unrecognized (forces full gate): ${unrecognized.slice(0, 20).join(', ')}\n`,
      );
    }
    if (selected.length === 0) {
      process.stdout.write('selected recipes: (none — no affected recipes)\n');
    } else {
      process.stdout.write('selected recipes (just):\n');
      for (const s of selected) process.stdout.write(`  - just ${s.recipe}\n`);
    }
    return 0;
  }

  // Real run. A degraded/untrustworthy diff locally is non-fatal — CI is the
  // authoritative gate; just don't run a misleading partial selection.
  if (!ok) {
    process.stdout.write(
      'oj preflight: could not determine changes vs base (origin/main?). ' +
        'Skipping local run — CI is authoritative.\n',
    );
    return 0;
  }
  const haveJust = await justPresent();
  if (!haveJust) {
    process.stdout.write(
      'oj preflight: `just` is not installed; cannot run recipes locally.\n' +
        'This is expected on a non-Rust rig — CI is authoritative. Selected recipes were:\n',
    );
    for (const s of selected) process.stdout.write(`  - just ${s.recipe}\n`);
    return 0; // not a failure: degraded-but-safe
  }

  let failures = 0;
  for (const s of selected) {
    const hash = await recipeHash(s.recipe, s.inputs);
    if (await isCached(hash)) {
      process.stdout.write(`[cache hit] just ${s.recipe}\n`);
      continue;
    }
    process.stdout.write(`[run] just ${s.recipe}\n`);
    try {
      const out = await $`just ${s.recipe}`.nothrow();
      if (out.exitCode === 0) {
        await markCached(hash);
      } else {
        failures += 1;
        process.stderr.write(`[fail] just ${s.recipe} exited ${out.exitCode}\n`);
      }
    } catch (e) {
      failures += 1;
      process.stderr.write(`[error] just ${s.recipe}: ${(e as Error).message}\n`);
    }
  }

  return failures > 0 ? 1 : 0;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
