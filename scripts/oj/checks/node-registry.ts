// scripts/oj/checks/node-registry.ts — the SELF-ENFORCING node-registry coupling
// gate (docs/node-standards.md §6: "precedent for all future nodes").
//
// This is the mechanical guard for the exact defect class we just fixed by hand:
//   • a node type silently lowering to the WRONG / orphaned PrimitiveKind — the
//     looper -> Delay bug (KIND_BY_TYPE mapped `looper` to a stand-in primitive
//     instead of the same-named `Looper` kind);
//   • the quadruple-source registration drift — the NodeType union, the
//     `nodeDefinitions` table, the `REACT_UI` set, and NodeWrapper's render
//     branches disagreeing about which types exist / are bespoke.
//
// For EVERY NodeType it asserts (see THE GATE in the mission):
//   1. it has a `nodeDefinitions` entry (registry.ts);
//   2. it lowers to a KNOWN PrimitiveKind via KIND_BY_TYPE (a member of the SSOT
//      PRIMITIVE_KINDS) OR is intentionally unmapped (-> Passthrough / dsp:'none');
//      AND it FLAGS a node whose NAME implies a distinct primitive but maps to a
//      stand-in (a NodeType with a same-named PrimitiveKind in the SSOT that
//      KIND_BY_TYPE points elsewhere — exactly the looper->Delay signature);
//   3. the SINGLE-SOURCE `nodeDefinition.ui` field AGREES with how NodeWrapper
//      actually renders it (`ui:'react'` <=> a bespoke NodeWrapper branch exists).
//      The old hand-maintained `REACT_UI` set is GONE — `ui` lives on the
//      NodeDefinition (registry.ts) and the manifest derives from it.
//
// RAMP (docs/node-standards.md §6): the registration-unify unit landed and the
// findings are ZERO, so this now FAILS CI (the warn -> fix -> flip-to-fail ramp is
// complete). The one intentional name-implies-kind stand-in (recorder ->
// SpeakerOut: Recorder has no kernel, it is host-bridged) is ALLOWLISTED so it is
// not a false finding.
//
// We parse the source TEXT (with line tracking) the same way the sibling
// `ssot-set-equality` check does — ts-morph is not a dependency, and the coupling
// declarations here are simple, regular literals. AST can replace this verbatim
// later without changing the contract.

import { resolve } from 'node:path';
import type { CheckResult } from '../lib/report';

export const id = 'node-registry';
export const name = 'Node registry coupling (types <-> registry <-> KIND_BY_TYPE <-> NodeWrapper)';

/** Ramp complete: findings are zero, so the gate now ENFORCES (fails CI on drift). */
const RAMP_STATUS: 'warn' | 'fail' = 'fail';

// ----------------------------------------------------------------------------
// Source paths (relative to repo root)
// ----------------------------------------------------------------------------
const P = {
  types: 'src/engine/types.ts',
  registry: 'src/engine/registry.ts',
  manifest: 'src/engine/manifest.ts',
  wrapper: 'src/components/Nodes/NodeWrapper.tsx',
  kinds: 'schemas/primitive-kinds.json',
} as const;

// ----------------------------------------------------------------------------
// Parsed model (line-tracked, pure — the unit test drives `evaluate` directly)
// ----------------------------------------------------------------------------

/** A NodeType -> something mapping with the source line it was declared on. */
export interface MapEntry {
  type: string;
  value: string;
  line: number;
}

export interface CouplingModel {
  /** Every NodeType from the union / KNOWN_PLUGIN_IDS const. */
  nodeTypes: string[];
  /** NodeType -> nodeDefinitions entry line (presence proof). */
  registryTypes: Map<string, number>;
  /** NodeType -> PrimitiveKind from KIND_BY_TYPE (line-tracked). */
  kindByType: MapEntry[];
  /**
   * The SINGLE-SOURCE set of NodeTypes whose `nodeDefinitions` entry declares
   * `ui: 'react'` (a bespoke component). Derived from registry.ts, NOT a separate
   * hand-maintained list — this is what makes the coupling drift-proof.
   */
  reactTypes: Set<string>;
  /** Types NodeWrapper ACTUALLY renders bespoke (schematic switch + content switch). */
  bespokeRendered: Set<string>;
  /** The closed SSOT PrimitiveKind set. */
  primitiveKinds: Set<string>;
}

export interface Finding {
  /** `file:line` (or `file`) anchor. */
  where: string;
  message: string;
}

// ----------------------------------------------------------------------------
// Pure parsers (text -> model). Kept simple + regex-driven, like ssot-set-equality.
// ----------------------------------------------------------------------------

/** Extract the `NodeType` union members AND the KNOWN_PLUGIN_IDS const literals. */
export function parseNodeTypes(typesText: string): string[] {
  const out = new Set<string>();
  // The `export type NodeType = | 'a' | 'b' ...` union: collect quoted literals
  // that appear in `| 'x'` shape up to the terminating `;`.
  const union = typesText.match(/export type NodeType\s*=([\s\S]*?);/);
  if (union?.[1]) {
    for (const m of union[1].matchAll(/'([^']+)'/g)) out.add(m[1] ?? '');
  }
  // KNOWN_PLUGIN_IDS as a belt-and-braces second source.
  const known = typesText.match(/KNOWN_PLUGIN_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (known?.[1]) {
    for (const m of known[1].matchAll(/'([^']+)'/g)) out.add(m[1] ?? '');
  }
  return [...out];
}

/**
 * NodeType -> line, derived from the `type: 'X'` field each `nodeDefinitions`
 * entry carries (the entry's own self-declared type — robust against key/value
 * skew). Falls back to nothing if the file shape changes.
 */
export function parseRegistryTypes(registryText: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = registryText.split('\n');
  // Only look inside the `nodeDefinitions` object body.
  let inDefs = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!inDefs) {
      if (/export const nodeDefinitions/.test(line)) inDefs = true;
      continue;
    }
    const m = line.match(/^\s*type:\s*'([^']+)'/);
    if (m?.[1] && !out.has(m[1])) out.set(m[1], i + 1);
  }
  return out;
}

/**
 * The SINGLE-SOURCE bespoke-UI set: every `nodeDefinitions` entry whose `type`
 * carries a sibling `ui: 'react'` field. We pair each entry's self-declared
 * `type:` with the nearest `ui:` literal that follows it (within the same entry,
 * before the next `type:`), so it is robust against field ORDER. This REPLACES the
 * old `REACT_UI` set parse — `ui` now lives on the NodeDefinition.
 */
export function parseReactTypes(registryText: string): Set<string> {
  const out = new Set<string>();
  const lines = registryText.split('\n');
  let inDefs = false;
  // Track the current TOP-LEVEL entry: at brace depth 1 inside nodeDefinitions a
  // `type:`/`ui:` field belongs to the same entry, in ANY order. We buffer both
  // and pair them when the entry closes (depth drops back to 1).
  let depth = 0;
  let entryType: string | null = null;
  let entryUi: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!inDefs) {
      if (/export const nodeDefinitions/.test(line)) {
        inDefs = true;
        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      }
      continue;
    }
    const before = depth;
    // An entry FIELD lives at depth 2 (inside `{ nodeDefinitions { entry { ... } } }`
    // -> the object literal is depth 1, the entry body is depth 2). Capture before
    // mutating depth so a same-line field is attributed to its current entry.
    const t = line.match(/^\s*type:\s*'([^']+)'/);
    if (t?.[1]) entryType = t[1];
    const u = line.match(/^\s*ui:\s*'([^']+)'/);
    if (u?.[1]) entryUi = u[1];

    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);

    // Entry closed: we dropped from an entry body (depth 2) back to the object
    // body (depth 1). Pair and reset.
    if (before >= 2 && depth <= 1 && entryType) {
      if (entryUi === 'react') out.add(entryType);
      entryType = null;
      entryUi = null;
    }
    // Left the nodeDefinitions object entirely.
    if (depth <= 0) break;
  }
  return out;
}

/** Parse KIND_BY_TYPE entries (NodeType -> PrimitiveKind) with line numbers. */
export function parseKindByType(manifestText: string): MapEntry[] {
  const out: MapEntry[] = [];
  const lines = manifestText.split('\n');
  let inBlock = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!inBlock) {
      if (/KIND_BY_TYPE\s*:/.test(line) || /KIND_BY_TYPE\s*=/.test(line)) {
        inBlock = true;
        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      }
      continue;
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    // `piano: 'Sampler',` style entry.
    const m = line.match(/^\s*'?([A-Za-z][A-Za-z0-9-]*)'?\s*:\s*'([^']+)'/);
    if (m?.[1] && m[2]) out.push({ type: m[1], value: m[2], line: i + 1 });
    if (depth <= 0) break;
  }
  return out;
}

/** Parse a named `ReadonlySet<NodeType>` / `Set` of string literals. */
export function parseStringSet(text: string, name: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${name}[^=]*=\\s*new Set[^(]*\\(\\[([\\s\\S]*?)\\]\\s*\\)`);
  const block = text.match(re);
  if (block?.[1]) {
    for (const m of block[1].matchAll(/'([^']+)'/g)) out.add(m[1] ?? '');
  }
  return out;
}

/**
 * The set of types NodeWrapper ACTUALLY renders with a bespoke component. Two
 * sources, mirroring the component:
 *   • the SCHEMATIC_TYPES array's `switch (node.type)` cases, and
 *   • the renderNodeContent `switch (node.type)` cases (effect/multiplier/recorder).
 * Every `case '<type>':` literal inside either switch is a bespoke branch.
 */
export function parseBespokeRendered(wrapperText: string): Set<string> {
  const out = new Set<string>();
  for (const m of wrapperText.matchAll(/case\s+'([^']+)'\s*:/g)) out.add(m[1] ?? '');
  return out;
}

/** Parse the closed PrimitiveKind SSOT. */
export function parsePrimitiveKinds(kindsJson: string): Set<string> {
  try {
    const arr = (JSON.parse(kindsJson).kinds as string[]) ?? [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

// ----------------------------------------------------------------------------
// The pure gate — model -> findings. This is what the unit test exercises.
// ----------------------------------------------------------------------------

/**
 * The closed PrimitiveKind that a NodeType is allowed to lower to WITHOUT a
 * KIND_BY_TYPE entry (the "intentionally unmapped" routing/visual case). Both the
 * absence of an entry and an explicit `Passthrough` mean dsp:'none'.
 */
const UNMAPPED_OK = 'Passthrough';

/**
 * INTENTIONAL name-implies-kind stand-ins: a `type -> kind` pair where the
 * NodeType has a same-named PrimitiveKind in the SSOT, yet it deliberately lowers
 * to a DIFFERENT (host-bridged) kind because it has no kernel of its own. These
 * are allowlisted so the looper->Delay heuristic doesn't flag a by-design bridge.
 *
 *   • `recorder` -> `SpeakerOut`: the Recorder has NO RT kernel; it is a
 *     host-bridged sink (the executor taps the master/SpeakerOut bus to capture
 *     audio to a WAV). The same-named `Recorder` PrimitiveKind exists in the SSOT
 *     for the wire contract, but there is no `recorder` kernel to lower to, so it
 *     intentionally rides the SpeakerOut sink. This is a deliberate stand-in, not
 *     the looper->Delay drift.
 */
const NAME_KIND_STANDINS = new Set<string>(['recorder->SpeakerOut']);

/**
 * NodeTypes that are purely visual/internal sub-nodes (never lowered, never a
 * bespoke top-level NodeWrapper branch on their own). These legitimately have no
 * KIND_BY_TYPE entry — they are not RT primitives. Listed so the gate doesn't
 * mistake the absence of a lowering for drift. (Detection only; not a fix.)
 */
const PURELY_VISUAL = new Set<string>([
  'keyboard-key',
  'keyboard-visual',
  'instrument-visual',
  'midi-visual',
  'minilab3-visual',
  'sampler-visual',
  'output-panel',
  'input-panel',
  'container',
  'canvas-input',
  'canvas-output',
]);

export function evaluate(model: CouplingModel): Finding[] {
  const findings: Finding[] = [];
  const kindMap = new Map(model.kindByType.map((e) => [e.type, e]));

  for (const type of model.nodeTypes) {
    // (1) registry presence.
    if (!model.registryTypes.has(type)) {
      findings.push({
        where: P.registry,
        message: `NodeType '${type}' has NO nodeDefinitions entry (registry.ts)`,
      });
    }

    // (2) lowering correctness.
    const entry = kindMap.get(type);
    if (entry) {
      // 2a. The mapped kind must be in the SSOT.
      if (!model.primitiveKinds.has(entry.value)) {
        findings.push({
          where: `${P.manifest}:${entry.line}`,
          message: `KIND_BY_TYPE maps '${type}' -> '${entry.value}', which is NOT in the PrimitiveKind SSOT (${P.kinds})`,
        });
      }
      // 2b. name-implies-kind mismap (the looper->Delay signature): a NodeType
      // whose own name IS a PrimitiveKind, but mapped elsewhere.
      const sameNamed = titleCase(type);
      if (
        model.primitiveKinds.has(sameNamed) &&
        entry.value !== sameNamed &&
        // Skip deliberate host-bridged stand-ins (e.g. recorder -> SpeakerOut:
        // the Recorder has no kernel, it taps the master sink).
        !NAME_KIND_STANDINS.has(`${type}->${entry.value}`)
      ) {
        findings.push({
          where: `${P.manifest}:${entry.line}`,
          message:
            `name-implies-kind mismap: '${type}' has a same-named PrimitiveKind ` +
            `'${sameNamed}' in the SSOT but KIND_BY_TYPE lowers it to '${entry.value}' ` +
            `(this is the looper->Delay signature — a stand-in primitive)`,
        });
      }
    } else if (!PURELY_VISUAL.has(type)) {
      // No entry => Passthrough (dsp:'none'). Fine for visual/routing nodes; but
      // a non-visual type silently going to Passthrough is worth surfacing as a
      // potential missing-lowering (it would make NO sound).
      // We only flag the ones that LOOK audio-ish: same-named in the SSOT.
      const sameNamed = titleCase(type);
      if (model.primitiveKinds.has(sameNamed)) {
        findings.push({
          where: `${P.manifest}`,
          message:
            `NodeType '${type}' has NO KIND_BY_TYPE entry so it lowers to ` +
            `'${UNMAPPED_OK}' (dsp:'none'), yet a same-named PrimitiveKind ` +
            `'${sameNamed}' exists in the SSOT — likely a missing lowering`,
        });
      }
    }

    // (3) nodeDefinition.ui (single source) <=> NodeWrapper agreement.
    const isReact = model.reactTypes.has(type);
    const isRendered = model.bespokeRendered.has(type);
    if (isReact && !isRendered) {
      findings.push({
        where: `${P.registry}`,
        message:
          `nodeDefinitions['${type}'].ui is 'react' but NodeWrapper has NO bespoke ` +
          `branch for it (set ui:'auto', or add the bespoke branch)`,
      });
    } else if (!isReact && isRendered) {
      findings.push({
        where: `${P.wrapper}`,
        message:
          `NodeWrapper renders '${type}' with a bespoke branch but ` +
          `nodeDefinitions['${type}'].ui is NOT 'react' (manifest will report ` +
          `ui:'auto'); set ui:'react' on the def to match`,
      });
    }
  }

  return findings;
}

/** `looper` -> `Looper`, `electricCello` -> `Electriccello` (we only compare the
 *  simple Title-cased form against the SSOT, which is enough for the
 *  same-named-primitive heuristic: Looper, Recorder, Add, Subtract, etc.). */
function titleCase(type: string): string {
  if (type.length === 0) return type;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ----------------------------------------------------------------------------
// run() — read the real tree, build the model, evaluate, render at ramp level.
// ----------------------------------------------------------------------------

async function readText(rel: string): Promise<string | null> {
  try {
    return await Bun.file(resolve(rel)).text();
  } catch {
    return null;
  }
}

export async function run(): Promise<CheckResult> {
  const [typesText, registryText, manifestText, wrapperText, kindsText] = await Promise.all([
    readText(P.types),
    readText(P.registry),
    readText(P.manifest),
    readText(P.wrapper),
    readText(P.kinds),
  ]);

  if (!typesText || !registryText || !manifestText || !wrapperText || !kindsText) {
    return {
      id,
      name,
      status: 'fail',
      detail: `could not read one of: ${Object.values(P).join(', ')}`,
    };
  }

  const model: CouplingModel = {
    nodeTypes: parseNodeTypes(typesText),
    registryTypes: parseRegistryTypes(registryText),
    kindByType: parseKindByType(manifestText),
    reactTypes: parseReactTypes(registryText),
    bespokeRendered: parseBespokeRendered(wrapperText),
    primitiveKinds: parsePrimitiveKinds(kindsText),
  };

  // Guard against a parser that silently found nothing (a refactor changed the
  // shapes): that itself is drift the gate must surface, not pass over.
  const parseGaps: string[] = [];
  if (model.nodeTypes.length === 0) parseGaps.push(`no NodeType union parsed from ${P.types}`);
  if (model.registryTypes.size === 0) parseGaps.push(`no nodeDefinitions entries parsed from ${P.registry}`);
  if (model.kindByType.length === 0) parseGaps.push(`no KIND_BY_TYPE entries parsed from ${P.manifest}`);
  if (model.reactTypes.size === 0) parseGaps.push(`no ui:'react' nodeDefinitions parsed from ${P.registry}`);
  if (model.bespokeRendered.size === 0) parseGaps.push(`no bespoke render branches parsed from ${P.wrapper}`);
  if (model.primitiveKinds.size === 0) parseGaps.push(`no PrimitiveKind SSOT parsed from ${P.kinds}`);

  if (parseGaps.length > 0) {
    return {
      id,
      name,
      status: 'fail',
      detail: ['node-registry parser found nothing to check (source shape changed?):', ...parseGaps].join('\n'),
      fix: 'update scripts/oj/checks/node-registry.ts parsers to the new source shape',
    };
  }

  const findings = evaluate(model);

  if (findings.length === 0) {
    return {
      id,
      name,
      status: 'pass',
      detail: `${model.nodeTypes.length} NodeTypes coupled cleanly across registry, KIND_BY_TYPE (SSOT), nodeDefinition.ui, and NodeWrapper`,
    };
  }

  const detail = [
    `${findings.length} coupling finding(s) across ${model.nodeTypes.length} NodeTypes (enforced, ${RAMP_STATUS}-level):`,
    ...findings.map((f) => `  ${f.where} — ${f.message}`),
  ].join('\n');

  return {
    id,
    name,
    status: RAMP_STATUS,
    detail,
    fix: 'unify the registration sources (NodeType union <-> nodeDefinitions(.ui) <-> KIND_BY_TYPE <-> NodeWrapper); see docs/node-standards.md §6.',
  };
}
