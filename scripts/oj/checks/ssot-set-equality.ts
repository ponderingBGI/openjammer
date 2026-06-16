// scripts/oj/checks/ssot-set-equality.ts — STUB.
//
// Phase-3 cross-language set-equality gate: assert the schema `kind` enum
// (schemas/oj-plugin-v1.json) == the generated TS union (src/engine/manifest.gen.ts)
// == the Rust flat list (schemas/primitive-kinds.json). This depends on D1 schema
// codegen (gen-schema bin + json-schema-to-typescript) which is not yet built.
//
// TODO(phase-3): implement three-way PrimitiveKind set-equality once schema
// codegen lands.

import type { CheckResult } from '../lib/report';

export const id = 'ssot-set-equality';
export const name = 'PrimitiveKind set-equality (schema == TS union == Rust list)';

export async function run(): Promise<CheckResult> {
  return {
    id,
    name,
    status: 'skip',
    detail: 'Phase-3: needs schema codegen',
  };
}
