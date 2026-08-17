import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualWebRTCTransport } from '../ManualWebRTCTransport';

type GatheringScenario = 'complete' | 'complete-empty' | 'hang-candidate' | 'hang-empty';

class FakeDataChannel extends EventTarget {
    binaryType: BinaryType = 'blob';
    readyState: RTCDataChannelState = 'connecting';
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;

    open(): void {
        this.readyState = 'open';
        const event = new Event('open');
        this.onopen?.(event);
        this.dispatchEvent(event);
    }

    send(): void {}

    close(): void {
        this.readyState = 'closed';
        const event = new Event('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
    }
}

class FakePeerConnection {
    static instances: FakePeerConnection[] = [];
    static scenario: GatheringScenario = 'complete';

    iceGatheringState: RTCIceGatheringState = 'new';
    signalingState: RTCSignalingState = 'stable';
    connectionState: RTCPeerConnectionState = 'new';
    localDescription: RTCSessionDescription | null = null;
    onconnectionstatechange: ((event: Event) => void) | null = null;
    ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
    readonly channel = new FakeDataChannel();
    readonly configuration: RTCConfiguration;
    private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

    constructor(configuration: RTCConfiguration) {
        this.configuration = configuration;
        FakePeerConnection.instances.push(this);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: Event): boolean {
        for (const listener of this.listeners.get(event.type) ?? []) {
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
        }
        return true;
    }

    activeIceListenerCount(): number {
        return ['icecandidateerror', 'icegatheringstatechange', 'signalingstatechange']
            .reduce((count, type) => count + (this.listeners.get(type)?.size ?? 0), 0);
    }

    createDataChannel(): RTCDataChannel {
        return this.channel as unknown as RTCDataChannel;
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'offer', sdp: 'v=0\r\n' };
    }

    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'answer', sdp: 'v=0\r\n' };
    }

    async setLocalDescription(description: RTCLocalSessionDescriptionInit): Promise<void> {
        const hasCandidate = FakePeerConnection.scenario === 'complete'
            || FakePeerConnection.scenario === 'hang-candidate';
        this.localDescription = {
            type: description.type,
            sdp: `v=0\r\n${hasCandidate ? 'a=candidate:1 1 UDP 1 host.local 9 typ host\r\n' : ''}`,
            toJSON: () => ({ type: description.type, sdp: this.localDescription?.sdp ?? '' }),
        } as RTCSessionDescription;
        this.iceGatheringState = 'gathering';
        if (FakePeerConnection.scenario.startsWith('complete')) {
            queueMicrotask(() => {
                this.iceGatheringState = 'complete';
                this.dispatchEvent(new Event('icegatheringstatechange'));
            });
        } else if (FakePeerConnection.scenario === 'hang-candidate') {
            setTimeout(() => this.dispatchEvent(new Event('icecandidateerror')), 1);
        }
    }

    async setRemoteDescription(): Promise<void> {}

    close(): void {
        this.signalingState = 'closed';
        this.connectionState = 'closed';
        this.dispatchEvent(new Event('signalingstatechange'));
        this.onconnectionstatechange?.(new Event('connectionstatechange'));
    }
}

describe('ManualWebRTCTransport ICE gathering', () => {
    beforeEach(() => {
        FakePeerConnection.instances = [];
        FakePeerConnection.scenario = 'complete';
        vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses explicit LAN-only ICE configuration and cleans up after completion', async () => {
        const transport = new ManualWebRTCTransport('host', {
            iceServers: [],
            iceGatheringTimeoutMs: 100,
        });

        const offer = JSON.parse(atob(await transport.createOffer())) as RTCSessionDescriptionInit;
        const peer = FakePeerConnection.instances[0]!;

        expect(peer.configuration.iceServers).toEqual([]);
        expect(offer.sdp).toContain('a=candidate:');
        expect(transport.getLastIceGatheringWarning()).toBeNull();
        expect(peer.activeIceListenerCount()).toBe(0);
    });

    it('continues with a LAN candidate after a bounded STUN timeout', async () => {
        FakePeerConnection.scenario = 'hang-candidate';
        const transport = new ManualWebRTCTransport('host', { iceGatheringTimeoutMs: 15 });

        const offer = JSON.parse(atob(await transport.createOffer())) as RTCSessionDescriptionInit;
        const warning = transport.getLastIceGatheringWarning();

        expect(offer.sdp).toContain('typ host');
        expect(warning).toMatchObject({ code: 'ICE_GATHERING_TIMEOUT', candidateErrorCount: 1 });
        expect(FakePeerConnection.instances[0]!.activeIceListenerCount()).toBe(0);
    });

    it('fails quickly when the timeout leaves no usable candidate', async () => {
        FakePeerConnection.scenario = 'hang-empty';
        const transport = new ManualWebRTCTransport('host', { iceGatheringTimeoutMs: 5 });

        await expect(transport.createOffer()).rejects.toMatchObject({
            code: 'ICE_GATHERING_TIMEOUT',
        });
        expect(FakePeerConnection.instances[0]!.activeIceListenerCount()).toBe(0);
    });

    it('rejects a completed gathering operation that produced no candidate', async () => {
        FakePeerConnection.scenario = 'complete-empty';
        const transport = new ManualWebRTCTransport('host', { iceGatheringTimeoutMs: 100 });

        await expect(transport.createOffer()).rejects.toMatchObject({
            code: 'ICE_GATHERING_NO_CANDIDATES',
        });
        expect(FakePeerConnection.instances[0]!.activeIceListenerCount()).toBe(0);
    });

    it('cancels an in-flight gather and removes listeners when closed', async () => {
        FakePeerConnection.scenario = 'hang-candidate';
        const transport = new ManualWebRTCTransport('host', { iceGatheringTimeoutMs: 1_000 });
        const pendingOffer = transport.createOffer();
        await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.activeIceListenerCount()).toBe(3));

        transport.close();

        await expect(pendingOffer).rejects.toMatchObject({
            code: 'ICE_GATHERING_ABORTED',
        });
        expect(FakePeerConnection.instances[0]!.activeIceListenerCount()).toBe(0);
    });

    it('rejects invalid timeout configuration', () => {
        expect(() => new ManualWebRTCTransport('host', { iceGatheringTimeoutMs: 0 })).toThrow(RangeError);
    });

    it('waits through late guest data-channel creation until the channel opens', async () => {
        const transport = new ManualWebRTCTransport('guest', {
            iceServers: [],
            iceGatheringTimeoutMs: 100,
        });
        await transport.acceptOffer(btoa(JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' })));
        const peer = FakePeerConnection.instances[0]!;
        const ready = transport.waitUntilReady(100);

        peer.ondatachannel?.({ channel: peer.channel } as unknown as RTCDataChannelEvent);
        peer.channel.open();

        await expect(ready).resolves.toBeUndefined();
        expect(transport.isReady()).toBe(true);
    });
});
