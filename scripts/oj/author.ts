// scripts/oj/author.ts — `oj author`: describe a patch in friendly terms, get an
// OjGraph (and optionally hear it). The authoring half of the agent's first-class
// loop: I say "osc -> reverb -> speaker" and the SAME `emitOjGraph` the canvas uses
// lowers it — baking the real manifest, ports, and PARAM DEFAULTS — so I never
// hand-write IR or miss an envelope param.
//
//   oj author patch.json [--out graph.json] [--render [render-flags...]]
//
// Spec shape (friendly):
//   {
//     "nodes": [
//       { "ref": "osc", "type": "instrument", "data": {} },
//       { "ref": "rev", "type": "effect", "data": { "effectType": "reverb" } },
//       { "ref": "spk", "type": "speaker" }
//     ],
//     "connections": [
//       { "from": "osc", "to": "rev" },          // defaults to first audio out -> first audio in
//       { "from": "rev", "to": "spk" }           // or "from": "osc:Audio Out" to name a port
//     ]
//   }
//
// Writes the OjGraph JSON and prints the IR node table (id -> manifest/kind) so a
// schedule can be written against the node ids. `--render` chains straight into
// `oj render --graph <out> ...` (best for self-playing / effects-only graphs).

import { resolve } from 'node:path';
import { getNodeDefinition } from '../../src/engine/registry';
import { emitOjGraph } from '../../src/audio/ojgraph/emit';
import { remapForBackend } from '../../src/audio/ojgraph';
import type { Connection, GraphNode, NodeType, PortDefinition } from '../../src/engine/types';
import { render } from './render';

const ROOT = resolve(import.meta.dir, '..', '..');

interface SpecNode {
  ref: string;
  type: string;
  data?: Record<string, unknown>;
}
interface SpecConn {
  from: string; // "ref" or "ref:Port Name"
  to: string;
}
interface Spec {
  nodes: SpecNode[];
  connections?: SpecConn[];
}

/** Resolve "ref" or "ref:Port Name" against a node's ports for one direction. */
function resolvePort(
  endpoint: string,
  nodes: Map<string, GraphNode>,
  direction: 'input' | 'output',
): { nodeId: string; port: PortDefinition } {
  const [ref, portName] = endpoint.split(':').map((s) => s.trim());
  const node = nodes.get(ref!);
  if (!node) throw new Error(`connection references unknown node "${ref}"`);
  const candidates = node.ports.filter((p) => p.direction === direction);
  if (candidates.length === 0)
    throw new Error(`node "${ref}" has no ${direction} port to connect`);
  const port = portName
    ? candidates.find((p) => p.name === portName)
    : // Default: prefer an audio port, else the first port of this direction.
      (candidates.find((p) => p.type === 'audio') ?? candidates[0]);
  if (!port) throw new Error(`node "${ref}" has no ${direction} port named "${portName}"`);
  return { nodeId: ref!, port };
}

function buildGraph(spec: Spec): ReturnType<typeof emitOjGraph> {
  const nodes = new Map<string, GraphNode>();
  spec.nodes.forEach((sn, i) => {
    let def;
    try {
      def = getNodeDefinition(sn.type as NodeType);
    } catch {
      throw new Error(`unknown node type "${sn.type}" (ref "${sn.ref}")`);
    }
    // Mirror graphStore.addNode's node construction (reuse, don't fork).
    nodes.set(sn.ref, {
      id: sn.ref,
      type: sn.type as NodeType,
      category: def.category,
      position: { x: i * 220, y: 0 },
      data: { ...def.defaultData, ...(sn.data ?? {}) },
      ports: def.defaultPorts.map((p) => ({ ...p })),
      parentId: null,
      childIds: [],
      specialNodes: [],
    });
  });

  const connections = new Map<string, Connection>();
  (spec.connections ?? []).forEach((sc, i) => {
    const src = resolvePort(sc.from, nodes, 'output');
    const dst = resolvePort(sc.to, nodes, 'input');
    const id = `c${i}`;
    connections.set(id, {
      id,
      sourceNodeId: src.nodeId,
      sourcePortId: src.port.id,
      targetNodeId: dst.nodeId,
      targetPortId: dst.port.id,
      type: src.port.type,
    });
  });

  // Lower to OjGraph, then apply the SAME backend manifest-id remap the native
  // executor runs before push (`OjcoreNativeExecutor.sendGraph` → remapForBackend),
  // so emit's `builtin.<type>` ids become the engine's registered loader ids (e.g.
  // `builtin.speaker` → `host.speaker_out`). Without it the engine UnknownManifests.
  return remapForBackend(emitOjGraph(nodes, connections, { sampleRate: 48_000, blockSize: 256 }), 'native');
}

export async function author(args: string[]): Promise<number> {
  // Split: <specPath> [--out path] [--render <render passthrough...>]
  const specPath = args.find((a) => !a.startsWith('--'));
  if (!specPath) {
    process.stderr.write('oj author: need a spec file — `oj author patch.json`\n');
    return 2;
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1]! : 'openjammer-authored.json';
  const renderIdx = args.indexOf('--render');

  let spec: Spec;
  try {
    spec = JSON.parse(await Bun.file(resolve(ROOT, specPath)).text());
  } catch (e) {
    process.stderr.write(`oj author: cannot read/parse ${specPath}: ${(e as Error).message}\n`);
    return 2;
  }

  let graph: ReturnType<typeof emitOjGraph>;
  try {
    graph = buildGraph(spec);
  } catch (e) {
    process.stderr.write(`oj author: ${(e as Error).message}\n`);
    return 2;
  }

  await Bun.write(resolve(ROOT, out), JSON.stringify(graph, null, 2));
  process.stdout.write(`oj author -> ${out}\n`);
  process.stdout.write('  IR nodes (id  manifest  kind):\n');
  for (const n of graph.nodes) {
    process.stdout.write(`    ${String(n.id).padStart(3)}  ${n.manifest_id}  (${n.kind})\n`);
  }

  // `--render`: chain into the audition tool (everything after --render passes through).
  if (renderIdx >= 0) {
    const passthrough = args.slice(renderIdx + 1);
    return render(['--graph', out, ...passthrough]);
  }
  return 0;
}
