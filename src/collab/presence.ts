/**
 * U23 — Presence over Loro's EphemeralStore.
 *
 * Presence (who is connected, their live cursor + selection + view level) is
 * deliberately kept OUT of the persisted CRDT document so it does not bloat the
 * saved patch. Loro's {@link EphemeralStore} is purpose-built for this: it is a
 * last-write-wins key/value store with automatic timeout-based eviction of
 * stale peers, and it syncs over the same transport as the doc.
 *
 * Each peer owns exactly one key (its peerId) whose value is its
 * {@link PeerPresence}. Remote peers' presences arrive via `apply()` and are
 * surfaced through {@link getPeers}.
 */

import { EphemeralStore } from 'loro-crdt';
import type { Value } from 'loro-crdt';
import type { PeerPresence } from './types';
import { logWarn } from '../utils/log';

/** Default eviction timeout: a peer that hasn't updated in 30s is dropped. */
const PRESENCE_TIMEOUT_MS = 30_000;

export type PresenceListener = (self: PeerPresence, peers: PeerPresence[]) => void;

export class PresenceManager {
    // The store is untyped (Record<string, Value>); PeerPresence is JSON-shaped
    // (all fields are strings/numbers/arrays/null) so it round-trips as a Value.
    // We cast at the boundary in publish()/getPeers().
    private readonly store: EphemeralStore;
    private readonly listeners = new Set<PresenceListener>();
    private self: PeerPresence;
    private unsubscribeStore: (() => void) | null = null;

    constructor(self: PeerPresence, timeoutMs: number = PRESENCE_TIMEOUT_MS) {
        this.self = self;
        this.store = new EphemeralStore(timeoutMs);
        // Any change (local or remote) re-derives the peer list for listeners.
        this.unsubscribeStore = this.store.subscribe(() => this.emit());
        this.publish();
    }

    /** The Loro EphemeralStore key this peer writes to. */
    private get key(): string {
        return this.self.peerId;
    }

    // ------------------------------------------------------------------------
    // Local mutation
    // ------------------------------------------------------------------------

    /** Write this peer's full presence and broadcast it. */
    publish(): void {
        this.self = { ...this.self, lastSeen: Date.now() };
        this.store.set(this.key, this.self as unknown as Value);
    }

    /** Patch + republish a subset of this peer's presence. */
    update(patch: Partial<Omit<PeerPresence, 'peerId'>>): void {
        this.self = { ...this.self, ...patch };
        this.publish();
    }

    /** Convenience setters for the common live signals. */
    setCursor(cursor: PeerPresence['cursor']): void {
        this.update({ cursor });
    }

    setSelection(selection: string[]): void {
        this.update({ selection });
    }

    setViewNode(viewNodeId: string | null): void {
        this.update({ viewNodeId });
    }

    setName(name: string): void {
        this.update({ name });
    }

    // ------------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------------

    /** This peer's own presence. */
    getSelf(): PeerPresence {
        return this.self;
    }

    /** All OTHER peers (excludes self), most-recently-seen ordering. */
    getPeers(): PeerPresence[] {
        const states = this.store.getAllStates() as unknown as Record<string, PeerPresence>;
        const peers: PeerPresence[] = [];
        for (const k of Object.keys(states)) {
            if (k === this.key) continue;
            const p = states[k];
            if (p && typeof p === 'object' && typeof p.peerId === 'string') {
                peers.push(p);
            }
        }
        return peers.sort((a, b) => b.lastSeen - a.lastSeen);
    }

    // ------------------------------------------------------------------------
    // Transport sync (binary)
    // ------------------------------------------------------------------------

    /** Encode ALL local presence state (for seeding a freshly-joined peer). */
    encodeAll(): Uint8Array {
        return this.store.encodeAll();
    }

    /**
     * Apply a remote presence update.
     *
     * DECODE FIREWALL: presence bytes arrive off the same untrusted transport as
     * the doc, so a malformed frame must never throw out of here and crash the
     * session — we skip it and keep the current peer view. Presence is ephemeral
     * (timeout-evicted), so dropping one bad update is harmless.
     */
    apply(bytes: Uint8Array): void {
        try {
            this.store.apply(bytes);
        } catch (err) {
            logWarn('collab', 'skipped a corrupt presence frame', {
                bytes: bytes.length,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /** Subscribe to local presence updates for forwarding over a transport. */
    subscribeLocalUpdates(listener: (bytes: Uint8Array) => void): () => void {
        return this.store.subscribeLocalUpdates(listener);
    }

    // ------------------------------------------------------------------------
    // Listeners
    // ------------------------------------------------------------------------

    subscribe(listener: PresenceListener): () => void {
        this.listeners.add(listener);
        // Push current state immediately.
        listener(this.getSelf(), this.getPeers());
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        const self = this.getSelf();
        const peers = this.getPeers();
        for (const listener of this.listeners) listener(self, peers);
    }

    /** Remove this peer's presence and tear down. */
    destroy(): void {
        try {
            this.store.delete(this.key);
        } catch {
            // store may already be destroyed
        }
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        this.listeners.clear();
        this.store.destroy();
    }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const PEER_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

/** Deterministically pick a stable color for a peer id. */
export function colorForPeer(peerId: string): string {
    let hash = 0;
    for (let i = 0; i < peerId.length; i++) {
        hash = (hash * 31 + peerId.charCodeAt(i)) | 0;
    }
    return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

/** Build a default presence object for a new local peer. */
export function makeSelfPresence(peerId: string, name?: string): PeerPresence {
    return {
        peerId,
        name: name ?? `Peer ${peerId.slice(0, 4)}`,
        color: colorForPeer(peerId),
        cursor: null,
        viewNodeId: null,
        selection: [],
        lastSeen: Date.now(),
    };
}
