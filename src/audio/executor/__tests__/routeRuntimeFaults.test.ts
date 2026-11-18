/**
 * The runtime-CRASH badge tap shared by both executor tiers.
 *
 * `routeRuntimeFaults` is how a hosted plugin that CRASHED at runtime (the
 * per-node fault latch) — or a trapped code node on the wasm tier — reaches the
 * SAME non-modal "(missing/crashed plugin)" badge the load-degraded path drives
 * (`setNodePluginLoadError`). Two invariants matter:
 *
 *  1. Terminal `Crashed` and watchdog `AutoBypassed` faults badge; transient
 *     NonFinite / OverBudget stay in the DevLog.
 *  2. It is SET-ONLY — clearing is owned by the next clean `push_graph`, so a
 *     fresh instantiate on a graph swap auto-clears. (Verified by the executor
 *     degraded-id loop elsewhere; here we assert the tap only ever sets true.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { routeRuntimeFaults } from '../faultPipe';
import type { NodeData } from '../../../engine/types';
import type { Event as EngineEvent, FaultKind } from '../../../../packages/oj-protocol-ts/src/index';
import { useHistoryStore } from '../../../store/historyStore';

const STORAGE_KEY = 'openjammer-graph-v2';

function reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
}

function addEffect(): string {
    useGraphStore.getState().addNode('effect', { x: 0, y: 0 });
    const node = Array.from(useGraphStore.getState().nodes.values()).find((n) => n.type === 'effect');
    if (!node) throw new Error('effect node not created');
    return node.id;
}

function nodeFault(node: number, fault: FaultKind): EngineEvent {
    return {
        v: 1,
        seq: 1,
        severity: 'Error',
        kind: { NodeFault: { node, fault } },
        source: 'Engine',
        ts_us: 0,
        corr_id: 0,
    } as unknown as EngineEvent;
}

const flag = (id: string): boolean | undefined =>
    (useGraphStore.getState().nodes.get(id)!.data as NodeData).pluginLoadError;

describe('routeRuntimeFaults', () => {
    beforeEach(reset);

    it('badges the node on a NodeFault{Crashed}', () => {
        const id = addEffect();
        routeRuntimeFaults([nodeFault(5, 'Crashed')], (n) => (n === 5 ? id : undefined));
        expect(flag(id)).toBe(true);
    });

    it('badges the node on a NodeFault{AutoBypassed}', () => {
        const id = addEffect();
        routeRuntimeFaults([nodeFault(5, 'AutoBypassed')], (n) => (n === 5 ? id : undefined));
        expect(flag(id)).toBe(true);
    });

    it('does NOT badge on transient faults (NonFinite / OverBudget)', () => {
        const id = addEffect();
        routeRuntimeFaults(
            [nodeFault(5, 'NonFinite'), nodeFault(5, 'OverBudget')],
            () => id,
        );
        expect(flag(id)).toBeUndefined();
    });

    it('only ever SETS the badge true (never clears — clear is the push_graph owner)', () => {
        const id = addEffect();
        routeRuntimeFaults([nodeFault(5, 'Crashed')], () => id);
        expect(flag(id)).toBe(true);
        // A later batch with no Crashed fault must NOT clear it.
        routeRuntimeFaults([nodeFault(5, 'NonFinite')], () => id);
        expect(flag(id)).toBe(true);
    });

    it('is safe when the engine node does not resolve to a visual id', () => {
        expect(() => routeRuntimeFaults([nodeFault(9, 'Crashed')], () => undefined)).not.toThrow();
    });

    it('grows the undo history by ZERO — a crash is not an edit', () => {
        // A crash writes TWO things onto the node: the badge flag (via
        // `setNodePluginLoadError`, fixed in a28f710) and the fault kind +
        // bypass pair right beside it. Only the first took `{ record: false }`,
        // so one crash mid-set still minted an undo entry and the player's next
        // `Ctrl+Z` un-bypassed a dead plugin instead of undoing their edit.
        const id = addEffect();
        useHistoryStore.getState().clear();

        routeRuntimeFaults([nodeFault(5, 'Crashed')], () => id);

        const data = useGraphStore.getState().nodes.get(id)!.data as NodeData & {
            pluginFaultKind?: string;
            pluginBypassed?: boolean;
        };
        // Both writes LANDED — silent is not a no-op…
        expect(data.pluginLoadError).toBe(true);
        expect(data.pluginFaultKind).toBe('Crashed');
        expect(data.pluginBypassed).toBe(true);
        // …and history never noticed either of them.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('leaves the player their own last edit to undo', () => {
        const id = addEffect();
        useGraphStore.getState().addNode('speaker', { x: 400, y: 0 });
        const speakerId = Array.from(useGraphStore.getState().nodes.values())
            .find((n) => n.type === 'speaker')!.id;
        useHistoryStore.getState().clear();

        useGraphStore.getState().updateNodeData(speakerId, { volume: 0.25 });
        routeRuntimeFaults([nodeFault(5, 'Crashed')], () => id);

        expect(useHistoryStore.getState().entries).toHaveLength(1);
        useGraphStore.getState().undo();
        expect(
            (useGraphStore.getState().nodes.get(speakerId)!.data as { volume?: number }).volume,
        ).not.toBe(0.25);
        expect(flag(id)).toBe(true);
    });
});
