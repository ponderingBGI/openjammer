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
    selects: (c) =>
      anyMatch(
        c,
        (p) =>
          p.startsWith('src/') ||
          p.startsWith('packages/') ||
          p === 'package.json' ||
          p === 'bun.lock' ||
          p.startsWith('tsconfig') ||
          p === 'vite.config.ts',
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

/** Compute which recipes the changed-file set selects (registry order). */
export async function selectRecipes(base?: string): Promise<{
  changed: string[];
  selected: Selection[];
}> {
  const changed = await changedVsBase(base ?? 'origin/main');
  const selected: Selection[] = [];
  for (const spec of RECIPES) {
    if (spec.selects(changed)) {
      selected.push({ recipe: spec.recipe, inputs: dedupe([...spec.inputs, ...ALWAYS_INPUTS]) });
    }
  }
  return { changed, selected };
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
  const { changed, selected } = await selectRecipes(args.base);

  if (args.plan) {
    if (args.json) {
      process.stdout.write(
        JSON.stringify(
          {
            mode: 'plan',
            base: args.base ?? 'origin/main',
            changedCount: changed.length,
            recipes: selected.map((s) => s.recipe),
          },
          null,
          2,
        ) + '\n',
      );
      return 0;
    }
    process.stdout.write('oj preflight --plan (dry run; nothing executed)\n');
    process.stdout.write(`base: ${args.base ?? 'origin/main'}\n`);
    process.stdout.write(`changed files: ${changed.length}\n`);
    if (selected.length === 0) {
      process.stdout.write('selected recipes: (none — no affected recipes)\n');
    } else {
      process.stdout.write('selected recipes (just):\n');
      for (const s of selected) process.stdout.write(`  - just ${s.recipe}\n`);
    }
    return 0;
  }

  // Real run.
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
