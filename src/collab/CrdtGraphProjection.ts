/**
 * U23 — CRDT projection of the OpenJammer node graph.
 *
 * This is the heart of the COLLABORATIVE STATE PLANE. It maps the graph store's
 * flat node/connection model into a Loro CRDT document so that concurrent edits
 * from multiple peers converge automatically.
 *
 * Document layout (Loro):
 *
 *   doc.getMap("nodes")        -> LoroMap<nodeId, LoroMap<field, value>>
 *   doc.getMap("connections")  -> LoroMap<connId, LoroMap<field, value>>
 *
 * Each node/connection is stored as its OWN nested LoroMap rather than as a
 * single opaque JSON value. This matters for convergence: two peers editing
 * DIFFERENT fields of the SAME node (e.g. peer A drags it while peer B renames
 * a param) merge field-by-field instead of clobbering one another with a
 * whole-object last-write-wins. Container-valued fields (position/data/ports/
 * childIds/specialNodes) are themselves serialized to JSON strings so the
 * per-node map stays shallow and import/export stays cheap; field-level granular
 * merge is preserved where it matters most (the top-level node identity + which
 * fields changed). See {@link writeNode}.
 *
 * Origin tagging: every local mutation commits with `origin: LOCAL_ORIGIN`.
 * The subscriber filters those out so locally-applied verbs do not echo back
 * into the store (avoiding feedback loops). Remote ops arrive with
 * `by === "import"` and are forwarded to the store.
 */

import { LoroDoc, LoroMap } from 'loro-crdt';
import type { LoroEventBatch } from 'loro-crdt';
import type { CrdtConnection, CrdtNode, GraphSnapshot } from './types';

/** Commit origin used for mutations that originated from THIS peer's store. */
export const LOCAL_ORIGIN = 'oj-local';

/** Top-level container keys inside the Loro document. */
const NODES_KEY = 'nodes';
const CONNECTIONS_KEY = 'connections';

/**
 * Fields stored as JSON strings inside a node's nested map. Keeping these as
 * scalars (strings) means the per-node map is a flat key/value set; Loro merges
 * those keys with last-write-wins PER KEY, which is the desired semantics for
 * graph editing (two peers touching different keys both win).
 */
type NodeField =
    | 'id' | 'type' | 'category'
    | 'position' | 'data' | 'ports'
    | 'parentId' | 'childIds' | 'specialNodes'
    | 'showEmptyInputPorts' | 'showEmptyOutputPorts';

export interface ProjectionChange {
    /** True when the change came from a remote import (not local store verbs). */
    remote: boolean;
    /** The origin string carried on the originating commit, if any. */
    origin?: string;
}

export type ProjectionListener = (snapshot: GraphSnapshot, change: ProjectionChange) => void;

/**
 * Wraps a single {@link LoroDoc} and exposes graph-shaped read/write helpers
 * plus snapshot import/export for the transport layer.
 */
export class CrdtGraphProjection {
    readonly doc: LoroDoc;
    private readonly listeners = new Set<ProjectionListener>();
    private unsubscribeDoc: (() => void) | null = null;

    constructor(doc?: LoroDoc) {
        this.doc = doc ?? new LoroDoc();
        this.unsubscribeDoc = this.doc.subscribe((event) => this.handleEvent(event));
    }

    /** Stable peer id of the underlying document (string form). */
    get peerId(): string {
        return this.doc.peerIdStr;
    }

    /** Set a deterministic peer id (useful for tests / stable identity). */
    setPeerId(id: string | number | bigint): void {
        this.doc.setPeerId(id as never);
    }

    // ------------------------------------------------------------------------
    // Subscription
    // ------------------------------------------------------------------------

    /** Subscribe to projected snapshots whenever the document changes. */
    subscribe(listener: ProjectionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private handleEvent(event: LoroEventBatch): void {
        // `by` is "local" | "import" | "checkout". Local commits carry our origin
        // tag; we forward both, but flag remoteness so the bridge can avoid
        // re-emitting locally-sourced changes back into the store.
        const remote = event.by !== 'local';
        const snapshot = this.snapshot();
        const change: ProjectionChange = { remote, origin: event.origin };
        for (const listener of this.listeners) listener(snapshot, change);
    }

    // ------------------------------------------------------------------------
    // Containers
    // ------------------------------------------------------------------------

    private nodesMap(): LoroMap {
        return this.doc.getMap(NODES_KEY);
    }

    private connectionsMap(): LoroMap {
        return this.doc.getMap(CONNECTIONS_KEY);
    }

    // ------------------------------------------------------------------------
    // Write helpers (all callers must `commit` afterwards — see commitLocal)
    // ------------------------------------------------------------------------

    private writeNodeFields(nodeMap: LoroMap, node: CrdtNode): void {
        const set = (k: NodeField, v: unknown) => nodeMap.set(k, v as never);
        set('id', node.id);
        set('type', node.type);
        set('category', node.category);
        set('position', JSON.stringify(node.position));
        set('data', JSON.stringify(node.data ?? {}));
        set('ports', JSON.stringify(node.ports ?? []));
        set('parentId', node.parentId === null ? '' : node.parentId);
        set('childIds', JSON.stringify(node.childIds ?? []));
        set('specialNodes', JSON.stringify(node.specialNodes ?? []));
        set('showEmptyInputPorts', node.showEmptyInputPorts === undefined ? '' : JSON.stringify(node.showEmptyInputPorts));
        set('showEmptyOutputPorts', node.showEmptyOutputPorts === undefined ? '' : JSON.stringify(node.showEmptyOutputPorts));
    }

    /** Insert or update a node (does not commit). */
    writeNode(node: CrdtNode): void {
        if (!node || typeof node.id !== 'string' || node.id.length === 0) return;
        const nodes = this.nodesMap();
        const nodeMap = this.ensureChildMap(nodes, node.id);
        this.writeNodeFields(nodeMap, node);
    }

    /**
     * Get the nested LoroMap for `key`, creating a fresh one if absent. Reads via
     * `keys()` rather than `get()` to avoid touching detached containers (e.g.
     * after a concurrent delete), which can fault in the WASM layer.
     */
    private ensureChildMap(parent: LoroMap, key: string): LoroMap {
        if (parent.keys().includes(key)) {
            const existing = parent.get(key);
            if (existing && typeof (existing as { set?: unknown }).set === 'function') {
                return existing as LoroMap;
            }
        }
        return parent.setContainer(key, new LoroMap());
    }

    /** Remove a node (does not commit). */
    deleteNode(nodeId: string): void {
        this.nodesMap().delete(nodeId);
    }

    /** Insert or update a connection (does not commit). */
    writeConnection(conn: CrdtConnection): void {
        if (!conn || typeof conn.id !== 'string' || conn.id.length === 0) return;
        const conns = this.connectionsMap();
        const connMap = this.ensureChildMap(conns, conn.id);
        const set = (k: string, v: unknown) => connMap.set(k, v as never);
        set('id', conn.id);
        set('sourceNodeId', conn.sourceNodeId);
        set('sourcePortId', conn.sourcePortId);
        set('targetNodeId', conn.targetNodeId);
        set('targetPortId', conn.targetPortId);
        set('type', conn.type);
        set('isBundled', conn.isBundled === undefined ? '' : JSON.stringify(conn.isBundled));
    }

    /** Remove a connection (does not commit). */
    deleteConnection(connId: string): void {
        this.connectionsMap().delete(connId);
    }

    /**
     * Replace the ENTIRE graph with the provided snapshot (does not commit).
     * Used by `loadGraph`/`clearGraph` verbs and initial seeding.
     */
    replaceAll(snapshot: GraphSnapshot): void {
        const nodes = this.nodesMap();
        const conns = this.connectionsMap();
        const keepNodeIds = new Set(snapshot.nodes.map((n) => n.id));
        const keepConnIds = new Set(snapshot.connections.map((c) => c.id));

        for (const key of nodes.keys()) {
            if (!keepNodeIds.has(key)) nodes.delete(key);
        }
        for (const key of conns.keys()) {
            if (!keepConnIds.has(key)) conns.delete(key);
        }
        for (const node of snapshot.nodes) this.writeNode(node);
        for (const conn of snapshot.connections) this.writeConnection(conn);
    }

    /**
     * Commit pending writes as a LOCAL transaction with origin tagging.
     * Applying locally returns synchronously; the event fires with by==="local"
     * so the bridge can skip re-emitting into the store.
     */
    commitLocal(message?: string): void {
        this.doc.commit({ origin: LOCAL_ORIGIN, ...(message ? { message } : {}) });
    }

    /** Run a batch of writes then commit them locally in one transaction. */
    transactLocal(fn: () => void, message?: string): void {
        fn();
        this.commitLocal(message);
    }

    // ------------------------------------------------------------------------
    // Read helpers
    // ------------------------------------------------------------------------

    /** Read the entire graph out of the CRDT as a plain snapshot. */
    snapshot(): GraphSnapshot {
        const json = this.doc.toJSON() as {
            [NODES_KEY]?: Record<string, RawNode>;
            [CONNECTIONS_KEY]?: Record<string, RawConnection>;
        };
        const rawNodes = json[NODES_KEY] ?? {};
        const rawConns = json[CONNECTIONS_KEY] ?? {};

        const nodes: CrdtNode[] = [];
        for (const id of Object.keys(rawNodes)) {
            const decoded = decodeNode(rawNodes[id]);
            if (decoded) nodes.push(decoded);
        }
        const connections: CrdtConnection[] = [];
        for (const id of Object.keys(rawConns)) {
            const decoded = decodeConnection(rawConns[id]);
            if (decoded) connections.push(decoded);
        }
        return { nodes, connections };
    }

    /** True if the document currently has no nodes and no connections. */
    isEmpty(): boolean {
        return this.nodesMap().size === 0 && this.connectionsMap().size === 0;
    }

    // ------------------------------------------------------------------------
    // Transport sync (binary)
    // ------------------------------------------------------------------------

    /** Export an incremental update (changes since the given version, or all). */
    exportUpdate(): Uint8Array {
        return this.doc.export({ mode: 'update' });
    }

    /** Export a full snapshot (for seeding a freshly-joined peer). */
    exportSnapshot(): Uint8Array {
        return this.doc.export({ mode: 'snapshot' });
    }

    /** Import a remote update/snapshot. Fires the subscriber with remote=true. */
    import(bytes: Uint8Array): void {
        this.doc.import(bytes);
    }

    /** Subscribe to local binary updates for forwarding over a transport. */
    subscribeLocalUpdates(listener: (bytes: Uint8Array) => void): () => void {
        return this.doc.subscribeLocalUpdates(listener);
    }

    /** Tear down subscriptions. */
    destroy(): void {
        this.unsubscribeDoc?.();
        this.unsubscribeDoc = null;
        this.listeners.clear();
    }
}

// ----------------------------------------------------------------------------
// Decode helpers (the toJSON() shape is string-valued per writeNode)
// ----------------------------------------------------------------------------

interface RawNode {
    id?: string;
    type?: string;
    category?: string;
    position?: string;
    data?: string;
    ports?: string;
    parentId?: string;
    childIds?: string;
    specialNodes?: string;
    showEmptyInputPorts?: string;
    showEmptyOutputPorts?: string;
}

interface RawConnection {
    id?: string;
    sourceNodeId?: string;
    sourcePortId?: string;
    targetNodeId?: string;
    targetPortId?: string;
    type?: string;
    isBundled?: string;
}

function safeParse<T>(value: string | undefined, fallback: T): T {
    if (value === undefined || value === '') return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function decodeNode(raw: RawNode | undefined): CrdtNode | null {
    if (!raw || !raw.id) return null;
    const node: CrdtNode = {
        id: raw.id,
        type: (raw.type ?? 'container') as CrdtNode['type'],
        category: (raw.category ?? 'utility') as CrdtNode['category'],
        position: safeParse(raw.position, { x: 0, y: 0 }),
        data: safeParse(raw.data, {} as Record<string, unknown>),
        ports: safeParse(raw.ports, [] as CrdtNode['ports']),
        parentId: raw.parentId ? raw.parentId : null,
        childIds: safeParse(raw.childIds, [] as string[]),
        specialNodes: safeParse(raw.specialNodes, [] as string[]),
    };
    if (raw.showEmptyInputPorts !== undefined && raw.showEmptyInputPorts !== '') {
        node.showEmptyInputPorts = safeParse(raw.showEmptyInputPorts, false);
    }
    if (raw.showEmptyOutputPorts !== undefined && raw.showEmptyOutputPorts !== '') {
        node.showEmptyOutputPorts = safeParse(raw.showEmptyOutputPorts, false);
    }
    return node;
}

function decodeConnection(raw: RawConnection | undefined): CrdtConnection | null {
    if (!raw || !raw.id) return null;
    const conn: CrdtConnection = {
        id: raw.id,
        sourceNodeId: raw.sourceNodeId ?? '',
        sourcePortId: raw.sourcePortId ?? '',
        targetNodeId: raw.targetNodeId ?? '',
        targetPortId: raw.targetPortId ?? '',
        type: (raw.type ?? 'control') as CrdtConnection['type'],
    };
    if (raw.isBundled !== undefined && raw.isBundled !== '') {
        conn.isBundled = safeParse(raw.isBundled, false);
    }
    return conn;
}
