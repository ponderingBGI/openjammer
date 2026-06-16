// scripts/oj/lib/git.ts — thin git helpers over Bun.$. Every call tolerates a
// non-repo / git-absent environment by returning a degraded-but-safe value
// instead of throwing, so the doctor can still run on a bare checkout.

import { $ } from 'bun';

/** True when the current working directory is inside a git work tree. */
export async function isGitRepo(): Promise<boolean> {
  try {
    const out = await $`git rev-parse --is-inside-work-tree`.quiet();
    return out.text().trim() === 'true';
  } catch {
    return false;
  }
}

/** True when the working tree has no staged/unstaged changes (and is a repo). */
export async function isCleanTree(): Promise<boolean> {
  if (!(await isGitRepo())) return false;
  try {
    const out = await $`git status --porcelain`.quiet();
    return out.text().trim().length === 0;
  } catch {
    return false;
  }
}

/** Paths currently staged (added to the index). Empty list if not a repo. */
export async function stagedFiles(): Promise<string[]> {
  if (!(await isGitRepo())) return [];
  try {
    const out = await $`git diff --cached --name-only --diff-filter=ACMR`.quiet();
    return splitLines(out.text());
  } catch {
    return [];
  }
}

/**
 * Paths changed versus a base ref (default origin/main). Falls back to `main`
 * if origin/main is unknown; returns [] if neither resolves. Includes the merge
 * base so feature-branch diffs are accurate rather than picking up base churn.
 */
export async function changedVsBase(base = 'origin/main'): Promise<string[]> {
  if (!(await isGitRepo())) return [];
  const ref = (await refExists(base)) ? base : (await refExists('main')) ? 'main' : null;
  if (!ref) return [];
  try {
    // `git diff ref...HEAD` uses the merge base, the affected-selection intent.
    const out = await $`git diff --name-only ${ref}...HEAD`.quiet();
    return splitLines(out.text());
  } catch {
    return [];
  }
}

/** All tracked files (used as the credentials-scan fallback in a clean repo). */
export async function trackedFiles(): Promise<string[]> {
  if (!(await isGitRepo())) return [];
  try {
    const out = await $`git ls-files`.quiet();
    return splitLines(out.text());
  } catch {
    return [];
  }
}

async function refExists(ref: string): Promise<boolean> {
  try {
    await $`git rev-parse --verify --quiet ${ref}`.quiet();
    return true;
  } catch {
    return false;
  }
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
