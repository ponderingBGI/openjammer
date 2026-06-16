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
import {
    BroadcastChannelTransport,
    CollabSession,
    ManualWebRTCTransport,
    generateSessionCode,
    type PeerPresence,
    type SessionState,
    type SessionStatus,
} from '../collab';
import type { GraphStoreLike } from '../collab';
import type { Position } from '../engine/types';

type ManualWebRTCTransportType = ManualWebRTCTransport;

export type TransportKind = 'broadcast-channel' | 'webrtc-manual';

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
    hostSession: (opts?: { name?: string; transport?: TransportKind }) => Promise<string>;
    /** Join an existing session by code. */
    joinSession: (sessionCode: string, opts?: { name?: string; transport?: TransportKind }) => Promise<void>;
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

    hostSession: async ({ name, transport = 'broadcast-channel' } = {}) => {
        get().leaveSession();

        const sessionCode = generateSessionCode();
        const projectionPeerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const { transportInstance, webrtc } = makeTransport(transport, sessionCode, projectionPeerId);

        const session = new CollabSession({
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

    joinSession: async (sessionCode, { name, transport = 'broadcast-channel' } = {}) => {
        get().leaveSession();

        const projectionPeerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { transportInstance, webrtc } = makeTransport(transport, sessionCode, projectionPeerId);

        const session = new CollabSession({
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
    kind: TransportKind,
    sessionCode: string,
    selfId: string,
): { transportInstance: BroadcastChannelTransport | ManualWebRTCTransportType; webrtc: ManualWebRTCTransportType | null } {
    if (kind === 'webrtc-manual') {
        const webrtc = new ManualWebRTCTransport(selfId);
        return { transportInstance: webrtc, webrtc };
    }
    return { transportInstance: new BroadcastChannelTransport(sessionCode, selfId), webrtc: null };
}
