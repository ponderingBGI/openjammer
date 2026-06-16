/**
 * Tool-call -> graphStore-verb mapping (U20).
 *
 * Proves that each {@link applyToolCall} routes to the right store verb with the
 * right arguments, returns an accurate `ok`/summary, and that its `undo` exactly
 * reverts the mutation. The store is a FAKE implementing {@link GraphStoreApi},
 * so this exercises the trust-boundary translation with zero Zustand/React/DOM.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyToolCall, type DspNodeRegistrar } from '../tools';
import type { GraphStoreApi, NodeSnapshot } from '../graphAdapter';
import type { Connection, GraphNode, NodeType, Position } from '../../engine/types';

// ---------------------------------------------------------------------------
// A minimal in-memory fake graph store.
// ---------------------------------------------------------------------------

function makeFakeStore() {
    const nodes = new Map<string, GraphNode>();
    const connections = new Map<string, Connection>();
    let nodeSeq = 0;
    let connSeq = 0;

    const api: GraphStoreApi = {
        addNode: (type, position, parentId, initialData) => {
            const id = `node-${++nodeSeq}`;
            nodes.set(id, {
                id,
                type,
                category: 'effects',
                position,
                data: { ...initialData },
                ports: [],
                parentId,
                childIds: [],
            });
            return id;
        },
        removeNode: (nodeId) => {
            nodes.delete(nodeId);
            for (const [cid, c] of connections) {
                if (c.sourceNodeId === nodeId || c.targetNodeId === nodeId) {
                    connections.delete(cid);
                }
            }
        },
        updateNodeData: (nodeId, data) => {
            const n = nodes.get(nodeId);
            if (n) n.data = { ...n.data, ...data };
        },
        addConnection: (s, sp, t, tp) => {
            const id = `conn-${++connSeq}`;
            connections.set(id, {
                id,
                sourceNodeId: s,
                sourcePortId: sp,
                targetNodeId: t,
                targetPortId: tp,
                type: 'audio',
            });
            return id;
        },
        removeConnection: (connectionId) => {
            connections.delete(connectionId);
        },
        getNode: (nodeId) => nodes.get(nodeId),
        getConnection: (connectionId) => connections.get(connectionId),
        snapshotNode: (nodeId) => {
            const node = nodes.get(nodeId)!;
            const conns = Array.from(connections.values()).filter(
                (c) => c.sourceNodeId === nodeId || c.targetNodeId === nodeId,
            );
            return {
                node: structuredClone(node),
                connections: conns.map((c) => structuredClone(c)),
            } satisfies NodeSnapshot;
        },
        restoreNode: (snapshot) => {
            const newId = api.addNode(
                snapshot.node.type,
                snapshot.node.position,
                snapshot.node.parentId,
                snapshot.node.data as Record<string, unknown>,
            );
            for (const c of snapshot.connections) {
                const source = c.sourceNodeId === snapshot.node.id ? newId : c.sourceNodeId;
                const target = c.targetNodeId === snapshot.node.id ? newId : c.targetNodeId;
                api.addConnection(source, c.sourcePortId, target, c.targetPortId);
            }
        },
        viewportCenter: (): Position => ({ x: 100, y: 200 }),
    };

    return { api, nodes, connections };
}

const noopRegistrar: DspNodeRegistrar = { registerDspNode: () => () => {} };

describe('applyToolCall — graph mutations', () => {
    it('add_node creates a node and undo removes it', () => {
        const { api, nodes } = makeFakeStore();
        const res = applyToolCall(
            { name: 'add_node', args: { type: 'looper' as NodeType } },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(true);
        expect(nodes.size).toBe(1);
        const [id, node] = [...nodes.entries()][0];
        expect(node.type).toBe('looper');
        expect(res.summary).toContain(id);

        res.undo();
        expect(nodes.size).toBe(0);
    });

    it('add_node uses viewportCenter when no position given', () => {
        const { api, nodes } = makeFakeStore();
        applyToolCall(
            { name: 'add_node', args: { type: 'speaker' as NodeType } },
            api,
            noopRegistrar,
        );
        const node = [...nodes.values()][0];
        expect(node.position).toEqual({ x: 100, y: 200 });
    });

    it('update_node_data merges and undo restores prior values', () => {
        const { api, nodes } = makeFakeStore();
        const id = api.addNode('amplifier' as NodeType, { x: 0, y: 0 }, null, { gain: 1 });

        const res = applyToolCall(
            { name: 'update_node_data', args: { nodeId: id, data: { gain: 3 } } },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(true);
        expect(nodes.get(id)!.data.gain).toBe(3);

        res.undo();
        expect(nodes.get(id)!.data.gain).toBe(1);
    });

    it('update_node_data on a missing node fails with a no-op undo', () => {
        const { api } = makeFakeStore();
        const res = applyToolCall(
            { name: 'update_node_data', args: { nodeId: 'nope', data: { x: 1 } } },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(false);
        expect(() => res.undo()).not.toThrow();
    });

    it('add_connection links ports and undo removes the connection', () => {
        const { api, connections } = makeFakeStore();
        const a = api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, {});
        const b = api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});

        const res = applyToolCall(
            {
                name: 'add_connection',
                args: {
                    sourceNodeId: a,
                    sourcePortId: 'audio-out',
                    targetNodeId: b,
                    targetPortId: 'audio-in',
                },
            },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(true);
        expect(connections.size).toBe(1);

        res.undo();
        expect(connections.size).toBe(0);
    });

    it('remove_node snapshots, removes, and undo recreates the node + edges', () => {
        const { api, nodes, connections } = makeFakeStore();
        const a = api.addNode('looper' as NodeType, { x: 1, y: 2 }, null, { duration: 5 });
        const b = api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});
        api.addConnection(a, 'audio-out', b, 'audio-in');

        const res = applyToolCall(
            { name: 'remove_node', args: { nodeId: a } },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(true);
        expect(nodes.has(a)).toBe(false);
        expect(connections.size).toBe(0); // dangling edge dropped with the node

        res.undo();
        // A node of the same type/data is recreated, and its edge to b is relinked.
        const recreated = [...nodes.values()].find((n) => n.type === 'looper');
        expect(recreated).toBeDefined();
        expect(recreated!.data.duration).toBe(5);
        expect(connections.size).toBe(1);
    });

    it('remove_connection by id and undo re-adds an equivalent edge', () => {
        const { api, connections } = makeFakeStore();
        const a = api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, {});
        const b = api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});
        const cid = api.addConnection(a, 'audio-out', b, 'audio-in')!;

        const res = applyToolCall(
            { name: 'remove_connection', args: { connectionId: cid } },
            api,
            noopRegistrar,
        );
        expect(res.ok).toBe(true);
        expect(connections.size).toBe(0);

        res.undo();
        expect(connections.size).toBe(1);
        const conn = [...connections.values()][0];
        expect(conn.sourceNodeId).toBe(a);
        expect(conn.targetNodeId).toBe(b);
    });

    it('add_connection that the store rejects (null) reports failure', () => {
        const { api } = makeFakeStore();
        const rejecting: GraphStoreApi = { ...api, addConnection: () => null };
        const res = applyToolCall(
            {
                name: 'add_connection',
                args: {
                    sourceNodeId: 'x',
                    sourcePortId: 'a',
                    targetNodeId: 'y',
                    targetPortId: 'b',
                },
            },
            rejecting,
            noopRegistrar,
        );
        expect(res.ok).toBe(false);
        expect(() => res.undo()).not.toThrow();
    });
});

describe('applyToolCall — author_dsp_node', () => {
    it('delegates to the registrar and undo unregisters', () => {
        const { api } = makeFakeStore();
        const unregister = vi.fn();
        const registrar: DspNodeRegistrar = {
            registerDspNode: vi.fn(() => unregister),
        };

        const res = applyToolCall(
            {
                name: 'author_dsp_node',
                args: { name: 'My Reverb', faustSource: 'process = _;', compiled: false },
            },
            api,
            registrar,
        );
        expect(res.ok).toBe(true);
        expect(registrar.registerDspNode).toHaveBeenCalledOnce();
        expect(res.summary).toContain('My Reverb');

        res.undo();
        expect(unregister).toHaveBeenCalledOnce();
        // undo is idempotent — calling again does nothing.
        res.undo();
        expect(unregister).toHaveBeenCalledOnce();
    });
});
