import type { Connection, GraphNode } from '../engine/types';

export interface GraphStateSlice {
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
    rootNodeIds: string[];
}

export type GraphVerb =
    | { kind: 'addNode'; node: GraphNode }
    | { kind: 'removeNode'; nodeId: string }
    | { kind: 'moveNode'; nodeId: string; position: GraphNode['position'] }
    | { kind: 'setNodeData'; nodeId: string; data: GraphNode['data'] }
    | { kind: 'setNodePorts'; nodeId: string; ports: GraphNode['ports'] }
    | { kind: 'setNodePluginId'; nodeId: string; pluginId?: string }
    | { kind: 'replaceNode'; node: GraphNode }
    | { kind: 'addConnection'; connection: Connection }
    | { kind: 'removeConnection'; connectionId: string }
    | { kind: 'setRootNodeIds'; rootNodeIds: string[] };

const replaceNode = (slice: GraphStateSlice, node: GraphNode): GraphStateSlice => {
    const nodes = new Map(slice.nodes);
    nodes.set(node.id, structuredClone(node));
    return { ...slice, nodes };
};

export function applyGraphVerb(slice: GraphStateSlice, verb: GraphVerb): { next: GraphStateSlice; inverse: GraphVerb } {
    switch (verb.kind) {
        case 'addNode': {
            if (slice.nodes.has(verb.node.id)) throw new Error(`graph verb: node "${verb.node.id}" already exists`);
            const nodes = new Map(slice.nodes);
            nodes.set(verb.node.id, structuredClone(verb.node));
            return { next: { ...slice, nodes }, inverse: { kind: 'removeNode', nodeId: verb.node.id } };
        }
        case 'removeNode': {
            const node = slice.nodes.get(verb.nodeId);
            if (!node) throw new Error(`graph verb: no node "${verb.nodeId}"`);
            const nodes = new Map(slice.nodes);
            nodes.delete(verb.nodeId);
            return { next: { ...slice, nodes }, inverse: { kind: 'addNode', node: structuredClone(node) } };
        }
        case 'moveNode': {
            const node = slice.nodes.get(verb.nodeId);
            if (!node) throw new Error(`graph verb: no node "${verb.nodeId}"`);
            return { next: replaceNode(slice, { ...node, position: { ...verb.position } }), inverse: { kind: 'moveNode', nodeId: verb.nodeId, position: { ...node.position } } };
        }
        case 'setNodeData': {
            const node = slice.nodes.get(verb.nodeId);
            if (!node) throw new Error(`graph verb: no node "${verb.nodeId}"`);
            return { next: replaceNode(slice, { ...node, data: structuredClone(verb.data) }), inverse: { kind: 'setNodeData', nodeId: verb.nodeId, data: structuredClone(node.data) } };
        }
        case 'setNodePorts': {
            const node = slice.nodes.get(verb.nodeId);
            if (!node) throw new Error(`graph verb: no node "${verb.nodeId}"`);
            return { next: replaceNode(slice, { ...node, ports: structuredClone(verb.ports) }), inverse: { kind: 'setNodePorts', nodeId: verb.nodeId, ports: structuredClone(node.ports) } };
        }
        case 'setNodePluginId': {
            const node = slice.nodes.get(verb.nodeId);
            if (!node) throw new Error(`graph verb: no node "${verb.nodeId}"`);
            const nextNode = { ...node };
            if (verb.pluginId === undefined) delete nextNode.pluginId;
            else nextNode.pluginId = verb.pluginId;
            return { next: replaceNode(slice, nextNode), inverse: { kind: 'setNodePluginId', nodeId: verb.nodeId, pluginId: node.pluginId } };
        }
        case 'replaceNode': {
            const node = slice.nodes.get(verb.node.id);
            if (!node) throw new Error(`graph verb: no node "${verb.node.id}"`);
            return { next: replaceNode(slice, verb.node), inverse: { kind: 'replaceNode', node: structuredClone(node) } };
        }
        case 'addConnection': {
            if (slice.connections.has(verb.connection.id)) throw new Error(`graph verb: connection "${verb.connection.id}" already exists`);
            const connections = new Map(slice.connections);
            connections.set(verb.connection.id, structuredClone(verb.connection));
            return { next: { ...slice, connections }, inverse: { kind: 'removeConnection', connectionId: verb.connection.id } };
        }
        case 'removeConnection': {
            const connection = slice.connections.get(verb.connectionId);
            if (!connection) throw new Error(`graph verb: no connection "${verb.connectionId}"`);
            const connections = new Map(slice.connections);
            connections.delete(verb.connectionId);
            return { next: { ...slice, connections }, inverse: { kind: 'addConnection', connection: structuredClone(connection) } };
        }
        case 'setRootNodeIds':
            return { next: { ...slice, rootNodeIds: [...verb.rootNodeIds] }, inverse: { kind: 'setRootNodeIds', rootNodeIds: [...slice.rootNodeIds] } };
    }
}

export function applyGraphVerbs(slice: GraphStateSlice, verbs: readonly GraphVerb[]): { next: GraphStateSlice; inverse: GraphVerb[] } {
    let next = slice;
    let inverse: GraphVerb[] = [];
    for (const verb of verbs) {
        const result = applyGraphVerb(next, verb);
        next = result.next;
        inverse = [result.inverse, ...inverse];
    }
    return { next, inverse };
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Produce a reversible, deterministic verb batch for an already-performed graph mutation. */
export function diffGraph(before: GraphStateSlice, after: GraphStateSlice): { verbs: GraphVerb[]; inverse: GraphVerb[] } {
    const verbs: GraphVerb[] = [];
    for (const [id] of before.connections) if (!after.connections.has(id)) verbs.push({ kind: 'removeConnection', connectionId: id });
    for (const [id] of before.nodes) if (!after.nodes.has(id)) verbs.push({ kind: 'removeNode', nodeId: id });
    for (const [id, node] of after.nodes) {
        const old = before.nodes.get(id);
        if (!old) verbs.push({ kind: 'addNode', node: structuredClone(node) });
        else if (!equal(old, node)) {
            const changed = Object.keys(node).filter((key) => !equal(old[key as keyof GraphNode], node[key as keyof GraphNode]));
            if (changed.length === 1 && changed[0] === 'position') verbs.push({ kind: 'moveNode', nodeId: id, position: { ...node.position } });
            else if (changed.length === 1 && changed[0] === 'data') verbs.push({ kind: 'setNodeData', nodeId: id, data: structuredClone(node.data) });
            else if (changed.length === 1 && changed[0] === 'ports') verbs.push({ kind: 'setNodePorts', nodeId: id, ports: structuredClone(node.ports) });
            else if (changed.length === 1 && changed[0] === 'pluginId') verbs.push({ kind: 'setNodePluginId', nodeId: id, pluginId: node.pluginId });
            else verbs.push({ kind: 'replaceNode', node: structuredClone(node) });
        }
    }
    for (const [id, connection] of after.connections) {
        const old = before.connections.get(id);
        if (!old) verbs.push({ kind: 'addConnection', connection: structuredClone(connection) });
        else if (!equal(old, connection)) {
            verbs.push({ kind: 'removeConnection', connectionId: id }, { kind: 'addConnection', connection: structuredClone(connection) });
        }
    }
    if (!equal(before.rootNodeIds, after.rootNodeIds)) verbs.push({ kind: 'setRootNodeIds', rootNodeIds: [...after.rootNodeIds] });
    return { verbs, inverse: applyGraphVerbs(before, verbs).inverse };
}
