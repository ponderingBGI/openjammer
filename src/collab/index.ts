/**
 * U23 — Real-time collaboration public surface.
 *
 * Collaborative STATE plane (graph + presence) — fully implemented here.
 * Realtime AUDIO plane — deferred stub, see {@link ./audioPlane}.
 */

export { CrdtGraphProjection, LOCAL_ORIGIN } from './CrdtGraphProjection';
export type { ProjectionChange, ProjectionListener } from './CrdtGraphProjection';
export { GraphStoreBridge } from './graphStoreBridge';
export type { BridgeGraphState, GraphStoreLike } from './graphStoreBridge';
export { PresenceManager, makeSelfPresence, colorForPeer } from './presence';
export type { PresenceListener } from './presence';
export { CollabSession } from './CollabSession';
export type { CollabSessionOptions, SessionState } from './CollabSession';

export { BroadcastChannelTransport } from './transport/BroadcastChannelTransport';
export { ManualWebRTCTransport } from './transport/ManualWebRTCTransport';
export { encodeFrame, decodeFrame } from './transport/Transport';
export type { Transport, TransportEvents, TransportFrame, FrameKind } from './transport/Transport';

export { createAudioPlane, AUDIO_PLANE_AVAILABLE } from './audioPlane';
export type { AudioPlane, AudioPlaneConfig, AudioPeerLink } from './audioPlane';

export type {
    CrdtNode,
    CrdtConnection,
    GraphSnapshot,
    PeerPresence,
    SessionInfo,
    SessionRole,
    SessionStatus,
} from './types';
export {
    toCrdtNode,
    fromCrdtNode,
    toCrdtConnection,
    fromCrdtConnection,
} from './types';

/**
 * Generate a short, human-shareable session code (host calls this; guest types
 * it). Avoids ambiguous characters. Not security-sensitive — it only namespaces
 * a BroadcastChannel / identifies a session.
 */
export function generateSessionCode(length = 6): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
    if (cryptoObj?.getRandomValues) {
        const bytes = new Uint8Array(length);
        cryptoObj.getRandomValues(bytes);
        for (let i = 0; i < length; i++) code += alphabet[bytes[i] % alphabet.length];
    } else {
        for (let i = 0; i < length; i++) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
    }
    return code;
}
