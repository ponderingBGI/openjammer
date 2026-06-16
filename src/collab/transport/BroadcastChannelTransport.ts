/**
 * U23 — Default same-network transport: BroadcastChannel.
 *
 * This is the simplest thing that demonstrably works browser-side with ZERO
 * infrastructure: every tab/window on the SAME ORIGIN that opens a channel with
 * the same session code can exchange frames. It is the natural default for
 * "open the patch in another tab and jam", and it makes the collaboration plane
 * testable end-to-end without a signaling server.
 *
 * For true cross-machine LAN/peer links use {@link ManualWebRTCTransport};
 * both implement the same {@link Transport} interface so the session does not
 * care which is in use. A relay/WebSocket transport can be added later behind
 * the same interface.
 */

import type { Transport, TransportEvents, TransportFrame } from './Transport';

const CHANNEL_PREFIX = 'openjammer-collab:';

interface WireMessage {
    senderId: string;
    frame: { kind: TransportFrame['kind']; data: number[] };
    type: 'frame' | 'join' | 'leave';
}

/** Resolve a BroadcastChannel constructor (guarded for non-browser/test envs). */
function getBroadcastChannel(): typeof BroadcastChannel | null {
    return typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null;
}

export class BroadcastChannelTransport implements Transport {
    readonly label = 'broadcast-channel';
    private channel: BroadcastChannel | null = null;
    private events: TransportEvents | null = null;
    private readonly knownPeers = new Set<string>();
    private readonly sessionCode: string;
    private readonly selfId: string;

    constructor(sessionCode: string, selfId: string) {
        this.sessionCode = sessionCode;
        this.selfId = selfId;
    }

    async connect(events: TransportEvents): Promise<void> {
        const BC = getBroadcastChannel();
        if (!BC) {
            const err = new Error('BroadcastChannel is not available in this environment');
            events.onError?.(err);
            throw err;
        }
        this.events = events;
        this.channel = new BC(CHANNEL_PREFIX + this.sessionCode);
        this.channel.onmessage = (e: MessageEvent<WireMessage>) => this.handleMessage(e.data);
        // Announce ourselves so existing peers learn about us (and vice versa).
        this.post({ senderId: this.selfId, type: 'join', frame: { kind: 'hello', data: [] } });
    }

    private handleMessage(msg: WireMessage): void {
        if (!msg || msg.senderId === this.selfId) return;

        if (msg.type === 'join') {
            // New peer arrived: register and re-announce so they see us too.
            if (!this.knownPeers.has(msg.senderId)) {
                this.knownPeers.add(msg.senderId);
                this.events?.onPeerConnect?.(msg.senderId);
            }
            this.post({ senderId: this.selfId, type: 'frame', frame: { kind: 'hello', data: [] } });
            return;
        }

        if (msg.type === 'leave') {
            if (this.knownPeers.delete(msg.senderId)) {
                this.events?.onPeerDisconnect?.(msg.senderId);
            }
            return;
        }

        // Regular frame: ensure sender is tracked, then deliver.
        if (!this.knownPeers.has(msg.senderId)) {
            this.knownPeers.add(msg.senderId);
            this.events?.onPeerConnect?.(msg.senderId);
        }
        this.events?.onFrame?.({
            kind: msg.frame.kind,
            data: new Uint8Array(msg.frame.data),
        });
    }

    send(frame: TransportFrame): void {
        this.post({
            senderId: this.selfId,
            type: 'frame',
            frame: { kind: frame.kind, data: Array.from(frame.data) },
        });
    }

    private post(msg: WireMessage): void {
        try {
            this.channel?.postMessage(msg);
        } catch (err) {
            this.events?.onError?.(err as Error);
        }
    }

    isReady(): boolean {
        return this.channel !== null;
    }

    close(): void {
        if (this.channel) {
            this.post({ senderId: this.selfId, type: 'leave', frame: { kind: 'hello', data: [] } });
            this.channel.onmessage = null;
            this.channel.close();
            this.channel = null;
        }
        this.knownPeers.clear();
        this.events = null;
    }
}
