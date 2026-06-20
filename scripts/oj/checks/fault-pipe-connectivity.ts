// scripts/oj/checks/fault-pipe-connectivity.ts — the fault-pipe wiring gate.
//
// The single most expensive bug class in OpenJammer is tested-but-uncalled code
// that passes a green CI: the engine emits Xrun/NodeFault/Lifecycle events, but
// for a long time NO frontend code called `poll_events` and `ingestEngineEvent`
// was only ever invoked from its OWN unit test — so a real dropout on stage died
// silently while every test stayed green. Wave 1 reconnected the pipe end-to-end
// (the dedicated drain in OjcoreNativeExecutor: `invoke('poll_events')` ->
// `coalesceEvents` -> `useLogStore.ingestEngineEvent`).
//
// This check makes that wire UN-CUTTABLE. It asserts, by reading production
// source (NOT tests), that BOTH ends of the fault pipe still have a real caller:
//   1. `ingestEngineEvent` is referenced in non-test production source (the ring
//      ingest is wired to something other than its own test), AND
//   2. the `poll_events` Tauri command has a frontend caller (the drain that
//      feeds that ingest still exists).
// If a future refactor re-orphans either end, this FAILS — the exact regression
// that let a silent-dropout ship green. Pure TS; mirrors the ssot-set-equality
// "read the SSOT, assert agreement" pattern.

import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { CheckResult } from '../lib/report';

export const id = 'fault-pipe-connectivity';
export const name = 'Fault pipe wired end-to-end (poll_events -> ingestEngineEvent)';

// The two production-source symbols that, together, prove the fault pipe is wired.
const INGEST_SYMBOL = 'ingestEngineEvent';
const POLL_COMMAND = 'poll_events';

// The frontend source root. Only .ts/.tsx production files are scanned; the
// definitions' own homes (logStore.ts declares ingestEngineEvent; the executor
// declares the drain) are EXCLUDED as call sites so the check proves an
// independent CALLER exists, not merely a declaration referencing itself.
const SRC_ROOT = 'src';

// Files whose `ingestEngineEvent` mention is its DEFINITION, not a call — so they
// do not count as "referenced by a caller". (logStore.ts declares the method.)
const INGEST_DEFINITION_FILES = ['src/store/logStore.ts'];

/** True when a path is a test/spec/fixture file (must NOT count as production). */
function isTestFile(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    p.includes('/__tests__/') ||
    p.includes('/__mocks__/') ||
    p.endsWith('/setupTests.ts') ||
    p.includes('/test/')
  );
}

/** True when a path is a TypeScript source file we should scan. */
function isTsSource(rel: string): boolean {
  return /\.[cm]?tsx?$/.test(rel);
}

/** Recursively collect production .ts/.tsx files under `dir` (POSIX-normalized). */
async function collectProductionFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(resolve(dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      out.push(...(await collectProductionFiles(rel)));
    } else if (isTsSource(rel) && !isTestFile(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Files (POSIX-relative) whose production source mentions `symbol`. */
async function filesReferencing(
  files: string[],
  symbol: string,
  exclude: string[] = [],
): Promise<string[]> {
  const excludeSet = new Set(exclude.map((p) => p.replace(/\\/g, '/')));
  const hits: string[] = [];
  for (const rel of files) {
    const posix = rel.replace(/\\/g, '/');
    if (excludeSet.has(posix)) continue;
    let text: string;
    try {
      text = await Bun.file(resolve(rel)).text();
    } catch {
      continue;
    }
    if (text.includes(symbol)) hits.push(posix);
  }
  return hits;
}

export async function run(): Promise<CheckResult> {
  const files = await collectProductionFiles(SRC_ROOT);
  if (files.length === 0) {
    return {
      id,
      name,
      status: 'fail',
      detail: `could not enumerate any production TypeScript under ${SRC_ROOT}/.`,
      fix: 'run this check from the repo root (the src/ frontend tree must exist).',
    };
  }

  // End 1: a production CALLER of ingestEngineEvent (excluding its own definition).
  const ingestCallers = await filesReferencing(files, INGEST_SYMBOL, INGEST_DEFINITION_FILES);
  // End 2: a production frontend caller of the poll_events Tauri command.
  const pollCallers = await filesReferencing(files, POLL_COMMAND);

  const problems: string[] = [];
  if (ingestCallers.length === 0) {
    problems.push(
      `\`${INGEST_SYMBOL}\` has NO production caller (only its definition / tests reference it) — ` +
        'the engine fault ring is not ingested into the DevLog. The fault pipe is cut: a dropout dies silently.',
    );
  }
  if (pollCallers.length === 0) {
    problems.push(
      `the \`${POLL_COMMAND}\` Tauri command has NO frontend caller — nothing drains the engine fault ring. ` +
        'The fault pipe is cut: faults never reach the frontend.',
    );
  }

  if (problems.length > 0) {
    return {
      id,
      name,
      status: 'fail',
      detail: problems.join('\n'),
      fix:
        'restore the dedicated fault drain in src/audio/executor/OjcoreNativeExecutor.ts: ' +
        `\`invoke('${POLL_COMMAND}')\` -> coalesceEvents -> \`useLogStore.${INGEST_SYMBOL}\`. ` +
        'The pipe must stay wired end-to-end (a green CI must never hide a silent-dropout regression).',
    };
  }

  return {
    id,
    name,
    status: 'pass',
    detail: [
      `\`${INGEST_SYMBOL}\` is called from production: ${ingestCallers.join(', ')}.`,
      `\`${POLL_COMMAND}\` has a frontend caller: ${pollCallers.join(', ')}.`,
      'The fault pipe is wired end-to-end (poll_events -> coalesce -> ring).',
    ].join('\n'),
  };
}
