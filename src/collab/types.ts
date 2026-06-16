/**
 * U23 — Real-time collaboration: shared types.
 *
 * This file defines the data shapes used across the COLLABORATIVE STATE PLANE.
 * It is intentionally free of any Loro / transport / React imports so it can be
 * consumed from anywhere (engine, store, components, tests) without pulling in
 * the WASM CRDT runtime.
 *
 * Two planes, kept strictly separate (see ./README.md and ./audioPlane.ts):
 *   1. Collaborative STATE plane (this unit): node graph + presence, via CRDT.
 *   2. Realtime AUDIO plane (deferred, founder-gated): see ./audioPlane.ts.
 */

import type { Connection, GraphNode, NodeCategory, NodeType, PortDefinition, Position } from '../engine/types';

// ============================================================================
// Graph snapshot (the data the CRDT projects)
// ============================================================================

/**
 * The flat, JSON-serializable shape of a single node as stored in the CRDT.
 *
 * Mirrors {@link GraphNode} but only the fields that define collaborative graph
 * state. Transient/UI-only fields (selection, internal viewport) are NOT part
 * of the shared document — they belong to presence (ephemeral) instead.
 */
export interface CrdtNode {
    id: string;
    type: NodeType;
    category: NodeCategory;
    position: Position;
    data: Record<string, unknown>;
    ports: PortDefinition[];
    parentId: string | null;
    childIds: string[];
    specialNodes: string[];
    showEmptyInputPorts?: boolean;
    showEmptyOutputPorts?: boolean;
}

/** JSON-serializable connection shape stored in the CRDT. */
export interface CrdtConnection {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    type: Connection['type'];
    isBundled?: boolean;
}

/** A full snapshot read out of (or written into) the CRDT projection. */
export interface GraphSnapshot {
    nodes: CrdtNode[];
    connections: CrdtConnection[];
}

/** Convert a live {@link GraphNode} into the serializable {@link CrdtNode}. */
export function toCrdtNode(node: GraphNode): CrdtNode {
    return {
        id: node.id,
        type: node.type,
        category: node.category,
        position: { x: node.position.x, y: node.position.y },
        // Deep clone so the CRDT never aliases live store objects.
        data: JSON.parse(JSON.stringify(node.data ?? {})),
        ports: JSON.parse(JSON.stringify(node.ports ?? [])),
        parentId: node.parentId ?? null,
        childIds: [...(node.childIds ?? [])],
        specialNodes: [...(node.specialNodes ?? [])],
        ...(node.showEmptyInputPorts !== undefined ? { showEmptyInputPorts: node.showEmptyInputPorts } : {}),
        ...(node.showEmptyOutputPorts !== undefined ? { showEmptyOutputPorts: node.showEmptyOutputPorts } : {}),
    };
}

/** Rehydrate a {@link CrdtNode} back into a live {@link GraphNode}. */
export function fromCrdtNode(node: CrdtNode): GraphNode {
    return {
        id: node.id,
        type: node.type,
        category: node.category,
        position: { x: node.position.x, y: node.position.y },
        data: node.data ?? {},
        ports: node.ports ?? [],
        parentId: node.parentId ?? null,
        childIds: node.childIds ?? [],
        specialNodes: node.specialNodes ?? [],
        ...(node.showEmptyInputPorts !== undefined ? { showEmptyInputPorts: node.showEmptyInputPorts } : {}),
        ...(node.showEmptyOutputPorts !== undefined ? { showEmptyOutputPorts: node.showEmptyOutputPorts } : {}),
    };
}

/** Convert a live {@link Connection} into a serializable {@link CrdtConnection}. */
export function toCrdtConnection(conn: Connection): CrdtConnection {
    return {
        id: conn.id,
        sourceNodeId: conn.sourceNodeId,
        sourcePortId: conn.sourcePortId,
        targetNodeId: conn.targetNodeId,
        targetPortId: conn.targetPortId,
        type: conn.type,
        ...(conn.isBundled !== undefined ? { isBundled: conn.isBundled } : {}),
    };
}

/** Rehydrate a {@link CrdtConnection} back into a live {@link Connection}. */
export function fromCrdtConnection(conn: CrdtConnection): Connection {
    return {
        id: conn.id,
        sourceNodeId: conn.sourceNodeId,
        sourcePortId: conn.sourcePortId,
        targetNodeId: conn.targetNodeId,
        targetPortId: conn.targetPortId,
        type: conn.type,
        ...(conn.isBundled !== undefined ? { isBundled: conn.isBundled } : {}),
    };
}

// ============================================================================
// Presence (ephemeral — never persisted into the document)
// ============================================================================

/** Live presence for a single peer. Lives in Loro's EphemeralStore. */
export interface PeerPresence {
    /** Stable per-tab peer id (matches the Loro doc peer id when known). */
    peerId: string;
    /** Display name (user-chosen, defaults to "Peer N"). */
    name: string;
    /** Color used to tint this peer's cursor/selection in the UI. */
    color: string;
    /** Live cursor position in CANVAS coordinates (null if unknown). */
    cursor: Position | null;
    /** The canvas level (parent node id, or null for root) the peer is viewing. */
    viewNodeId: string | null;
    /** Node ids the peer currently has selected. */
    selection: string[];
    /** Epoch ms of the last presence update (used for stale eviction). */
    lastSeen: number;
}

// ============================================================================
// Session
// ============================================================================

export type SessionRole = 'host' | 'guest';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Public, serializable view of a collaboration session for the UI. */
export interface SessionInfo {
    role: SessionRole;
    status: SessionStatus;
    /** Shareable session code (host generates, guest enters). */
    sessionCode: string;
    /** This peer's own presence. */
    self: PeerPresence;
    /** Other connected peers (by peerId). */
    peers: PeerPresence[];
    /** Transport label, e.g. "broadcast-channel" or "webrtc-manual". */
    transport: string;
    /** Last error message, if status === 'error'. */
    error?: string;
}
