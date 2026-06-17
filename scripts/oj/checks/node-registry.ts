// scripts/oj/checks/node-registry.ts — STUB.
//
// Phase-3 keystone: the `validate-nodes` tool. Will use ts-morph to cross-
// reference the NodeType union (src/engine/types.ts) <-> nodeDefinitions
// (src/engine/registry.ts) <-> BOTH switch (node.type) blocks in
// src/components/Nodes/NodeWrapper.tsx (:383, :439) <-> component file on disk
// <-> CSS, reusing the validators in src/engine/nodeStandards.ts. AST, never
// regex. Not implemented now (needs ts-morph AST coupling work).
//
// TODO(phase-3): implement node-registry coupling via ts-morph.

import type { CheckResult } from '../lib/report';

export const id = 'node-registry';
export const name = 'Node registry coupling (types <-> registry <-> NodeWrapper)';

export async function run(): Promise<CheckResult> {
  return {
    id,
    name,
    status: 'skip',
    detail: 'Phase-3: ts-morph node-registry coupling not yet wired',
  };
}
