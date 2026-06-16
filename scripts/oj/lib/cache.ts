// scripts/oj/lib/cache.ts — a tiny content-addressed success cache for the
// preflight layer. The key is sha256(recipe-name + the bytes of every input
// file). A hit means "this recipe already succeeded for this exact input set";
// we then skip re-running it. Markers live as empty files under .oj-cache/.
//
// This is deliberately minimal: no eviction, no metadata, no locking. The cache
// only ever turns a green run into a faster green run; a stale/missing entry just
// causes a (correct) re-run. cargo/just absence is handled by the caller.

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const CACHE_DIR = '.oj-cache';

/**
 * Compute the content hash for a recipe over a set of input files. Missing files
 * contribute a stable "<missing>" marker so the hash is deterministic regardless
 * of which inputs exist. ALWAYS_INPUTs (e.g. rust-toolchain.toml) can be passed
 * in `inputs` by the caller.
 */
export async function recipeHash(recipe: string, inputs: string[]): Promise<string> {
  const h = createHash('sha256');
  h.update(`recipe:${recipe}\n`);
  for (const rel of [...inputs].sort()) {
    h.update(`file:${rel}\n`);
    try {
      const bytes = await Bun.file(resolve(rel)).bytes();
      h.update(bytes);
    } catch {
      h.update('<missing>');
    }
    h.update('\n');
  }
  return h.digest('hex');
}

function markerPath(hash: string): string {
  return join(CACHE_DIR, `${hash}.ok`);
}

/** True when a success marker already exists for this hash. */
export async function isCached(hash: string): Promise<boolean> {
  try {
    return await Bun.file(markerPath(hash)).exists();
  } catch {
    return false;
  }
}

/** Record a success marker for this hash (best-effort; never throws). */
export async function markCached(hash: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(markerPath(hash), `ok ${new Date().toISOString()}\n`);
  } catch {
    // A cache write failure must never break a real run.
  }
}
