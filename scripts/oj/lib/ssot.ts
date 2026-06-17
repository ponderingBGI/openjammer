// scripts/oj/lib/ssot.ts — version-sync as a CONSISTENCY check (NEVER an
// independent SSOT). Release automation owns the version bump and writes all
// four files in lockstep; this module only asserts the four files are EQUAL and
// `--fix` only ALIGNS them to the chosen canonical value. It never mints a new
// version.
//
// The four version sources (verified):
//   1. Cargo.toml            -> [workspace.package].version (after a comment block)
//   2. package.json          -> .version (top-level, line 3)
//   3. src-tauri/tauri.conf.json -> .version (line 4)
//   4. packages/oj-protocol-ts/package.json -> .version (line 3)
//
// --fix is LINE-SURGICAL: it replaces only the single version line in each file,
// preserving every surrounding comment and the file's exact formatting. It never
// re-serializes JSON/TOML. It is gated on a clean git tree by the caller.

import { resolve } from 'node:path';
import { isCleanTree } from './git';

export interface VersionFile {
  /** Repo-relative path. */
  path: string;
  /** Kind drives which line-surgical regex applies. */
  kind: 'cargo-workspace' | 'json-version';
  /** The version read out of the file, or null if it could not be found. */
  version: string | null;
}

export const VERSION_FILES: { path: string; kind: VersionFile['kind'] }[] = [
  { path: 'Cargo.toml', kind: 'cargo-workspace' },
  { path: 'package.json', kind: 'json-version' },
  { path: 'src-tauri/tauri.conf.json', kind: 'json-version' },
  { path: 'packages/oj-protocol-ts/package.json', kind: 'json-version' },
];

// Matches the FIRST top-level `version = "..."` line in [workspace.package].
// The repo's Cargo.toml has no other top-level `version` key, so a multiline
// search for `^version = "..."` (start-of-line) targets exactly Cargo.toml:13.
const CARGO_VERSION_RE = /^version\s*=\s*"([^"]*)"/m;

// Matches the first `"version": "..."` member in a package/tauri JSON file.
const JSON_VERSION_RE = /"version"\s*:\s*"([^"]*)"/;

function versionRegexFor(kind: VersionFile['kind']): RegExp {
  return kind === 'cargo-workspace' ? CARGO_VERSION_RE : JSON_VERSION_RE;
}

/** Read one version file (no mutation). */
export async function readVersionFile(
  spec: { path: string; kind: VersionFile['kind'] },
): Promise<VersionFile> {
  let text: string;
  try {
    text = await Bun.file(resolve(spec.path)).text();
  } catch {
    return { path: spec.path, kind: spec.kind, version: null };
  }
  const m = text.match(versionRegexFor(spec.kind));
  return { path: spec.path, kind: spec.kind, version: m ? (m[1] ?? null) : null };
}

/** Read all four version files. */
export async function readAllVersions(): Promise<VersionFile[]> {
  return Promise.all(VERSION_FILES.map(readVersionFile));
}

export interface VersionSyncResult {
  /** All distinct non-null versions seen across the four files. */
  distinct: string[];
  /** True when every file resolved to the same single version. */
  inSync: boolean;
  /** The canonical version (the Cargo workspace seed) when resolvable. */
  canonical: string | null;
  files: VersionFile[];
}

/**
 * Compute sync status. Canonical is the Cargo `[workspace.package].version`
 * (the release automation seed); if Cargo is unreadable we fall back to the most
 * common value just so --fix has a target, but inSync is computed strictly.
 */
export async function checkVersionSync(): Promise<VersionSyncResult> {
  const files = await readAllVersions();
  const present = files.map((f) => f.version).filter((v): v is string => v != null);
  const distinct = [...new Set(present)];
  const inSync = files.every((f) => f.version != null) && distinct.length === 1;

  const cargo = files.find((f) => f.kind === 'cargo-workspace');
  let canonical = cargo?.version ?? null;
  if (canonical == null) canonical = mostCommon(present);

  return { distinct, inSync, canonical, files };
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export interface FixOutcome {
  ok: boolean;
  /** Files whose version line was rewritten. */
  changed: string[];
  /** Why the fix was refused / partially applied. */
  message?: string;
}

/**
 * LINE-SURGICAL alignment of all four files to `target` (defaults to the Cargo
 * canonical). Gated on a clean git tree. Replaces ONLY the matched version line;
 * never re-serializes. Returns the list of files actually modified.
 */
export async function fixVersionSync(target?: string): Promise<FixOutcome> {
  if (!(await isCleanTree())) {
    return {
      ok: false,
      changed: [],
      message:
        'refusing to --fix version-sync: working tree is not clean (line-surgical edits require a clean tree).',
    };
  }

  const current = await checkVersionSync();
  const want = target ?? current.canonical;
  if (!want) {
    return { ok: false, changed: [], message: 'no canonical version could be resolved.' };
  }

  const changed: string[] = [];
  for (const f of current.files) {
    if (f.version === want) continue; // already aligned (or null handled below)
    const abs = resolve(f.path);
    let text: string;
    try {
      text = await Bun.file(abs).text();
    } catch {
      continue; // missing file — nothing to align
    }
    const re = versionRegexFor(f.kind);
    if (!re.test(text)) continue;
    const next = text.replace(re, (whole, captured: string) =>
      whole.replace(`"${captured}"`, `"${want}"`),
    );
    if (next !== text) {
      await Bun.write(abs, next);
      changed.push(f.path);
    }
  }

  return { ok: true, changed };
}
