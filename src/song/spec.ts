// src/song/spec.ts — the friendly graph spec -> {nodes, connections} builder.
//
// This is the GRAPH HALF of an Arrangement, and it is the SAME shape `oj author`
// already uses (a strict subset, never a sibling). Extracted here so BOTH `oj
// author` and `conduct()` build the visual graph through ONE path (extend, never
// fork — code-value #2). `emitOjGraph`/`emitWithIndex` then lower it exactly as the
// canvas does.

import { getNodeDefinition } from '../engine/registry';
import type { Connection, GraphNode, NodeType, PortDefinition } from '../engine/types';

/** A node in the friendly spec: a symbolic `ref`, a registry `type`, optional data. */
export interface SpecNode {
    ref: string;
    type: string;
    data?: Record<string, unknown>;
}

/** A wire: `from`/`to` are "ref" or "ref:Port Name" (default = first audio port). */
export interface SpecConn {
    from: string;
    to: string;
}

/** The graph half of an Arrangement (and the whole of an `oj author` spec). */
export interface GraphSpec {
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
        : (candidates.find((p) => p.type === 'audio') ?? candidates[0]);
    if (!port) throw new Error(`node "${ref}" has no ${direction} port named "${portName}"`);
    return { nodeId: ref!, port };
}

/**
 * Build the live `{nodes, connections}` maps from a friendly graph spec, mirroring
 * `graphStore.addNode`'s node construction (so a spec node is byte-identical to a
 * hand-added one). Pure. Throws a friendly error on an unknown type or bad wire.
 */
export function specToGraph(spec: GraphSpec): {
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
} {
    const nodes = new Map<string, GraphNode>();
    spec.nodes.forEach((sn, i) => {
        let def;
        try {
            def = getNodeDefinition(sn.type as NodeType);
        } catch {
            throw new Error(`unknown node type "${sn.type}" (ref "${sn.ref}")`);
        }
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

    return { nodes, connections };
}
