/**
 * U23 — Collaboration / presence store (UI-facing).
 *
 * Holds the single active {@link CollabSession} and mirrors its session state
 * (status, peers, self presence) into a Zustand store so React components can
 * subscribe without touching the CRDT machinery directly. Also exposes the
 * host/join/leave actions and presence setters used by the canvas overlay and
 * the Share/Join control.
 *
 * This store does NOT persist anything — collaboration sessions are transient.
 * It is also entirely optional: if no session is started, the rest of the app
 * (graphStore + canvas) behaves exactly as in single-user mode.
 */

import { create } from 'zustand';
import { useGraphStore } from './graphStore';
import type { CollabSession, SessionState } from '../collab/CollabSession';
import type { GraphStoreLike } from '../collab/graphStoreBridge';
import type { PeerPresence, SessionStatus } from '../collab/types';
import type { BroadcastChannelTransport } from '../collab/transport/BroadcastChannelTransport';
import type {
    ManualWebRTCTransport,
    ManualWebRTCTransportOptions,
} from '../collab/transport/ManualWebRTCTransport';
import type { Position } from '../engine/types';

type ManualWebRTCTransportType = ManualWebRTCTransport;
type CollabRuntime = {
    CollabSession: typeof import('../collab/CollabSession').CollabSession;
    BroadcastChannelTransport: typeof import('../collab/transport/BroadcastChannelTransport').BroadcastChannelTransport;
    ManualWebRTCTransport: typeof import('../collab/transport/ManualWebRTCTransport').ManualWebRTCTransport;
};

let collabRuntimePromise: Promise<CollabRuntime> | null = null;

function loadCollabRuntime(): Promise<CollabRuntime> {
    collabRuntimePromise ??= Promise.all([
        import('../collab/CollabSession'),
        import('../collab/transport/BroadcastChannelTransport'),
        import('../collab/transport/ManualWebRTCTransport'),
    ]).then(([session, broadcast, webRtc]) => ({
        CollabSession: session.CollabSession,
        BroadcastChannelTransport: broadcast.BroadcastChannelTransport,
        ManualWebRTCTransport: webRtc.ManualWebRTCTransport,
    }));
    return collabRuntimePromise;
}

export type TransportKind = 'broadcast-channel' | 'webrtc-manual';

interface StartSessionOptions {
    name?: string;
    transport?: TransportKind;
    /** Primarily for controlled deployments and deterministic browser journeys. */
    webrtcOptions?: ManualWebRTCTransportOptions;
}

interface CollabStoreState {
    /** Null when not in a session. */
    session: CollabSession | null;
    status: SessionStatus;
    sessionCode: string;
    transportLabel: string;
    self: PeerPresence | null;
    peers: PeerPresence[];
    error?: string;
    /** WebRTC manual-signaling handle (only set when transport is webrtc-manual). */
    webrtcTransport: ManualWebRTCTransportType | null;

    // Actions
    /** Host a new session on the chosen transport. Returns the session code. */
    hostSession: (opts?: StartSessionOptions) => Promise<string>;
    /** Join an existing session by code. */
    joinSession: (sessionCode: string, opts?: StartSessionOptions) => Promise<void>;
    /** Leave the active session and return to single-user mode. */
    leaveSession: () => void;

    // Presence passthrough
    setCursor: (cursor: Position | null) => void;
    setSelection: (selection: string[]) => void;
    setViewNode: (viewNodeId: string | null) => void;
    setName: (name: string) => void;

    // Internal
    _onSessionState: (state: SessionState) => void;
    _unsub: (() => void) | null;
}

function graphStoreLike(): GraphStoreLike {
    // useGraphStore is a Zustand store; its API (getState/setState/subscribe)
    // matches the structural GraphStoreLike the bridge needs.
    return useGraphStore as unknown as GraphStoreLike;
}

export const useCollabStore = create<CollabStoreState>((set, get) => ({
    session: null,
    status: 'idle',
    sessionCode: '',
    transportLabel: '',
    self: null,
    peers: [],
    error: undefined,
    webrtcTransport: null,
    _unsub: null,

    hostSession: async ({ name, transport = 'broadcast-channel', webrtcOptions } = {}) => {
        get().leaveSession();

        const runtime = await loadCollabRuntime();
        const sessionCode = generateSessionCode();
        const projectionPeerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const { transportInstance, webrtc } = makeTransport(
            runtime,
            transport,
            sessionCode,
            projectionPeerId,
            webrtcOptions,
        );

        const session = new runtime.CollabSession({
            role: 'host',
            sessionCode,
            store: graphStoreLike(),
            transport: transportInstance,
            name,
            peerId: projectionPeerId,
        });

        const unsub = session.subscribe(get()._onSessionState);
        set({ session, webrtcTransport: webrtc, _unsub: unsub });
        await session.start();
        return sessionCode;
    },

    joinSession: async (sessionCode, { name, transport = 'broadcast-channel', webrtcOptions } = {}) => {
        get().leaveSession();

        const runtime = await loadCollabRuntime();
        const projectionPeerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { transportInstance, webrtc } = makeTransport(
            runtime,
            transport,
            sessionCode,
            projectionPeerId,
            webrtcOptions,
        );

        const session = new runtime.CollabSession({
            role: 'guest',
            sessionCode,
            store: graphStoreLike(),
            transport: transportInstance,
            name,
            peerId: projectionPeerId,
        });

        const unsub = session.subscribe(get()._onSessionState);
        set({ session, webrtcTransport: webrtc, _unsub: unsub });
        await session.start();
    },

    leaveSession: () => {
        const { session, _unsub } = get();
        _unsub?.();
        session?.stop();
        set({
            session: null,
            status: 'idle',
            sessionCode: '',
            transportLabel: '',
            self: null,
            peers: [],
            error: undefined,
            webrtcTransport: null,
            _unsub: null,
        });
    },

    setCursor: (cursor) => get().session?.setCursor(cursor),
    setSelection: (selection) => get().session?.setSelection(selection),
    setViewNode: (viewNodeId) => get().session?.setViewNode(viewNodeId),
    setName: (name) => get().session?.setName(name),

    _onSessionState: (state: SessionState) => {
        set({
            status: state.status,
            sessionCode: state.sessionCode,
            transportLabel: state.transport,
            self: state.self,
            peers: state.peers,
            error: state.error,
        });
    },
}));

function makeTransport(
    runtime: CollabRuntime,
    kind: TransportKind,
    sessionCode: string,
    selfId: string,
    webrtcOptions?: ManualWebRTCTransportOptions,
): { transportInstance: BroadcastChannelTransport | ManualWebRTCTransportType; webrtc: ManualWebRTCTransportType | null } {
    if (kind === 'webrtc-manual') {
        const webrtc = new runtime.ManualWebRTCTransport(selfId, webrtcOptions);
        return { transportInstance: webrtc, webrtc };
    }
    return { transportInstance: new runtime.BroadcastChannelTransport(sessionCode, selfId), webrtc: null };
}

function generateSessionCode(length = 6): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
