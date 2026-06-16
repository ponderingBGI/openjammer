/**
 * U23 — Realtime AUDIO plane: DOCUMENTED STUB / INTERFACE ONLY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  TWO PLANES, STRICTLY SEPARATE                                             │
 * │                                                                            │
 * │  1. Collaborative STATE plane  (THIS UNIT, U23 — implemented)              │
 * │     The shared node graph + presence. Eventually-consistent, lossless,     │
 * │     latency-tolerant. Carried by a CRDT (Loro) over a generic transport    │
 * │     (BroadcastChannel today; manual-signaling WebRTC for LAN/peer).        │
 * │                                                                            │
 * │  2. Realtime AUDIO plane       (DEFERRED — founder-network-gated)          │
 * │     Streaming live audio between peers (e.g. Opus over UDP/WebRTC media).  │
 * │     Loss-tolerant, jitter-buffered, hard real-time. COMPLETELY DIFFERENT   │
 * │     reliability + timing requirements from the state plane.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This file intentionally contains NO implementation. There is no UDP socket,
 * no Opus encoder, no media negotiation here. It exists to:
 *   • make the architectural separation explicit and discoverable in code, and
 *   • pin down the interface the future audio plane will satisfy, so the state
 *     plane never grows audio responsibilities by accident.
 *
 * Why deferred: remote/WAN audio is out of scope for U23 and is gated on the
 * founder's network/relay infrastructure (TURN, jitter strategy, codec choice).
 * Mixing audio frames into the CRDT/presence transport would be an architectural
 * mistake — they have opposite reliability profiles. Keep them apart.
 */

/** Quality/codec hints the audio plane MAY accept once implemented. */
export interface AudioPlaneConfig {
    /** Target codec (e.g. 'opus'). Implementation-defined. */
    codec?: string;
    /** Target one-way latency budget in milliseconds. */
    targetLatencyMs?: number;
    /** Jitter buffer depth in milliseconds. */
    jitterBufferMs?: number;
    /** Optional TURN/relay servers for NAT traversal of the media path. */
    iceServers?: RTCIceServer[];
}

/** A single peer's live audio link state. */
export interface AudioPeerLink {
    peerId: string;
    /** True once media is flowing in at least one direction. */
    active: boolean;
    /** Measured round-trip / one-way latency, if known (ms). */
    latencyMs?: number;
}

/**
 * The contract the realtime audio plane WILL implement. Kept separate from the
 * {@link import('./transport/Transport').Transport} state transport on purpose:
 * audio is loss-tolerant + real-time, state is lossless + eventually-consistent.
 */
export interface AudioPlane {
    readonly label: string;
    /** Begin streaming local audio to peers in the session. */
    start(config?: AudioPlaneConfig): Promise<void>;
    /** Stop streaming and tear down media transports. */
    stop(): void;
    /** Current per-peer link state. */
    getLinks(): AudioPeerLink[];
    /** True once the audio plane is streaming. */
    isActive(): boolean;
}

/**
 * Placeholder factory. Throws by design: the realtime audio plane is deferred
 * and founder-network-gated. The collaboration STATE plane (U23) is fully
 * functional WITHOUT this. When the audio plane is built it should live in its
 * own module (NOT in src/audio/**, which is the local realtime engine) and
 * negotiate its OWN media transport — never reuse the CRDT/presence transport.
 *
 * @throws Always — see module docs.
 */
export function createAudioPlane(): AudioPlane {
    throw new Error(
        '[U23] Realtime audio plane is deferred (founder-network-gated). ' +
        'The collaborative STATE plane (graph + presence) is fully separate and active. ' +
        'See src/collab/audioPlane.ts and src/collab/README.md.',
    );
}

/** Feature flag: is the realtime audio plane available? Always false for U23. */
export const AUDIO_PLANE_AVAILABLE = false as const;
