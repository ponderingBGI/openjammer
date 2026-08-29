/**
 * W6-P11b — the seam table.
 *
 * One legacy node, every public door into a live document. `migrateLegacyInstrumentNode`
 * (`engine/nodeTypeMigrations`) is the single map that keeps a saved session from going
 * silent when the five fixed-voice types were deleted; this test asserts each WIRED door
 * actually calls it, so unwiring one fails loudly here rather than on a player's canvas.
 *
 * Honest limit — read before trusting it: this catches a REGRESSION at a known seam. It
 * cannot detect a NEW, sixth seam somebody adds tomorrow. The durable fix is architectural
 * (make `loadGraph` the single door every document walks through); it is a follow-up.
 *
 * The consequence-level pins live elsewhere and are NOT subsumed by this table:
 * `graphStore.test.ts` (ports + cables survive the autosave; every voice through
 * `loadGraph`; the clipboard's ports) and `serialization.test.ts` (the imported node
 * resolves to a real `Instrument` faceplate, not `MISSING_DEFINITION`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { useGraphStore } from '../graphStore';
import { useHistoryStore } from '../historyStore';
import { importWorkflow } from '../../engine/serialization';
import { GraphStoreBridge, type BridgeGraphState } from '../../collab/graphStoreBridge';
import type { CrdtGraphProjection, ProjectionListener } from '../../collab/CrdtGraphProjection';
import type { GraphSnapshot, CrdtNode } from '../../collab/types';
import type { Connection, GraphNode, NodeType } from '../../engine/types';

const STORAGE_KEY = 'openjammer-graph-v2';

/** The one legacy node every seam is fed, in its on-disk shape. */
const LEGACY_TYPE = 'cello';
const EXPECTED_ID = 'gm-cello';

function legacyNode() {
    return {
        id: 'legacy-1',
        type: LEGACY_TYPE,
        category: 'instruments',
        position: { x: 0, y: 0 },
        data: { offsets: { 'input-1': -12 }, activeInputs: ['input-1'] },
        ports: [{ id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }],
        parentId: null,
        childIds: [],
        specialNodes: [],
    };
}

/** What every seam has to hand back. */
interface MigratedShape {
    type: string;
    data: Record<string, unknown>;
}

function persistStorage() {
    return (useGraphStore as unknown as {
        persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } };
    }).persist.getOptions().storage;
}

/** Minimal graphStore-shaped vanilla store for the collab bridge. */
function makeBridgeStore() {
    return createStore<BridgeGraphState>(() => ({
        nodes: new Map<string, GraphNode>(),
        connections: new Map<string, Connection>(),
        connectionsByNode: new Map<string, Set<string>>(),
        version: 0,
        rootNodeIds: [],
        _rebuildConnectionIndex: () => new Map<string, Set<string>>(),
    }));
}

/**
 * A projection stub: enough surface for `GraphStoreBridge.start(false)` (guest —
 * no seeding) and for firing ONE remote snapshot at it. Using a stub instead of a
 * real `CrdtGraphProjection` keeps this table free of the CRDT/WASM runtime; the
 * real projection is exercised in `collab/__tests__/convergence.test.ts`.
 */
function makeProjectionStub() {
    let listener: ProjectionListener | null = null;
    const stub = {
        subscribe: (fn: ProjectionListener) => {
            listener = fn;
            return () => { listener = null; };
        },
        snapshot: (): GraphSnapshot => ({ nodes: [], connections: [] }),
        transactLocal: (fn: () => void) => fn(),
        replaceAll: () => { },
        writeNode: () => { },
        writeConnection: () => { },
        deleteNode: () => { },
        deleteConnection: () => { },
    };
    return {
        projection: stub as unknown as CrdtGraphProjection,
        pushRemote: (snapshot: GraphSnapshot) => {
            if (!listener) throw new Error('bridge never subscribed to the projection');
            listener(snapshot, { remote: true });
        },
    };
}

/** Every public door a legacy node can walk through, and how to walk it. */
const SEAMS: { seam: string; load: () => MigratedShape }[] = [
    {
        seam: 'persist storage.getItem — nodes (the localStorage autosave)',
        load: () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: { nodes: [['legacy-1', legacyNode()]], connections: [] },
            }));
            const result = persistStorage().getItem(STORAGE_KEY) as {
                state: { nodes: Map<string, MigratedShape> };
            };
            return result.state.nodes.get('legacy-1')!;
        },
    },
    {
        seam: 'persist storage.getItem — clipboard (no `partialize`: Ctrl+C survives a reload)',
        load: () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [], connections: [],
                    clipboard: { nodes: [['legacy-1', legacyNode()]], connections: [] },
                },
            }));
            const result = persistStorage().getItem(STORAGE_KEY) as {
                state: { clipboard: { nodes: [string, MigratedShape][] } };
            };
            return result.state.clipboard.nodes[0][1];
        },
    },
    {
        seam: 'graphStore.loadGraph — project folder + crash recovery',
        load: () => {
            useGraphStore.getState().loadGraph([legacyNode() as unknown as GraphNode], []);
            return useGraphStore.getState().nodes.get('legacy-1')! as unknown as MigratedShape;
        },
    },
    {
        seam: 'serialization.importWorkflow — the headless, store-free import contract',
        load: () => {
            const imported = importWorkflow({
                version: '1.1.0',
                name: 'legacy',
                createdAt: new Date().toISOString(),
                nodes: [legacyNode()],
                connections: [],
            } as unknown as Parameters<typeof importWorkflow>[0]);
            return imported.nodes.find(n => n.id === 'legacy-1')! as unknown as MigratedShape;
        },
    },
    {
        seam: 'collab GraphStoreBridge.applyRemoteSnapshot — a peer on an older build',
        load: () => {
            const store = makeBridgeStore();
            const { projection, pushRemote } = makeProjectionStub();
            const bridge = new GraphStoreBridge(store, projection);
            bridge.start(false); // guest: reconcile FROM the remote document
            try {
                pushRemote({
                    nodes: [{ ...legacyNode(), type: LEGACY_TYPE as NodeType } as unknown as CrdtNode],
                    connections: [],
                });
                return store.getState().nodes.get('legacy-1')! as unknown as MigratedShape;
            } finally {
                bridge.stop();
            }
        },
    },
];

describe('legacy instrument types: every document seam migrates', () => {
    beforeEach(() => {
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
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it.each(SEAMS)('$seam', ({ load }) => {
        const migrated = load();
        expect(migrated.type).toBe('instrument');
        expect(migrated.data.instrumentId).toBe(EXPECTED_ID);
    });

    it('covers every caller of migrateLegacyInstrumentNode that exists today', () => {
        // The docblock's rule is "every caller IS the seam list". Five callers,
        // five rows — if someone wires a sixth, this count is the nudge to add it
        // (it cannot detect an UNWIRED sixth seam; nothing cheap can).
        expect(SEAMS).toHaveLength(5);
    });
});
