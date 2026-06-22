// scripts/oj/__tests__/node-registry.test.ts — the node-registry coupling gate's
// core logic. Drives the PURE `evaluate(model)` with synthetic models (a correct
// one passes; a node-maps-to-wrong-kind one is flagged) and exercises the parsers
// on minimal source snippets. Also asserts the gate runs WARN-level on the REAL
// tree (ramp), never throwing.

import { test, expect } from 'bun:test';
import {
  evaluate,
  parseNodeTypes,
  parseRegistryTypes,
  parseKindByType,
  parseStringSet,
  parseBespokeRendered,
  parsePrimitiveKinds,
  run,
  type CouplingModel,
} from '../checks/node-registry';

const SSOT = new Set(['Looper', 'Recorder', 'Delay', 'Gain', 'Passthrough', 'SpeakerOut']);

/** A fully-coherent model — every assertion is satisfied. */
function correctModel(): CouplingModel {
  return {
    nodeTypes: ['looper', 'amplifier', 'add'],
    registryTypes: new Map([
      ['looper', 10],
      ['amplifier', 20],
      ['add', 30],
    ]),
    kindByType: [
      { type: 'looper', value: 'Looper', line: 100 },
      { type: 'amplifier', value: 'Gain', line: 101 },
    ],
    reactUi: new Set(['looper', 'amplifier']),
    bespokeRendered: new Set(['looper', 'amplifier']),
    primitiveKinds: SSOT,
  };
}

test('evaluate PASSES a fully-coherent model (no findings)', () => {
  expect(evaluate(correctModel())).toEqual([]);
});

test('evaluate FLAGS a node-maps-to-wrong-kind (the looper->Delay signature)', () => {
  const m = correctModel();
  // Lower `looper` to the stand-in `Delay` instead of the same-named `Looper`.
  m.kindByType = [
    { type: 'looper', value: 'Delay', line: 117 },
    { type: 'amplifier', value: 'Gain', line: 101 },
  ];
  const findings = evaluate(m);
  const mismap = findings.find((f) => f.message.includes('name-implies-kind mismap'));
  expect(mismap).toBeDefined();
  expect(mismap?.message).toContain("'looper'");
  expect(mismap?.message).toContain("'Looper'");
  expect(mismap?.message).toContain("'Delay'");
  expect(mismap?.where).toBe('src/engine/manifest.ts:117');
});

test('evaluate FLAGS a kind not in the SSOT', () => {
  const m = correctModel();
  m.kindByType = [{ type: 'looper', value: 'Phaser', line: 5 }];
  const findings = evaluate(m);
  expect(findings.some((f) => f.message.includes('NOT in the PrimitiveKind SSOT'))).toBe(true);
});

test('evaluate FLAGS a NodeType with no nodeDefinitions entry', () => {
  const m = correctModel();
  m.registryTypes = new Map([['amplifier', 20]]); // drop `looper` + `add`
  const findings = evaluate(m);
  expect(findings.some((f) => f.message.includes("'looper' has NO nodeDefinitions entry"))).toBe(true);
});

test('evaluate FLAGS REACT_UI-vs-NodeWrapper disagreement both directions', () => {
  const m = correctModel();
  m.reactUi = new Set(['looper']); // amplifier dropped from REACT_UI
  m.bespokeRendered = new Set(['looper', 'amplifier', 'add']); // but add IS rendered
  const findings = evaluate(m);
  // amplifier: rendered but not in REACT_UI
  expect(findings.some((f) => f.message.includes("renders 'amplifier'") && f.message.includes('OMITS'))).toBe(true);
  // add: rendered but not in REACT_UI
  expect(findings.some((f) => f.message.includes("renders 'add'"))).toBe(true);
});

test('evaluate FLAGS REACT_UI listing a type NodeWrapper does not render', () => {
  const m = correctModel();
  m.nodeTypes = ['looper', 'amplifier', 'add', 'instrument'];
  m.registryTypes.set('instrument', 40);
  m.reactUi = new Set(['looper', 'amplifier', 'instrument']);
  m.bespokeRendered = new Set(['looper', 'amplifier']);
  const findings = evaluate(m);
  expect(findings.some((f) => f.message.includes("REACT_UI lists 'instrument'"))).toBe(true);
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

test('parseNodeTypes reads the NodeType union literals', () => {
  const src = `export type NodeType =\n  | 'keyboard'\n  | 'looper'\n  | 'add';\n`;
  expect(new Set(parseNodeTypes(src))).toEqual(new Set(['keyboard', 'looper', 'add']));
});

test('parseRegistryTypes reads each entry self-declared type with its line', () => {
  const src = [
    'export const nodeDefinitions = {',
    '  looper: {',
    "    type: 'looper',",
    '  },',
    '};',
  ].join('\n');
  const m = parseRegistryTypes(src);
  expect(m.get('looper')).toBe(3);
});

test('parseKindByType reads NodeType -> PrimitiveKind with line', () => {
  const src = [
    'const KIND_BY_TYPE = {',
    "  amplifier: 'Gain',",
    "  looper: 'Looper',",
    '};',
  ].join('\n');
  const entries = parseKindByType(src);
  expect(entries).toContainEqual({ type: 'amplifier', value: 'Gain', line: 2 });
  expect(entries).toContainEqual({ type: 'looper', value: 'Looper', line: 3 });
});

test('parseStringSet reads a named Set of literals', () => {
  const src = `const REACT_UI: ReadonlySet<NodeType> = new Set<NodeType>(['looper', 'effect']);`;
  expect(parseStringSet(src, 'REACT_UI')).toEqual(new Set(['looper', 'effect']));
});

test('parseBespokeRendered reads switch case literals', () => {
  const src = `switch (node.type) { case 'looper': return x; case 'effect': return y; }`;
  expect(parseBespokeRendered(src)).toEqual(new Set(['looper', 'effect']));
});

test('parsePrimitiveKinds reads the SSOT json', () => {
  expect(parsePrimitiveKinds(JSON.stringify({ kinds: ['Looper', 'Gain'] }))).toEqual(
    new Set(['Looper', 'Gain']),
  );
});

// ---------------------------------------------------------------------------
// Real-tree ramp behaviour
// ---------------------------------------------------------------------------

test('run() on the real tree is WARN-level (ramp) and never throws or fails CI', async () => {
  const res = await run();
  // The pre-existing registration drift is reported, but as warn (CI-green), never fail.
  expect(res.status === 'warn' || res.status === 'pass').toBe(true);
  expect(res.id).toBe('node-registry');
});
