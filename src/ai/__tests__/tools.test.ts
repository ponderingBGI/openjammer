/**
 * Tool-call -> graphStore-verb mapping (U20).
 *
 * Proves that each {@link applyToolCall} routes to the right store verb with the
 * right arguments, returns an accurate `ok`/summary, and that its `undo` exactly
 * reverts the mutation. The store is a FAKE implementing {@link GraphStoreApi},
 * so this exercises the trust-boundary translation with zero Zustand/React/DOM.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyToolCall, type DspNodeRegistrar, type PlanEnv } from '../tools';
import type { GraphStoreApi, NodeSnapshot } from '../graphAdapter';
import type { Connection, GraphNode, NodeType, Position, PortDefinition } from '../../engine/types';
import type { PlanLookups } from '../planValidator';
import type { WorkflowPlan } from '../plan';

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
        // READ-ONLY introspection (M3).
        listNodes: () => Array.from(nodes.values()),
        listConnections: () => Array.from(connections.values()),
        findNodesByType: (type) => Array.from(nodes.values()).filter((n) => n.type === type),
        listNodeTypes: () => [
            { type: 'looper' as NodeType, name: 'Looper', description: 'loop', category: 'Routing' },
            { type: 'speaker' as NodeType, name: 'Speaker', description: 'out', category: 'Output' },
        ],
    };

    return { api, nodes, connections };
}

const noopRegistrar: DspNodeRegistrar = { registerDspNode: () => () => {} };

// ---------------------------------------------------------------------------
// A fake PlanEnv (registry knowledge) for the plan tools (M7).
// ---------------------------------------------------------------------------

const PLAN_PORTS: Record<string, PortDefinition[]> = {
    microphone: [{ id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' }],
    amplifier: [
        { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
    ],
    speaker: [{ id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' }],
};

const fakePlanEnv: PlanEnv = {
    lookups: {
        isKnownType: (type) => type in PLAN_PORTS,
        portsFor: (type) => PLAN_PORTS[type] ?? [],
        canConnect: (s, t) => s.direction !== t.direction,
        isSink: (type) => type === 'speaker',
    } satisfies PlanLookups,
    resolvePort: (type, name) =>
        (PLAN_PORTS[type as string] ?? []).find((p) => p.name === name)?.id,
};

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
        // M7: the assigned id is also surfaced as a STRUCTURED field (emit_plan
        // reads this, not the summary string).
        expect(res.nodeId).toBe(id);

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

describe('applyToolCall — reads (M3) are side-effect-free', () => {
    it('get_graph returns a compact node/connection summary with a NO-OP undo', () => {
        const { api, nodes } = makeFakeStore();
        const a = api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, { duration: 5 });
        const b = api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});
        api.addConnection(a, 'audio-out', b, 'audio-in');
        const sizeBefore = nodes.size;

        const res = applyToolCall({ name: 'get_graph', args: {} }, api, noopRegistrar);
        expect(res.ok).toBe(true);
        const data = res.data as {
            nodes: { id: string; type: string; dataKeys: string[] }[];
            connections: { id: string; sourceNodeId: string; targetNodeId: string }[];
        };
        expect(data.nodes).toHaveLength(2);
        expect(data.connections).toHaveLength(1);
        expect(data.nodes.find((n) => n.id === a)?.dataKeys).toContain('duration');

        // Read does NOT mutate and its undo is a harmless no-op.
        res.undo();
        expect(nodes.size).toBe(sizeBefore);
    });

    it('list_node_types relays the registry summary with a NO-OP undo', () => {
        const { api, nodes } = makeFakeStore();
        const res = applyToolCall({ name: 'list_node_types', args: {} }, api, noopRegistrar);
        expect(res.ok).toBe(true);
        const data = res.data as { type: string; name: string }[];
        expect(data.map((t) => t.type)).toEqual(['looper', 'speaker']);
        res.undo();
        expect(nodes.size).toBe(0);
    });

    it('find_nodes filters by type and omitting type returns all', () => {
        const { api } = makeFakeStore();
        api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, {});
        api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});
        api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, {});

        const loopers = applyToolCall(
            { name: 'find_nodes', args: { type: 'looper' as NodeType } },
            api,
            noopRegistrar,
        );
        expect((loopers.data as unknown[])).toHaveLength(2);

        const all = applyToolCall({ name: 'find_nodes', args: {} }, api, noopRegistrar);
        expect((all.data as unknown[])).toHaveLength(3);
    });
});

describe('applyToolCall — batch_apply (M3)', () => {
    it('applies all sub-calls and a single undo reverts the whole frame', () => {
        const { api, nodes, connections } = makeFakeStore();

        // Pre-seed two nodes so the batch can connect them by known ids.
        const a = api.addNode('looper' as NodeType, { x: 0, y: 0 }, null, {});
        const b = api.addNode('speaker' as NodeType, { x: 0, y: 0 }, null, {});
        const nodesBefore = nodes.size;

        const res = applyToolCall(
            {
                name: 'batch_apply',
                args: {
                    calls: [
                        { name: 'add_node', args: { type: 'amplifier' as NodeType } },
                        {
                            name: 'add_connection',
                            args: {
                                sourceNodeId: a,
                                sourcePortId: 'audio-out',
                                targetNodeId: b,
                                targetPortId: 'audio-in',
                            },
                        },
                    ],
                },
            },
            api,
            noopRegistrar,
        );

        expect(res.ok).toBe(true);
        expect(nodes.size).toBe(nodesBefore + 1);
        expect(connections.size).toBe(1);
        const data = res.data as { status: { ok: boolean }[] };
        expect(data.status.every((s) => s.ok)).toBe(true);

        // ONE undo reverts the entire frame.
        res.undo();
        expect(nodes.size).toBe(nodesBefore);
        expect(connections.size).toBe(0);

        // Undo is idempotent.
        res.undo();
        expect(nodes.size).toBe(nodesBefore);
    });

    it('FAIL-CLOSED: an invalid sub-call reverts the whole frame + reports which failed', () => {
        const { api, nodes, connections } = makeFakeStore();
        const nodesBefore = nodes.size;

        const res = applyToolCall(
            {
                name: 'batch_apply',
                args: {
                    calls: [
                        // ok: adds a node
                        { name: 'add_node', args: { type: 'looper' as NodeType } },
                        // FAILS: add_connection referencing a missing source — the
                        // fake assigns ids, but remove_connection of a missing edge
                        // is the deterministic failing case; use remove_node on a
                        // node that does not exist.
                        { name: 'remove_node', args: { nodeId: 'does-not-exist' } },
                        // would-be ok, but must never run after the failure
                        { name: 'add_node', args: { type: 'speaker' as NodeType } },
                    ],
                },
            },
            api,
            noopRegistrar,
        );

        expect(res.ok).toBe(false);
        // The whole frame reverted: the first add_node was rolled back.
        expect(nodes.size).toBe(nodesBefore);
        expect(connections.size).toBe(0);

        const data = res.data as {
            status: { index: number; name: string; ok: boolean }[];
            postState: { nodes: unknown[] };
        };
        // Per-sub-call status enumerates WHICH failed and stops at the failure.
        expect(data.status).toHaveLength(2);
        expect(data.status[0]).toMatchObject({ index: 0, name: 'add_node', ok: true });
        expect(data.status[1]).toMatchObject({ index: 1, name: 'remove_node', ok: false });
        // postState is the graph AFTER the revert.
        expect(data.postState.nodes).toHaveLength(nodesBefore);

        // Already reverted: undo is a no-op (does not double-revert).
        expect(() => res.undo()).not.toThrow();
        expect(nodes.size).toBe(nodesBefore);
    });

    it('rejects a NESTED batch_apply (no recursion)', () => {
        const { api, nodes } = makeFakeStore();
        const nodesBefore = nodes.size;

        const res = applyToolCall(
            {
                name: 'batch_apply',
                args: {
                    calls: [
                        { name: 'add_node', args: { type: 'looper' as NodeType } },
                        { name: 'batch_apply', args: { calls: [] } },
                    ],
                },
            },
            api,
            noopRegistrar,
        );

        expect(res.ok).toBe(false);
        // The whole frame reverted (the first add_node rolled back).
        expect(nodes.size).toBe(nodesBefore);
        const data = res.data as { status: { name: string; ok: boolean }[] };
        const nested = data.status.find((s) => s.name === 'batch_apply');
        expect(nested?.ok).toBe(false);
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

describe('applyToolCall — author_code_node (M6)', () => {
    it('routes to registerCodeNode and undo unregisters (reversible)', () => {
        const { api } = makeFakeStore();
        const unregister = vi.fn();
        const registrar: DspNodeRegistrar = {
            registerDspNode: vi.fn(() => () => {}),
            registerCodeNode: vi.fn(() => unregister),
        };

        const res = applyToolCall(
            {
                name: 'author_code_node',
                args: { name: 'Tape Echo', source: 'process = _;', lang: 'faust' },
            },
            api,
            registrar,
        );
        expect(res.ok).toBe(true);
        expect(registrar.registerCodeNode).toHaveBeenCalledOnce();
        // It must NOT fall back to the legacy path when registerCodeNode exists.
        expect(registrar.registerDspNode).not.toHaveBeenCalled();
        expect(res.summary).toContain('Tape Echo');

        res.undo();
        expect(unregister).toHaveBeenCalledOnce();
        res.undo();
        expect(unregister).toHaveBeenCalledOnce(); // idempotent
    });

    it('defaults lang to "faust" and passes it through', () => {
        const { api } = makeFakeStore();
        const registerCodeNode = vi.fn(() => () => {});
        const registrar: DspNodeRegistrar = {
            registerDspNode: vi.fn(() => () => {}),
            registerCodeNode,
        };

        applyToolCall(
            { name: 'author_code_node', args: { name: 'X', source: 'process = _;' } },
            api,
            registrar,
        );
        expect(registerCodeNode).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'X', source: 'process = _;', lang: 'faust' }),
        );
    });

    it('adapts to a pre-M6 registrar (only registerDspNode) for back-compat', () => {
        const { api } = makeFakeStore();
        const unregister = vi.fn();
        const registrar: DspNodeRegistrar = {
            registerDspNode: vi.fn(() => unregister),
            // no registerCodeNode
        };

        const res = applyToolCall(
            { name: 'author_code_node', args: { name: 'Legacy', source: 'process = _;' } },
            api,
            registrar,
        );
        expect(res.ok).toBe(true);
        // Falls back to the stored-source path, mapping source -> faustSource.
        expect(registrar.registerDspNode).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Legacy', faustSource: 'process = _;' }),
        );
        res.undo();
        expect(unregister).toHaveBeenCalledOnce();
    });
});

describe('applyToolCall — validate_plan (M7) is advisory + side-effect-free', () => {
    const plan: WorkflowPlan = {
        nodes: [
            { ref: 'mic', type: 'microphone' },
            { ref: 'out', type: 'speaker' },
        ],
        wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } }],
    };

    it('returns PlanError[] and mutates NOTHING (no-op undo)', () => {
        const { api, nodes, connections } = makeFakeStore();
        // A plan with an unknown type so the validator reports an error.
        const bad: WorkflowPlan = {
            nodes: [
                { ref: 'x', type: 'nope' },
                { ref: 'out', type: 'speaker' },
            ],
            wires: [],
        };
        const res = applyToolCall({ name: 'validate_plan', args: bad }, api, noopRegistrar, fakePlanEnv);
        expect(res.ok).toBe(true);
        const errs = res.data as { code: string }[];
        expect(errs.some((e) => e.code === 'UNKNOWN_TYPE')).toBe(true);
        // No mutation whatsoever.
        expect(nodes.size).toBe(0);
        expect(connections.size).toBe(0);
        expect(() => res.undo()).not.toThrow();
    });

    it('returns an empty error list for a sound plan', () => {
        const { api } = makeFakeStore();
        const res = applyToolCall({ name: 'validate_plan', args: plan }, api, noopRegistrar, fakePlanEnv);
        expect((res.data as unknown[]).length).toBe(0);
    });
});

describe('applyToolCall — emit_plan (M7) applies as ONE reversible frame', () => {
    const plan: WorkflowPlan = {
        nodes: [
            { ref: 'mic', type: 'microphone' },
            { ref: 'amp', type: 'amplifier', params: { gain: 2 } },
            { ref: 'out', type: 'speaker' },
        ],
        wires: [
            { from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'amp', port: 'Audio In' } },
            { from: { ref: 'amp', port: 'Audio Out' }, to: { ref: 'out', port: 'Audio In' } },
        ],
    };

    it('builds the whole workflow and a single undo reverts it', () => {
        const { api, nodes, connections } = makeFakeStore();
        const res = applyToolCall({ name: 'emit_plan', args: plan }, api, noopRegistrar, fakePlanEnv);

        expect(res.ok).toBe(true);
        expect(nodes.size).toBe(3);
        expect(connections.size).toBe(2);
        // The amp node carries its param via the lowered update_node_data.
        const amp = [...nodes.values()].find((n) => n.type === 'amplifier');
        expect(amp?.data.gain).toBe(2);
        // Wires resolved to the REAL node ids (via the structured nodeId field),
        // never the symbolic plan refs.
        const nodeIds = new Set(nodes.keys());
        for (const c of connections.values()) {
            expect(nodeIds.has(c.sourceNodeId)).toBe(true);
            expect(nodeIds.has(c.targetNodeId)).toBe(true);
        }
        // The validator passed, so no divergence.
        const data = res.data as { validatorErrors: unknown[]; divergence: boolean };
        expect(data.validatorErrors).toHaveLength(0);
        expect(data.divergence).toBe(false);

        // ONE undo reverts the entire frame; idempotent.
        res.undo();
        expect(nodes.size).toBe(0);
        expect(connections.size).toBe(0);
        res.undo();
        expect(nodes.size).toBe(0);
    });

    it('FAIL-CLOSED: a bad sub-call reverts the whole frame + surfaces divergence', () => {
        // Force add_connection to fail at the store so a validator-clean plan still
        // diverges at runtime — emit_plan must revert everything and flag it.
        const { api, nodes, connections } = makeFakeStore();
        const rejecting: GraphStoreApi = { ...api, addConnection: () => null };

        const res = applyToolCall(
            { name: 'emit_plan', args: plan },
            rejecting,
            noopRegistrar,
            fakePlanEnv,
        );

        expect(res.ok).toBe(false);
        // The whole frame reverted: no nodes, no connections survive.
        expect(nodes.size).toBe(0);
        expect(connections.size).toBe(0);
        const data = res.data as {
            status: { name: string; ok: boolean }[];
            validatorErrors: unknown[];
            divergence: boolean;
        };
        // Per-sub-call status enumerates the steps; the failing one is an add_connection.
        expect(data.status.some((s) => s.name === 'add_connection' && !s.ok)).toBe(true);
        // The validator approved but the runtime failed → divergence is surfaced.
        expect(data.validatorErrors).toHaveLength(0);
        expect(data.divergence).toBe(true);
        // Already reverted: undo is a harmless no-op.
        expect(() => res.undo()).not.toThrow();
    });

    it('applies despite validator warnings but flags the divergence (runtime is truth)', () => {
        // A plan the validator flags (no speaker → NO_SOUND) but which the store can
        // still apply: emit_plan applies it and reports divergence=true.
        const { api, nodes } = makeFakeStore();
        const noSink: WorkflowPlan = {
            nodes: [
                { ref: 'mic', type: 'microphone' },
                { ref: 'amp', type: 'amplifier' },
            ],
            wires: [{ from: { ref: 'mic', port: 'Audio Out' }, to: { ref: 'amp', port: 'Audio In' } }],
        };
        const res = applyToolCall({ name: 'emit_plan', args: noSink }, api, noopRegistrar, fakePlanEnv);
        expect(res.ok).toBe(true);
        expect(nodes.size).toBe(2);
        const data = res.data as { validatorErrors: { code: string }[]; divergence: boolean };
        expect(data.validatorErrors.some((e) => e.code === 'NO_SOUND')).toBe(true);
        expect(data.divergence).toBe(true);
    });

    it('without a PlanEnv emit_plan fails cleanly (no mutation)', () => {
        const { api, nodes } = makeFakeStore();
        const res = applyToolCall({ name: 'emit_plan', args: plan }, api, noopRegistrar);
        expect(res.ok).toBe(false);
        expect(nodes.size).toBe(0);
    });
});
