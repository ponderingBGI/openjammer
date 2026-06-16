// scripts/oj/checks/ssot-set-equality.ts — the D1 PrimitiveKind drift gate.
//
// `schemas/primitive-kinds.json` is the canonical flat list of the closed
// PrimitiveKind set. This check asserts the two OTHER node-readable declarations
// agree with it:
//   • the TS `PRIMITIVE_KINDS` tuple in packages/oj-protocol-ts/src/index.ts
//     (which the `PrimitiveKind` type derives from), and
//   • the `kind` enum in schemas/oj-plugin-v1.json.
// The third declaration — the Rust `ojproto::PrimitiveKind` enum — is pinned to
// the same list by `primitive_kind_matches_ssot_list` in
// crates/ojproto/tests/wire_shapes.rs (Rust is not readable from here), so all
// three agree transitively. The TS + schema legs are ALSO enforced in CI by
// src/engine/__tests__/primitive-kinds-parity.test.ts (CI does not run `oj`); this
// check is the local `oj doctor` mirror.

import { resolve } from 'node:path';
import type { CheckResult } from '../lib/report';

export const id = 'ssot-set-equality';
export const name = 'PrimitiveKind set-equality (schema == TS union == Rust list)';

async function readText(rel: string): Promise<string | null> {
  try {
    return await Bun.file(resolve(rel)).text();
  } catch {
    return null;
  }
}

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort();

function setEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function diff(got: string[], want: string[]): string {
  const missing = want.filter((x) => !got.includes(x));
  const extra = got.filter((x) => !want.includes(x));
  return `missing [${missing.join(', ')}], extra [${extra.join(', ')}]`;
}

export async function run(): Promise<CheckResult> {
  const listText = await readText('schemas/primitive-kinds.json');
  const schemaText = await readText('schemas/oj-plugin-v1.json');
  const tsText = await readText('packages/oj-protocol-ts/src/index.ts');

  if (!listText || !schemaText || !tsText) {
    return {
      id,
      name,
      status: 'fail',
      detail:
        'could not read one of: schemas/primitive-kinds.json, schemas/oj-plugin-v1.json, packages/oj-protocol-ts/src/index.ts',
    };
  }

  // The canonical SSOT list (pinned to the Rust enum by wire_shapes.rs).
  const list = sortedUnique((JSON.parse(listText).kinds as string[]) ?? []);
  // The plugin schema's `kind` enum.
  const schemaEnum = sortedUnique(
    (JSON.parse(schemaText)?.properties?.kind?.enum as string[]) ?? [],
  );
  // The TS `PRIMITIVE_KINDS = [ ... ] as const` tuple — extract its string literals.
  const block = tsText.match(/PRIMITIVE_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const tsKinds = sortedUnique(
    block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
  );

  const schemaOk = setEqual(schemaEnum, list);
  const tsOk = setEqual(tsKinds, list);

  if (schemaOk && tsOk && list.length > 0) {
    return {
      id,
      name,
      status: 'pass',
      detail: `${list.length} kinds agree across the SSOT list, the schema enum, and TS PRIMITIVE_KINDS (Rust pinned by wire_shapes.rs)`,
    };
  }

  const lines: string[] = [];
  if (list.length === 0) lines.push('schemas/primitive-kinds.json has no `kinds`');
  if (!schemaOk) lines.push(`schema kind enum drifted vs SSOT: ${diff(schemaEnum, list)}`);
  if (!tsOk) lines.push(`TS PRIMITIVE_KINDS drifted vs SSOT: ${diff(tsKinds, list)}`);
  return {
    id,
    name,
    status: 'fail',
    detail: lines.join('\n'),
    fix: 'align all declarations to schemas/primitive-kinds.json (the SSOT, pinned to the Rust enum by wire_shapes.rs)',
  };
}
