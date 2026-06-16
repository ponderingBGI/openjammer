// scripts/oj/checks/credentials.ts — scan files for secret-bearing patterns and
// FAIL if any are found. Scans staged files when in a git repo; otherwise scans
// all tracked files (and falls back to nothing if not a repo at all). Pure TS.
//
// Patterns (verified against docs/plans/07-reference-configs.md §2 + the brief):
//   - filename globs: *.key, openjammer.key, *.pem, *.p12, *.pfx, *.minisign
//   - path prefix:    anything under .tauri/
//   - content regex:  a `-----BEGIN ... PRIVATE KEY-----` block

import type { CheckResult } from '../lib/report';
import { isGitRepo, stagedFiles, trackedFiles } from '../lib/git';
import { resolve } from 'node:path';

export const id = 'credentials';
export const name = 'No signing keys / secrets staged';

// Content marker: PEM-style private key header (RSA/EC/OPENSSH/PGP/plain).
export const PRIVATE_KEY_BLOCK_RE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

const SECRET_FILENAME_RE = /(?:^|[\\/])openjammer\.key$|\.(?:key|pem|p12|pfx|minisign)$/i;

/** True if a repo-relative path matches a secret filename glob / .tauri/ prefix. */
export function isSecretPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  if (norm === '.tauri' || norm.startsWith('.tauri/') || norm.includes('/.tauri/')) {
    return true;
  }
  return SECRET_FILENAME_RE.test(norm);
}

/** True if file contents contain a PEM private-key block. */
export function containsPrivateKeyBlock(text: string): boolean {
  return PRIVATE_KEY_BLOCK_RE.test(text);
}

export async function run(opts: { fromFiles?: string[] } = {}): Promise<CheckResult> {
  let candidates: string[];
  let scope: string;

  if (opts.fromFiles && opts.fromFiles.length > 0) {
    candidates = opts.fromFiles;
    scope = 'provided files';
  } else if (await isGitRepo()) {
    const staged = await stagedFiles();
    if (staged.length > 0) {
      candidates = staged;
      scope = 'staged files';
    } else {
      candidates = await trackedFiles();
      scope = 'tracked files';
    }
  } else {
    candidates = [];
    scope = 'no git repo';
  }

  const offenders: string[] = [];

  for (const rel of candidates) {
    if (isSecretPath(rel)) {
      offenders.push(`${rel} (secret filename / .tauri path)`);
      continue;
    }
    // Content scan — best effort; skip binaries / unreadable files quietly.
    try {
      const file = Bun.file(resolve(rel));
      if (!(await file.exists())) continue;
      // Only scan reasonably small files to keep the pre-commit budget low.
      if (file.size > 2_000_000) continue;
      const text = await file.text();
      if (containsPrivateKeyBlock(text)) {
        offenders.push(`${rel} (contains BEGIN ... PRIVATE KEY block)`);
      }
    } catch {
      // Unreadable / binary — not a text secret we can detect; ignore.
    }
  }

  if (offenders.length > 0) {
    return {
      id,
      name,
      status: 'fail',
      detail: [`scope: ${scope}`, 'secret-bearing files detected:', ...offenders].join('\n'),
      fix: 'remove these from the commit and ensure the .gitignore key patterns cover them; never commit signing keys.',
    };
  }

  return {
    id,
    name,
    status: 'pass',
    detail: `scope: ${scope}; scanned ${candidates.length} file(s); no secrets found`,
  };
}
