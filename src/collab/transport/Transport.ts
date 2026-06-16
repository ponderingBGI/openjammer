/**
 * U23 — Sync transport abstraction.
 *
 * The collaboration session is transport-agnostic. A transport is just a typed
 * pipe that carries length-tagged binary frames between peers and tells us when
 * a peer connects/disconnects. This lets us ship a zero-infra default
 * (BroadcastChannel for same-origin tabs) and a true peer link (manual-signaling
 * WebRTC DataChannel for LAN/peer-to-peer) behind the SAME interface — and slot
 * in a relay/WebSocket server later without touching the session logic.
 *
 * Frames are tagged so the session can multiplex the CRDT doc stream and the
 * presence stream over one channel.
 */

/** Logical sub-channels multiplexed over a single transport. */
export type FrameKind = 'doc-update' | 'doc-snapshot' | 'presence' | 'hello';

export interface TransportFrame {
    kind: FrameKind;
    /** Binary payload (Loro update/snapshot or presence encoding). */
    data: Uint8Array;
}

export interface TransportEvents {
    /** A frame arrived from a remote peer. */
    onFrame: (frame: TransportFrame) => void;
    /** A remote peer became reachable on this transport. */
    onPeerConnect?: (peerId: string) => void;
    /** A remote peer left / became unreachable. */
    onPeerDisconnect?: (peerId: string) => void;
    /** Transport reached a terminal error. */
    onError?: (err: Error) => void;
}

export interface Transport {
    /** Human-readable transport id, surfaced in the UI / session info. */
    readonly label: string;

    /** Begin connecting and wire up the event handlers. */
    connect(events: TransportEvents): Promise<void>;

    /** Broadcast a frame to all connected peers. */
    send(frame: TransportFrame): void;

    /** True once at least the local endpoint is ready to send. */
    isReady(): boolean;

    /** Close the transport and release resources. */
    close(): void;
}

// ----------------------------------------------------------------------------
// Frame (de)serialization — used by binary transports (WebRTC).
// BroadcastChannel can pass structured objects directly, but encoding keeps a
// single wire format so a relay/WebSocket transport can reuse it verbatim.
// ----------------------------------------------------------------------------

const KIND_TO_BYTE: Record<FrameKind, number> = {
    'doc-update': 1,
    'doc-snapshot': 2,
    presence: 3,
    hello: 4,
};

const BYTE_TO_KIND: Record<number, FrameKind> = {
    1: 'doc-update',
    2: 'doc-snapshot',
    3: 'presence',
    4: 'hello',
};

/** Encode a frame as `[kind:1][payload...]`. */
export function encodeFrame(frame: TransportFrame): Uint8Array {
    const out = new Uint8Array(1 + frame.data.byteLength);
    out[0] = KIND_TO_BYTE[frame.kind];
    out.set(frame.data, 1);
    return out;
}

/** Decode a `[kind:1][payload...]` buffer back into a frame. */
export function decodeFrame(buffer: Uint8Array): TransportFrame | null {
    if (buffer.byteLength < 1) return null;
    const kind = BYTE_TO_KIND[buffer[0]];
    if (!kind) return null;
    return { kind, data: buffer.slice(1) };
}
