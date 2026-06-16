// scripts/oj/checks/docs-accuracy.ts — assert docs/creating-nodes.md points
// contributors at the REAL node-routing file. The real `switch (node.type)`
// blocks live in src/components/Nodes/NodeWrapper.tsx (:383 and :439). The doc
// currently lies, telling contributors to edit src/components/Canvas/NodeCanvas.tsx.
// This check FAILs on that lie; --fix rewrites the stale references. Pure TS.

import type { CheckResult } from '../lib/report';
import { resolve } from 'node:path';

export const id = 'docs-accuracy';
export const name = 'Docs reference the real node-routing file (NodeWrapper.tsx)';

const DOC_PATH = 'docs/creating-nodes.md';
const STALE = 'src/components/Canvas/NodeCanvas.tsx';
const STALE_BARE = 'NodeCanvas.tsx';
const REAL = 'src/components/Nodes/NodeWrapper.tsx';
const REAL_BARE = 'NodeWrapper.tsx';

export async function run(opts: { fix?: boolean; docPath?: string } = {}): Promise<CheckResult> {
  const docPath = opts.docPath ?? DOC_PATH;
  const abs = resolve(docPath);

  let text: string;
  try {
    text = await Bun.file(abs).text();
  } catch {
    return {
      id,
      name,
      status: 'skip',
      detail: `${docPath} not found — nothing to verify.`,
    };
  }

  const hasStale = text.includes(STALE) || text.includes(STALE_BARE);

  if (opts.fix && hasStale) {
    // Rewrite the full path first, then any remaining bare filename mentions
    // that aren't part of an already-correct path.
    let next = text.split(STALE).join(REAL);
    next = next.split(STALE_BARE).join(REAL_BARE);
    if (next !== text) {
      await Bun.write(abs, next);
      text = next;
    }
  }

  const stillStale = text.includes(STALE) || text.includes(STALE_BARE);

  if (stillStale) {
    const lines = locateLines(text, [STALE, STALE_BARE]);
    return {
      id,
      name,
      status: 'fail',
      detail: [
        `${docPath} references the stale routing file "${STALE}".`,
        `The real node-routing switch is in "${REAL}" (lines :383 and :439).`,
        lines.length > 0 ? `stale mentions at line(s): ${lines.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      fix: `rewrite the references via: bun scripts/oj/index.ts doctor --check docs-accuracy --fix`,
    };
  }

  // Confirm the doc actually mentions the correct file at all.
  const mentionsReal = text.includes(REAL) || text.includes(REAL_BARE);
  return {
    id,
    name,
    status: 'pass',
    detail: mentionsReal
      ? `${docPath} references ${REAL_BARE}; no stale NodeCanvas.tsx mentions.`
      : `${docPath} has no stale NodeCanvas.tsx mentions.`,
  };
}

function locateLines(text: string, needles: string[]): number[] {
  const out: number[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (needles.some((n) => lines[i]!.includes(n))) out.push(i + 1);
  }
  return out;
}
