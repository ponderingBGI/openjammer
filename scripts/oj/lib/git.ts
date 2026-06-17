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
 * Paths changed versus a base ref (default origin/main), using the merge base so
 * feature-branch diffs are accurate rather than picking up base churn.
 *
 * THROWS when the diff is untrustworthy — the base ref can't be resolved, or
 * `git diff` fails (e.g. a shallow clone whose merge base is unreachable). The
 * affected-selection caller MUST treat a throw as "unknown → run everything",
 * never as "no changes": a silently-empty changeset would skip every gated leg
 * (the exact bug that let a broken test merge). Returns [] ONLY for a genuinely
 * empty diff against a resolved base.
 */
export async function changedVsBase(base = 'origin/main'): Promise<string[]> {
  if (!(await isGitRepo())) throw new Error('oj: not inside a git work tree');
  const ref = (await refExists(base))
    ? base
    : (await refExists('origin/main'))
      ? 'origin/main'
      : (await refExists('main'))
        ? 'main'
        : null;
  if (!ref) throw new Error(`oj: base ref not found (${base})`);
  // `.quiet()` still throws on a non-zero git exit (e.g. an unreachable merge
  // base under a shallow clone) — let it propagate so the caller fails CLOSED.
  const out = await $`git diff --name-only ${ref}...HEAD`.quiet();
  return splitLines(out.text());
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
