/**
 * U23 — graphStore <-> CRDT bridge (read-through view).
 *
 * The architecture's binding contract is that ALL graph mutations go through the
 * graphStore verbs (addNode / addConnection / updateNodeData / removeNode / …).
 * Rather than rewrite each verb to emit CRDT ops, this bridge observes the
 * store's monotonic `version` counter (bumped by every verb) and DIFFS the
 * resulting state into the CRDT projection. This keeps single-user behavior
 * byte-for-byte identical when no session is active — the bridge is simply not
 * installed — and makes the CRDT a transparent layer over the existing verbs.
 *
 * Directionality + echo prevention:
 *   • LOCAL verb  ->  version bumps  ->  diff into CRDT  ->  commit(LOCAL_ORIGIN)
 *   • REMOTE op   ->  projection fires (remote=true)     ->  reconcile into store
 *                     under an `applyingRemote` guard so the store update does
 *                     NOT get diffed back into the CRDT (no echo / no loop).
 *   • The projection event for our OWN local commit arrives with by==="local"
 *     and remote===false, which the bridge ignores.
 *
 * Remote applications bypass undo history: a peer's edit should not pollute the
 * local undo stack, and reconciliation writes the store directly via setState.
 */

import type { StoreApi } from 'zustand';
import type { Connection, GraphNode } from '../engine/types';
import { CrdtGraphProjection } from './CrdtGraphProjection';
import {
    fromCrdtConnection,
    fromCrdtNode,
    toCrdtConnection,
    toCrdtNode,
    type GraphSnapshot,
} from './types';

/**
 * The slice of the graph store the bridge needs. Kept structural so the bridge
 * does not import the concrete store (avoids cycles + keeps it testable).
 */
export interface BridgeGraphState {
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
    connectionsByNode: Map<string, Set<string>>;
    version: number;
    rootNodeIds: string[];
    _rebuildConnectionIndex: (connections: Map<string, Connection>) => Map<string, Set<string>>;
}

export type GraphStoreLike = StoreApi<BridgeGraphState>;

export class GraphStoreBridge {
    private unsubscribeStore: (() => void) | null = null;
    private unsubscribeProjection: (() => void) | null = null;
    /** Guard: true while applying a remote snapshot into the store. */
    private applyingRemote = false;
    /** Last store version we have already pushed into the CRDT. */
    private lastSyncedVersion: number;
    private readonly store: GraphStoreLike;
    readonly projection: CrdtGraphProjection;

    constructor(store: GraphStoreLike, projection: CrdtGraphProjection) {
        this.store = store;
        this.projection = projection;
        this.lastSyncedVersion = store.getState().version;
    }

    /**
     * Install the two-way binding.
     *
     * @param seed When true (host / first peer), seed the CRDT from the current
     *             store contents. When false (guest), the store is reconciled
     *             FROM the CRDT once the first remote snapshot arrives.
     */
    start(seed: boolean): void {
        if (seed) {
            // Push the current local graph into the (empty) CRDT as the baseline.
            const snapshot = this.readStoreSnapshot();
            this.projection.transactLocal(() => {
                this.projection.replaceAll(snapshot);
            }, 'seed');
            this.lastSyncedVersion = this.store.getState().version;
        }

        // STORE -> CRDT: diff local verb results into the document.
        this.unsubscribeStore = this.store.subscribe((state: BridgeGraphState) => {
            if (this.applyingRemote) return; // remote application, do not echo
            if (state.version === this.lastSyncedVersion) return; // no graph change
            this.lastSyncedVersion = state.version;
            this.pushStoreToCrdt(state);
        });

        // CRDT -> STORE: reconcile remote changes into the store.
        this.unsubscribeProjection = this.projection.subscribe((snapshot, change) => {
            if (!change.remote) return; // ignore our own local commits
            this.applyRemoteSnapshot(snapshot);
        });
    }

    // ------------------------------------------------------------------------
    // STORE -> CRDT
    // ------------------------------------------------------------------------

    private readStoreSnapshot(): GraphSnapshot {
        const { nodes, connections } = this.store.getState();
        return {
            nodes: Array.from(nodes.values()).map(toCrdtNode),
            connections: Array.from(connections.values()).map(toCrdtConnection),
        };
    }

    /**
     * Diff the store against the CRDT and write only what changed, in a single
     * local transaction. We use a full diff (cheap for these graph sizes) rather
     * than per-verb hooks, which keeps the verbs untouched.
     */
    private pushStoreToCrdt(state: BridgeGraphState): void {
        const current = this.projection.snapshot();
        const crdtNodeIds = new Set(current.nodes.map((n) => n.id));
        const crdtConnIds = new Set(current.connections.map((c) => c.id));
        const storeNodeIds = new Set(state.nodes.keys());
        const storeConnIds = new Set(state.connections.keys());

        // Fast field-equality maps for change detection.
        const crdtNodeById = new Map(current.nodes.map((n) => [n.id, JSON.stringify(n)]));
        const crdtConnById = new Map(current.connections.map((c) => [c.id, JSON.stringify(c)]));

        this.projection.transactLocal(() => {
            // Upsert / update changed nodes.
            for (const node of state.nodes.values()) {
                const cn = toCrdtNode(node);
                const prev = crdtNodeById.get(node.id);
                if (prev === undefined || prev !== JSON.stringify(cn)) {
                    this.projection.writeNode(cn);
                }
            }
            // Delete removed nodes.
            for (const id of crdtNodeIds) {
                if (!storeNodeIds.has(id)) this.projection.deleteNode(id);
            }
            // Upsert / update changed connections.
            for (const conn of state.connections.values()) {
                const cc = toCrdtConnection(conn);
                const prev = crdtConnById.get(conn.id);
                if (prev === undefined || prev !== JSON.stringify(cc)) {
                    this.projection.writeConnection(cc);
                }
            }
            // Delete removed connections.
            for (const id of crdtConnIds) {
                if (!storeConnIds.has(id)) this.projection.deleteConnection(id);
            }
        }, 'verb');
    }

    // ------------------------------------------------------------------------
    // CRDT -> STORE
    // ------------------------------------------------------------------------

    /**
     * Reconcile the store to match a remote snapshot WITHOUT pushing undo
     * history and WITHOUT re-emitting back into the CRDT (guarded). Preserves
     * the store's Map/Set invariants and rebuilds the connection index.
     */
    private applyRemoteSnapshot(snapshot: GraphSnapshot): void {
        this.applyingRemote = true;
        try {
            const newNodes = new Map<string, GraphNode>();
            const rootNodeIds: string[] = [];
            for (const cn of snapshot.nodes) {
                const node = fromCrdtNode(cn);
                newNodes.set(node.id, node);
                if (node.parentId === null) rootNodeIds.push(node.id);
            }
            const newConnections = new Map<string, Connection>();
            for (const cc of snapshot.connections) {
                const conn = fromCrdtConnection(cc);
                newConnections.set(conn.id, conn);
            }

            const rebuildIndex = this.store.getState()._rebuildConnectionIndex;
            this.store.setState((s: BridgeGraphState) => ({
                nodes: newNodes,
                connections: newConnections,
                connectionsByNode: rebuildIndex(newConnections),
                rootNodeIds,
                version: s.version + 1,
            }) as Partial<BridgeGraphState>);

            // Keep our high-water mark in sync so the store subscriber does not
            // re-diff this remotely-applied version back into the CRDT.
            this.lastSyncedVersion = this.store.getState().version;
        } finally {
            this.applyingRemote = false;
        }
    }

    /** True while a remote snapshot is being applied (test/inspection helper). */
    isApplyingRemote(): boolean {
        return this.applyingRemote;
    }

    stop(): void {
        this.unsubscribeStore?.();
        this.unsubscribeProjection?.();
        this.unsubscribeStore = null;
        this.unsubscribeProjection = null;
    }
}
