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

/** Public STUN servers are enough for most LAN + many home-NAT setups. */
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Base64-encode an SDP blob into a shareable code. */
function encodeSignal(desc: RTCSessionDescriptionInit): string {
    return btoa(JSON.stringify(desc));
}

/** Decode a shared code back into an SDP blob. */
function decodeSignal(code: string): RTCSessionDescriptionInit {
    return JSON.parse(atob(code)) as RTCSessionDescriptionInit;
}

/** Wait for ICE gathering to finish so the SDP contains all candidates. */
function waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
        const check = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', check);
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

    constructor(selfId: string, iceServers: RTCIceServer[] = DEFAULT_ICE) {
        this.selfId = selfId;
        this.iceServers = iceServers;
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
            this.events?.onPeerConnect?.('remote');
        };
        channel.onclose = () => {
            if (this.connected) {
                this.connected = false;
                this.events?.onPeerDisconnect?.('remote');
            }
        };
        channel.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            const frame = decodeFrame(new Uint8Array(e.data));
            if (frame) this.events?.onFrame?.(frame);
        };
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
        await waitForIce(this.pc);
        return encodeSignal(this.pc.localDescription!);
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
        await waitForIce(this.pc);
        return encodeSignal(this.pc.localDescription!);
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
        this.channel?.close();
        this.pc?.close();
        this.channel = null;
        this.pc = null;
        this.connected = false;
        this.events = null;
    }
}
