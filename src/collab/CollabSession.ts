/**
 * U23 — CollabSession: orchestrates CRDT doc + presence + transport + store.
 *
 * One session per joined patch. It owns:
 *   • a {@link CrdtGraphProjection} (the shared graph),
 *   • a {@link GraphStoreBridge} (two-way binding to the live graphStore),
 *   • a {@link PresenceManager} (ephemeral cursors/selection/peer list),
 *   • a {@link Transport} (BroadcastChannel default, or manual WebRTC).
 *
 * Wire format: doc updates, doc snapshots, and presence updates are all
 * multiplexed over the single transport using tagged frames.
 */

import { CrdtGraphProjection } from './CrdtGraphProjection';
import { GraphStoreBridge, type GraphStoreLike } from './graphStoreBridge';
import { PresenceManager, makeSelfPresence } from './presence';
import type { PeerPresence, SessionRole, SessionStatus } from './types';
import type { Transport, TransportFrame } from './transport/Transport';

export interface CollabSessionOptions {
    role: SessionRole;
    sessionCode: string;
    store: GraphStoreLike;
    transport: Transport;
    /** Local display name. */
    name?: string;
    /** Stable peer id (defaults to the CRDT doc peer id). */
    peerId?: string;
}

export interface SessionState {
    role: SessionRole;
    status: SessionStatus;
    sessionCode: string;
    transport: string;
    self: PeerPresence;
    peers: PeerPresence[];
    error?: string;
}

type SessionListener = (state: SessionState) => void;

export class CollabSession {
    readonly projection: CrdtGraphProjection;
    readonly presence: PresenceManager;
    readonly bridge: GraphStoreBridge;
    private readonly transport: Transport;
    private readonly role: SessionRole;
    private readonly sessionCode: string;

    private status: SessionStatus = 'idle';
    private error: string | undefined;
    private readonly listeners = new Set<SessionListener>();

    private unsubLocalDoc: (() => void) | null = null;
    private unsubLocalPresence: (() => void) | null = null;
    private unsubPresence: (() => void) | null = null;

    constructor(opts: CollabSessionOptions) {
        this.role = opts.role;
        this.sessionCode = opts.sessionCode;
        this.transport = opts.transport;

        this.projection = new CrdtGraphProjection();
        const peerId = opts.peerId ?? this.projection.peerId;
        this.presence = new PresenceManager(makeSelfPresence(peerId, opts.name));
        this.bridge = new GraphStoreBridge(opts.store, this.projection);
    }

    // ------------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------------

    async start(): Promise<void> {
        this.setStatus('connecting');
        try {
            await this.transport.connect({
                onFrame: (frame) => this.handleFrame(frame),
                onPeerConnect: () => this.handlePeerConnect(),
                onPeerDisconnect: () => this.emit(),
                onError: (err) => this.fail(err.message),
            });
        } catch (err) {
            this.fail((err as Error).message);
            throw err;
        }

        // The host seeds the CRDT from its current store; the guest waits to be
        // reconciled by the first remote snapshot it receives.
        this.bridge.start(this.role === 'host');

        // Forward local doc updates over the transport.
        this.unsubLocalDoc = this.projection.subscribeLocalUpdates((bytes) => {
            this.transport.send({ kind: 'doc-update', data: bytes });
        });

        // Forward local presence updates over the transport.
        this.unsubLocalPresence = this.presence.subscribeLocalUpdates((bytes) => {
            this.transport.send({ kind: 'presence', data: bytes });
        });

        // Re-emit session state whenever presence changes.
        this.unsubPresence = this.presence.subscribe(() => this.emit());

        this.setStatus('connected');
    }

    /** When a new peer connects, send them a full doc snapshot + our presence. */
    private handlePeerConnect(): void {
        this.transport.send({ kind: 'doc-snapshot', data: this.projection.exportSnapshot() });
        this.transport.send({ kind: 'presence', data: this.presence.encodeAll() });
        this.emit();
    }

    private handleFrame(frame: TransportFrame): void {
        switch (frame.kind) {
            case 'doc-update':
            case 'doc-snapshot':
                this.projection.import(frame.data);
                break;
            case 'presence':
                this.presence.apply(frame.data);
                break;
            case 'hello':
                // Connectivity probe; no payload to apply.
                break;
        }
    }

    // ------------------------------------------------------------------------
    // Presence passthrough (used by the UI overlay)
    // ------------------------------------------------------------------------

    setCursor(cursor: PeerPresence['cursor']): void {
        this.presence.setCursor(cursor);
    }

    setSelection(selection: string[]): void {
        this.presence.setSelection(selection);
    }

    setViewNode(viewNodeId: string | null): void {
        this.presence.setViewNode(viewNodeId);
    }

    setName(name: string): void {
        this.presence.setName(name);
    }

    // ------------------------------------------------------------------------
    // State + listeners
    // ------------------------------------------------------------------------

    getState(): SessionState {
        return {
            role: this.role,
            status: this.status,
            sessionCode: this.sessionCode,
            transport: this.transport.label,
            self: this.presence.getSelf(),
            peers: this.presence.getPeers(),
            ...(this.error ? { error: this.error } : {}),
        };
    }

    subscribe(listener: SessionListener): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        const state = this.getState();
        for (const l of this.listeners) l(state);
    }

    private setStatus(status: SessionStatus): void {
        this.status = status;
        if (status !== 'error') this.error = undefined;
        this.emit();
    }

    private fail(message: string): void {
        this.error = message;
        this.status = 'error';
        this.emit();
    }

    // ------------------------------------------------------------------------
    // Teardown
    // ------------------------------------------------------------------------

    stop(): void {
        this.unsubLocalDoc?.();
        this.unsubLocalPresence?.();
        this.unsubPresence?.();
        this.unsubLocalDoc = null;
        this.unsubLocalPresence = null;
        this.unsubPresence = null;

        this.bridge.stop();
        this.transport.close();
        this.presence.destroy();
        this.projection.destroy();
        this.setStatus('idle');
        this.listeners.clear();
    }
}
