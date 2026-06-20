// scripts/oj/doctor.ts — the check registry + runner.
//
//   doctor                      run the full check set
//   doctor --check <id>         run exactly one check
//   doctor --from-files <a> <b> route a staged-file set to the affected check subset
//   doctor --fix                pass --fix to checks that support it (version-sync, docs-accuracy)
//   doctor --json               machine-readable report
//
// Each check is a module exposing { id, name, run(opts) }. The registry is the
// single source of which checks exist. --from-files maps each path to a subset
// for fast pre-commit feedback; credentials always runs.

import type { CheckResult } from './lib/report';
import { renderReport } from './lib/report';
import { stagedFiles } from './lib/git';

import * as versionSync from './checks/version-sync';
import * as credentials from './checks/credentials';
import * as coiHeaders from './checks/coi-headers';
import * as docsAccuracy from './checks/docs-accuracy';
import * as toolchain from './checks/toolchain';
import * as nativeReadiness from './checks/native-readiness';
import * as protocolMirror from './checks/protocol-mirror';
import * as nodeRegistry from './checks/node-registry';
import * as ssotSetEquality from './checks/ssot-set-equality';

export interface RunOpts {
  fix?: boolean;
  fromFiles?: string[];
}

interface CheckModule {
  id: string;
  name: string;
  run: (opts: { fix?: boolean; fromFiles?: string[] }) => Promise<CheckResult>;
}

// The registry — ordered for a sensible full-run report.
export const REGISTRY: CheckModule[] = [
  versionSync,
  credentials,
  coiHeaders,
  docsAccuracy,
  toolchain,
  nativeReadiness,
  protocolMirror,
  nodeRegistry,
  ssotSetEquality,
];

const REGISTRY_BY_ID = new Map(REGISTRY.map((c) => [c.id, c]));

/** Run a single check by id, applying fix/fromFiles where the check supports it. */
async function runOne(c: CheckModule, opts: RunOpts): Promise<CheckResult> {
  return c.run({ fix: opts.fix, fromFiles: opts.fromFiles });
}

/**
 * Resolve which check ids apply to a set of staged paths. credentials always
 * runs. Unmatched paths contribute no checks. Returns a de-duplicated, registry-
 * ordered id list.
 */
export function checksForFiles(paths: string[]): string[] {
  const ids = new Set<string>();
  ids.add('credentials'); // always

  const norm = (p: string) => p.replace(/\\/g, '/');
  for (const raw of paths) {
    const p = norm(raw);

    // version files -> version-sync
    if (
      p === 'Cargo.toml' ||
      p === 'package.json' ||
      p === 'src-tauri/tauri.conf.json' ||
      p === 'packages/oj-protocol-ts/package.json'
    ) {
      ids.add('version-sync');
    }

    // vite.config / dist / vercel / _headers -> coi-headers
    if (
      p === 'vite.config.ts' ||
      p.startsWith('dist/') ||
      p === 'vercel.json' ||
      p === '_headers' ||
      p.endsWith('/_headers')
    ) {
      ids.add('coi-headers');
    }

    // ojproto or oj-protocol-ts -> protocol-mirror
    if (p.startsWith('crates/ojproto/') || p.startsWith('packages/oj-protocol-ts/')) {
      ids.add('protocol-mirror');
    }

    // docs/creating-nodes.md or src/engine or src/components/Nodes
    //   -> docs-accuracy + node-registry
    if (
      p === 'docs/creating-nodes.md' ||
      p.startsWith('src/engine/') ||
      p.startsWith('src/components/Nodes/')
    ) {
      ids.add('docs-accuracy');
      ids.add('node-registry');
    }

    // native-build surfaces (Tauri shell, native engine, toolchain pin)
    //   -> native-readiness
    if (
      p.startsWith('src-tauri/') ||
      p.startsWith('crates/ojcore-native/') ||
      p === 'rust-toolchain.toml' ||
      p === 'scripts/oj/lib/prereqs.ts'
    ) {
      ids.add('native-readiness');
    }
  }

  // Return in registry order for a stable report.
  return REGISTRY.filter((c) => ids.has(c.id)).map((c) => c.id);
}

export interface DoctorArgs {
  json: boolean;
  fix: boolean;
  check?: string; // single check id
  fromFiles: boolean; // route by staged / provided files
  files?: string[]; // explicit file list (else read staged)
}

/** Entry point invoked by index.ts. Returns the process exit code. */
export async function doctor(args: DoctorArgs): Promise<number> {
  const opts: RunOpts = { fix: args.fix };

  let toRun: CheckModule[];

  if (args.check) {
    const c = REGISTRY_BY_ID.get(args.check);
    if (!c) {
      const known = REGISTRY.map((x) => x.id).join(', ');
      process.stderr.write(`unknown check "${args.check}". known checks: ${known}\n`);
      return 2;
    }
    toRun = [c];
  } else if (args.fromFiles) {
    const files = args.files && args.files.length > 0 ? args.files : await stagedFiles();
    opts.fromFiles = files;
    const ids = checksForFiles(files);
    toRun = REGISTRY.filter((c) => ids.includes(c.id));
    if (toRun.length === 0) {
      // No matched checks (and credentials always matches, so this is only the
      // empty-input case). Report nothing-to-do as a clean pass.
      return renderReport(
        [
          {
            id: 'from-files',
            name: 'affected-selection',
            status: 'pass',
            detail: 'no staged files mapped to any doctor check.',
          },
        ],
        args.json,
      );
    }
  } else {
    toRun = REGISTRY;
  }

  const results: CheckResult[] = [];
  for (const c of toRun) {
    try {
      results.push(await runOne(c, opts));
    } catch (e) {
      // A check throwing must degrade to a fail line, never crash the CLI.
      results.push({
        id: c.id,
        name: c.name,
        status: 'fail',
        detail: `check threw: ${(e as Error).message}`,
      });
    }
  }

  return renderReport(results, args.json);
}
