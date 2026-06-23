/**
 * Graph-store adapter for the AI lane (U20).
 *
 * `tools.ts` is deliberately pure: it applies tool calls through the SMALL
 * {@link GraphStoreApi} interface defined here, never importing Zustand or React
 * directly, so it unit-tests against a fake. {@link createGraphStoreApi} is the
 * one concrete binding to the real `useGraphStore` — the same verbs the canvas
 * UI calls (`addNode`, `addConnection`, `updateNodeData`, `removeNode`,
 * `removeConnection`).
 */

import type { Connection, GraphNode, NodeType, Position } from '../engine/types';
import { useGraphStore } from '../store/graphStore';
import { useCanvasStore } from '../store/canvasStore';
import { useCanvasNavigationStore } from '../store/canvasNavigationStore';
import { nodeDefinitions, menuCategories } from '../engine/registry';
import { toPortSummary, type PortSummary } from './types';

/**
 * One addable node type, as surfaced by `list_node_types` (M3): the registry id,
 * its human name + description, and the menu category it lives in. Built from the
 * registry's USER-FACING set (the {@link menuCategories} menu), so the agent only
 * ever sees types a user could actually add — internal/visual nodes are excluded.
 */
export interface NodeTypeInfo {
    type: NodeType;
    name: string;
    description: string;
    category: string;
    /**
     * The type's declared ports (its static `defaultPorts`), lean — so the agent
     * can wire a planned node by a real port NAME. Empty when the type GENERATES
     * its ports at runtime (see {@link dynamicPorts}).
     */
    ports: PortSummary[];
    /**
     * True when this type's ports only appear once the node is ADDED (container /
     * internal-io nodes have empty `defaultPorts`): the agent should add it, then
     * call get_graph / find_nodes to read the node's real ports.
     */
    dynamicPorts: boolean;
}

/**
 * A captured node plus the connections incident to it, enough to faithfully
 * recreate the node when undoing a `remove_node`.
 */
export interface NodeSnapshot {
    node: GraphNode;
    connections: Connection[];
}

/**
 * The minimal slice of the graph store the agent tools need. Mirrors the real
 * `graphStore` verbs 1:1 (plus a couple of read/restore helpers for reversible
 * undo and viewport-centred placement).
 */
export interface GraphStoreApi {
    addNode(
        type: NodeType,
        position: Position,
        parentId: string | null,
        initialData: Record<string, unknown>,
    ): string;
    removeNode(nodeId: string): void;
    updateNodeData(nodeId: string, data: Record<string, unknown>): void;
    addConnection(
        sourceNodeId: string,
        sourcePortId: string,
        targetNodeId: string,
        targetPortId: string,
    ): string | null;
    removeConnection(connectionId: string): void;

    getNode(nodeId: string): GraphNode | undefined;
    getConnection(connectionId: string): Connection | undefined;

    /** Capture a node + its connections so a removal can be reverted. */
    snapshotNode(nodeId: string): NodeSnapshot;
    /** Recreate a node (and its connections) from a {@link NodeSnapshot}. */
    restoreNode(snapshot: NodeSnapshot): void;

    /** Canvas position used when a tool call omits one (current viewport centre). */
    viewportCenter(): Position;

    // --- READ-ONLY introspection (M3) ----------------------------------------
    // These NEVER mutate; they back the side-effect-free read tools so the agent
    // can ground its plan in the live graph + registry before mutating.

    /** Every node in the graph (all hierarchy levels). */
    listNodes(): GraphNode[];
    /** Every connection in the graph (all levels). */
    listConnections(): Connection[];
    /** Nodes filtered to a single type (for `find_nodes`). */
    findNodesByType(type: NodeType): GraphNode[];
    /** The user-addable node types + descriptions (from the registry). */
    listNodeTypes(): NodeTypeInfo[];
}

/**
 * Bind {@link GraphStoreApi} to the live Zustand graph/canvas stores. This is
 * the ONLY place the AI lane reaches into the real graph state.
 */
export function createGraphStoreApi(): GraphStoreApi {
    const graph = () => useGraphStore.getState();

    return {
        addNode: (type, position, parentId, initialData) =>
            graph().addNode(type, position, parentId, initialData),
        removeNode: (nodeId) => graph().removeNode(nodeId),
        updateNodeData: (nodeId, data) => graph().updateNodeData(nodeId, data),
        addConnection: (s, sp, t, tp) => graph().addConnection(s, sp, t, tp),
        removeConnection: (connectionId) => graph().removeConnection(connectionId),

        getNode: (nodeId) => graph().getNode(nodeId),
        getConnection: (connectionId) => graph().connections.get(connectionId),

        snapshotNode: (nodeId) => {
            const state = graph();
            const node = state.nodes.get(nodeId);
            if (!node) {
                throw new Error(`snapshotNode: node ${nodeId} not found`);
            }
            const connections = Array.from(state.connections.values()).filter(
                (c) => c.sourceNodeId === nodeId || c.targetNodeId === nodeId,
            );
            // Deep-ish clone so later mutations cannot corrupt the snapshot.
            return {
                node: structuredClone(node),
                connections: connections.map((c) => structuredClone(c)),
            };
        },

        restoreNode: (snapshot) => {
            const state = graph();
            // Recreate the node at its original type/position/data, then re-link.
            const newId = state.addNode(
                snapshot.node.type,
                snapshot.node.position,
                snapshot.node.parentId,
                snapshot.node.data as Record<string, unknown>,
            );
            for (const c of snapshot.connections) {
                const source = c.sourceNodeId === snapshot.node.id ? newId : c.sourceNodeId;
                const target = c.targetNodeId === snapshot.node.id ? newId : c.targetNodeId;
                state.addConnection(source, c.sourcePortId, target, c.targetPortId);
            }
        },

        viewportCenter: () => {
            const screenCenter: Position = {
                x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
                y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
            };
            return useCanvasStore.getState().screenToCanvas(screenCenter);
        },

        // --- READ-ONLY introspection (M3): pure reads, no store mutation. -----
        listNodes: () => Array.from(graph().nodes.values()),
        listConnections: () => Array.from(graph().connections.values()),
        findNodesByType: (type) => graph().getNodesByType(type),
        listNodeTypes: () => listAddableNodeTypes(),
    };
}

/**
 * The USER-ADDABLE node types from the registry, deduped, in menu order. We walk
 * {@link menuCategories} (the user-facing menu) rather than every key of
 * {@link nodeDefinitions} so internal/visual nodes (e.g. `*-visual`,
 * `canvas-input`) never leak into the agent's choices. Keeping this in the
 * adapter preserves the rule that the adapter is the ONLY reach into
 * graph/registry state.
 */
function listAddableNodeTypes(): NodeTypeInfo[] {
    const seen = new Set<NodeType>();
    const out: NodeTypeInfo[] = [];
    for (const category of menuCategories) {
        for (const type of category.items) {
            if (seen.has(type)) continue;
            seen.add(type);
            const def = nodeDefinitions[type];
            if (!def) continue;
            out.push({
                type,
                name: def.name,
                description: def.description,
                category: category.name,
                ports: def.defaultPorts.map(toPortSummary),
                dynamicPorts: def.defaultPorts.length === 0,
            });
        }
    }
    return out;
}

/** The canvas level the user is currently viewing (for default node placement). */
export function currentParentId(): string | null {
    return useCanvasNavigationStore.getState().currentViewNodeId;
}
