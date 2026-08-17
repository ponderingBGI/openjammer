/**
 * U23 — WebRTC DataChannel transport with MANUAL (copy/paste) signaling.
 *
 * This is the true peer-to-peer / LAN path. It needs no signaling SERVER: the
 * host generates an SDP "offer code", shares it out-of-band (chat, QR, paste),
 * the guest pastes it to produce an "answer code", and the host pastes that
 * back. ICE candidates are bundled into the SDP via non-trickle gathering, so
 * exactly one code is exchanged in each direction.
 *
 * It implements the same {@link Transport} interface as the BroadcastChannel
 * default, so the session is identical regardless of link. A future
 * relay/WebSocket transport (for WAN without manual paste) slots in here too.
 *
 * NOTE: This carries only the COLLABORATIVE STATE plane (CRDT graph + presence).
 * Realtime audio is a SEPARATE plane and is deliberately NOT sent here — see
 * ../audioPlane.ts.
 */

import type { Transport, TransportEvents, TransportFrame } from './Transport';
import { decodeFrame, encodeFrame } from './Transport';

/** Public STUN is a best-effort default; callers can provide controlled ICE infrastructure. */
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 8_000;

export interface ManualWebRTCTransportOptions {
    /** Override ICE infrastructure. Pass an empty array for deterministic LAN-only operation. */
    iceServers?: RTCIceServer[];
    /** Maximum wait for non-trickle ICE gathering before using viable local candidates. */
    iceGatheringTimeoutMs?: number;
}

export class IceGatheringError extends Error {
    readonly code: 'ICE_GATHERING_ABORTED' | 'ICE_GATHERING_NO_CANDIDATES' | 'ICE_GATHERING_TIMEOUT';
    readonly candidateErrorCount: number;

    constructor(
        code: IceGatheringError['code'],
        message: string,
        candidateErrorCount = 0,
    ) {
        super(message);
        this.name = 'IceGatheringError';
        this.code = code;
        this.candidateErrorCount = candidateErrorCount;
    }
}

/** Base64-encode an SDP blob into a shareable code. */
function encodeSignal(desc: RTCSessionDescriptionInit): string {
    return btoa(JSON.stringify(desc));
}

/** Decode a shared code back into an SDP blob. */
function decodeSignal(code: string): RTCSessionDescriptionInit {
    return JSON.parse(atob(code)) as RTCSessionDescriptionInit;
}

interface IceGatheringResult {
    candidateErrorCount: number;
    timedOut: boolean;
}

interface ReadyWaiter {
    resolve: () => void;
    reject: (error: Error) => void;
}

/**
 * Wait for non-trickle ICE without allowing a blocked STUN server to hang the
 * manual signaling UI forever. Candidate errors are observations, not an
 * immediate terminal failure: host candidates can still support LAN peers.
 */
function waitForIce(
    pc: RTCPeerConnection,
    timeoutMs: number,
    signal: AbortSignal,
): Promise<IceGatheringResult> {
    if (signal.aborted) {
        return Promise.reject(new IceGatheringError(
            'ICE_GATHERING_ABORTED',
            'ICE gathering was cancelled before it started.',
        ));
    }
    if (pc.iceGatheringState === 'complete') {
        return Promise.resolve({ candidateErrorCount: 0, timedOut: false });
    }

    return new Promise((resolve, reject) => {
        let candidateErrorCount = 0;
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            pc.removeEventListener('icecandidateerror', onCandidateError);
            pc.removeEventListener('icegatheringstatechange', onGatheringStateChange);
            pc.removeEventListener('signalingstatechange', onSignalingStateChange);
            signal.removeEventListener('abort', onAbort);
        };
        const finish = (result: IceGatheringResult) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };
        const fail = (error: IceGatheringError) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onCandidateError = () => {
            candidateErrorCount += 1;
        };
        const onGatheringStateChange = () => {
            if (pc.iceGatheringState === 'complete') {
                finish({ candidateErrorCount, timedOut: false });
            }
        };
        const onSignalingStateChange = () => {
            if (pc.signalingState === 'closed') {
                fail(new IceGatheringError(
                    'ICE_GATHERING_ABORTED',
                    'The peer connection closed while gathering ICE candidates.',
                    candidateErrorCount,
                ));
            }
        };
        const onAbort = () => fail(new IceGatheringError(
            'ICE_GATHERING_ABORTED',
            'ICE gathering was cancelled.',
            candidateErrorCount,
        ));

        const timer = setTimeout(
            () => finish({ candidateErrorCount, timedOut: true }),
            timeoutMs,
        );
        pc.addEventListener('icecandidateerror', onCandidateError);
        pc.addEventListener('icegatheringstatechange', onGatheringStateChange);
        pc.addEventListener('signalingstatechange', onSignalingStateChange);
        signal.addEventListener('abort', onAbort, { once: true });
        // Close the event-registration race if the browser completed gathering
        // between the initial state check and installing the listeners.
        onGatheringStateChange();
        onSignalingStateChange();
    });
}

export class ManualWebRTCTransport implements Transport {
    readonly label = 'webrtc-manual';
    private pc: RTCPeerConnection | null = null;
    private channel: RTCDataChannel | null = null;
    private events: TransportEvents | null = null;
    private connected = false;
    private readonly selfId: string;
    private readonly iceServers: RTCIceServer[];
    private readonly iceGatheringTimeoutMs: number;
    private iceGatherAbort: AbortController | null = null;
    private lastIceGatheringWarning: IceGatheringError | null = null;
    private readonly readyWaiters = new Set<ReadyWaiter>();

    constructor(selfId: string, options: ManualWebRTCTransportOptions = {}) {
        this.selfId = selfId;
        this.iceServers = options.iceServers ?? DEFAULT_ICE;
        this.iceGatheringTimeoutMs = options.iceGatheringTimeoutMs ?? DEFAULT_ICE_GATHERING_TIMEOUT_MS;
        if (!Number.isFinite(this.iceGatheringTimeoutMs) || this.iceGatheringTimeoutMs <= 0) {
            throw new RangeError('iceGatheringTimeoutMs must be a positive finite number');
        }
    }

    /**
     * No-op connect for interface compatibility: the manual handshake is driven
     * explicitly via {@link createOffer}/{@link acceptAnswer} (host) or
     * {@link acceptOffer} (guest). Call this first to register event handlers.
     */
    async connect(events: TransportEvents): Promise<void> {
        this.events = events;
    }

    private makePeerConnection(): RTCPeerConnection {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.rejectReadyWaiters(new Error(`WebRTC peer connection ${pc.connectionState} before the data channel became ready`));
                if (this.connected) {
                    this.connected = false;
                    this.events?.onPeerDisconnect?.('remote');
                }
            }
        };
        return pc;
    }

    private wireChannel(channel: RTCDataChannel): void {
        channel.binaryType = 'arraybuffer';
        this.channel = channel;
        channel.onopen = () => {
            this.connected = true;
            this.resolveReadyWaiters();
            this.events?.onPeerConnect?.('remote');
        };
        channel.onclose = () => {
            this.rejectReadyWaiters(new Error('WebRTC data channel closed before becoming ready'));
            if (this.connected) {
                this.connected = false;
                this.events?.onPeerDisconnect?.('remote');
            }
        };
        channel.onerror = () => {
            this.rejectReadyWaiters(new Error('WebRTC data channel failed before becoming ready'));
        };
        channel.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            const frame = decodeFrame(new Uint8Array(e.data));
            if (frame) this.events?.onFrame?.(frame);
        };
    }

    private resolveReadyWaiters(): void {
        for (const waiter of this.readyWaiters) waiter.resolve();
        this.readyWaiters.clear();
    }

    private rejectReadyWaiters(error: Error): void {
        for (const waiter of this.readyWaiters) waiter.reject(error);
        this.readyWaiters.clear();
    }

    private async finishIceGathering(pc: RTCPeerConnection): Promise<RTCSessionDescription> {
        this.iceGatherAbort?.abort();
        const controller = new AbortController();
        this.iceGatherAbort = controller;
        this.lastIceGatheringWarning = null;
        try {
            const result = await waitForIce(pc, this.iceGatheringTimeoutMs, controller.signal);
            const description = pc.localDescription;
            const hasCandidate = /^a=candidate:/m.test(description?.sdp ?? '');
            if (!description || !hasCandidate) {
                const code = result.timedOut ? 'ICE_GATHERING_TIMEOUT' : 'ICE_GATHERING_NO_CANDIDATES';
                throw new IceGatheringError(
                    code,
                    result.timedOut
                        ? `ICE gathering timed out after ${this.iceGatheringTimeoutMs} ms without a usable candidate. Check firewall, STUN, or TURN configuration.`
                        : 'ICE gathering completed without a usable candidate. Check network and ICE configuration.',
                    result.candidateErrorCount,
                );
            }
            if (result.timedOut) {
                // LAN host candidates are still viable. Preserve them instead of
                // turning an unreachable public STUN server into a hard failure.
                this.lastIceGatheringWarning = new IceGatheringError(
                    'ICE_GATHERING_TIMEOUT',
                    `ICE gathering timed out after ${this.iceGatheringTimeoutMs} ms; continuing with the candidates gathered so far.`,
                    result.candidateErrorCount,
                );
            }
            return description;
        } finally {
            if (this.iceGatherAbort === controller) this.iceGatherAbort = null;
        }
    }

    /** Diagnostic for callers that want to surface degraded STUN/TURN gathering. */
    getLastIceGatheringWarning(): IceGatheringError | null {
        return this.lastIceGatheringWarning;
    }

    // ------------------------------------------------------------------------
    // HOST handshake
    // ------------------------------------------------------------------------

    /** HOST step 1: create the offer code to share with the guest. */
    async createOffer(): Promise<string> {
        this.pc = this.makePeerConnection();
        const channel = this.pc.createDataChannel(`oj-${this.selfId}`, { ordered: true });
        this.wireChannel(channel);
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return encodeSignal(await this.finishIceGathering(this.pc));
    }

    /** HOST step 2: paste the guest's answer code to finish connecting. */
    async acceptAnswer(answerCode: string): Promise<void> {
        if (!this.pc) throw new Error('createOffer() must be called before acceptAnswer()');
        await this.pc.setRemoteDescription(decodeSignal(answerCode));
    }

    // ------------------------------------------------------------------------
    // GUEST handshake
    // ------------------------------------------------------------------------

    /** GUEST: paste the host's offer code and return the answer code to share back. */
    async acceptOffer(offerCode: string): Promise<string> {
        this.pc = this.makePeerConnection();
        this.pc.ondatachannel = (e) => this.wireChannel(e.channel);
        await this.pc.setRemoteDescription(decodeSignal(offerCode));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return encodeSignal(await this.finishIceGathering(this.pc));
    }

    /** Wait for the data channel itself, not merely SDP exchange, to be usable. */
    async waitUntilReady(timeoutMs = 10_000): Promise<void> {
        if (this.channel?.readyState === 'open') return;
        if (!this.pc) throw new Error('WebRTC handshake has not started');

        await new Promise<void>((resolve, reject) => {
            const waiter: ReadyWaiter = {
                resolve: () => {
                    clearTimeout(timer);
                    this.readyWaiters.delete(waiter);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timer);
                    this.readyWaiters.delete(waiter);
                    reject(error);
                },
            };
            const timer = setTimeout(() => {
                waiter.reject(new Error(`WebRTC data channel did not open within ${timeoutMs} ms`));
            }, timeoutMs);
            this.readyWaiters.add(waiter);

            // Close the registration race if the channel opened between the
            // initial state check and adding this waiter.
            if (this.channel?.readyState === 'open') waiter.resolve();
        });
    }

    // ------------------------------------------------------------------------
    // Transport interface
    // ------------------------------------------------------------------------

    send(frame: TransportFrame): void {
        if (this.channel?.readyState === 'open') {
            const encoded = encodeFrame(frame);
            // Copy into a fresh ArrayBuffer-backed view so the typed-array overload
            // of RTCDataChannel.send accepts it (avoids SharedArrayBuffer typing).
            const buffer = new ArrayBuffer(encoded.byteLength);
            new Uint8Array(buffer).set(encoded);
            this.channel.send(buffer);
        }
    }

    isReady(): boolean {
        return this.channel?.readyState === 'open';
    }

    close(): void {
        this.iceGatherAbort?.abort();
        this.iceGatherAbort = null;
        this.rejectReadyWaiters(new Error('WebRTC transport closed before the data channel became ready'));
        this.channel?.close();
        this.pc?.close();
        this.channel = null;
        this.pc = null;
        this.connected = false;
        this.events = null;
    }
}
