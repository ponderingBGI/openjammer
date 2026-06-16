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
    };
}

/** The canvas level the user is currently viewing (for default node placement). */
export function currentParentId(): string | null {
    return useCanvasNavigationStore.getState().currentViewNodeId;
}
