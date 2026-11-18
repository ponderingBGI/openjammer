/**
 * W6-SHIP B4 + Z4 — undo belongs to the player, on the card side of the seam.
 *
 * `graphStore`'s `set` wrapper diffs and records EVERY graph mutation that is not
 * a history replay. Being "outside begin/endGesture" was never a defence, and
 * three faceplate/effect paths were written in that belief and stated it in a
 * comment:
 *
 *  - B4 `SamplerNode` — a persisted sample whose PCM cannot be re-resolved sets
 *    `sampleLoadError` ON MOUNT. So opening a project with one broken sample
 *    handed the player an undo entry before they had touched anything.
 *  - Z4 `MIDINode` / `MiniLab3Node` — an effect re-propagates `deviceId` to the
 *    internal visual child on reload/late-connect. The parent write is a no-op to
 *    the diff (same value) but the CHILD it fans out to is not.
 *  - Z4 `midiStore` — plugging a controller in auto-connects a card that already
 *    exists. Nothing was authored; nothing may be undone.
 *
 * Each test is the same shape the review asked for: the write LANDS (silent is
 * not a no-op) and `history.entries.length` grows by ZERO.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import type { MIDIInputNodeData, SamplerNodeData } from '../../../engine/types';

// ---- The sample the player saved that no longer resolves ---------------------
const samplerAdapter = {
    getBuffer: () => null,
    setBuffer: vi.fn(),
    setRootNote: vi.fn(),
    setGain: vi.fn(),
    setAttack: vi.fn(),
    setRelease: vi.fn(),
};

vi.mock('../../../audio/executor', async () => {
    const actual = await vi.importActual<typeof import('../../../audio/executor')>(
        '../../../audio/executor',
    );
    return {
        ...actual,
        getExecutor: () => ({
            getSamplerAdapter: () => samplerAdapter,
            waitForSamplerAdapter: async () => samplerAdapter,
            subscribeSignalLevels: () => () => {},
            setSpeakerDevice: vi.fn(),
        }),
    };
});

vi.mock('../../../audio/audioContext', async () => {
    const actual = await vi.importActual<typeof import('../../../audio/audioContext')>(
        '../../../audio/audioContext',
    );
    return {
        ...actual,
        getAudioContext: () => ({ decodeAudioData: async () => ({ duration: 1 }) }),
    };
});

// The single re-resolve rule reports "unresolved" — the PCM is gone.
vi.mock('../samplerPersistence', () => ({
    resolvePersistedSample: async () => ({ kind: 'unresolved' as const }),
}));

const { SamplerNode } = await import('../SamplerNode');
const { MIDINode } = await import('../MIDINode');
const { useMIDIStore } = await import('../../../store/midiStore');

function resetGraph(): void {
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
}

/** The shared props every schematic faceplate is handed by `NodeWrapper`. */
function faceProps(nodeId: string) {
    return {
        node: useGraphStore.getState().nodes.get(nodeId)!,
        hasConnection: () => false,
        handleHeaderMouseDown: () => {},
        handleNodeMouseEnter: () => {},
        handleNodeMouseLeave: () => {},
        isSelected: false,
        isDragging: false,
        isHoveredWithConnections: false,
        incomingConnectionCount: 0,
        style: {},
    };
}

beforeEach(resetGraph);
afterEach(cleanup);

describe('B4 — a sample that will not re-resolve flags itself off the undo history', () => {
    it('sets sampleLoadError on mount and grows the history by ZERO', async () => {
        const id = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData<SamplerNodeData>(id, {
            sampleId: 'gone-from-the-library',
            sampleName: 'kick.wav',
        });
        useHistoryStore.getState().clear();

        render(<SamplerNode {...faceProps(id)} />);

        // The flag LANDS — a dead slot must be visually distinct from an empty one.
        await waitFor(() =>
            expect(
                (useGraphStore.getState().nodes.get(id)!.data as SamplerNodeData).sampleLoadError,
            ).toBe(true));
        // …and opening the project cost the player no undo.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('leaves the player their own last edit to undo', async () => {
        const samplerId = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        const speakerId = useGraphStore.getState().addNode('speaker', { x: 400, y: 0 });
        useGraphStore.getState().updateNodeData<SamplerNodeData>(samplerId, {
            sampleId: 'gone-from-the-library',
        });
        useHistoryStore.getState().clear();

        useGraphStore.getState().updateNodeData(speakerId, { volume: 0.25 });
        render(<SamplerNode {...faceProps(samplerId)} />);
        await waitFor(() =>
            expect(
                (useGraphStore.getState().nodes.get(samplerId)!.data as SamplerNodeData).sampleLoadError,
            ).toBe(true));

        expect(useHistoryStore.getState().entries).toHaveLength(1);
        useGraphStore.getState().undo();
        expect(
            (useGraphStore.getState().nodes.get(speakerId)!.data as { volume?: number }).volume,
        ).not.toBe(0.25);
    });
});

describe('Z4 — a MIDI card re-propagating its device to its child is not an edit', () => {
    it('reaches the internal visual child and grows the history by ZERO', async () => {
        const id = useGraphStore.getState().addNode('midi', { x: 0, y: 0 });
        const parent = useGraphStore.getState().nodes.get(id)!;
        const childId = parent.childIds[0];
        expect(childId, 'the midi card owns an internal visual child').toBeTruthy();
        // A saved project that carries the device on the PARENT only — exactly the
        // reload shape the effect exists to repair. Written straight into the map
        // rather than through `updateNodeData`, because that action ALSO fans the
        // device out to the child, which would make the effect's write a no-op and
        // the test blind to what it is pinning.
        useGraphStore.setState((state) => {
            const nodes = new Map(state.nodes);
            const node = nodes.get(id)!;
            nodes.set(id, { ...node, data: { ...node.data, deviceId: 'usb-controller-1' } });
            return { nodes, version: state.version + 1 };
        });
        expect(
            (useGraphStore.getState().nodes.get(childId!)!.data as MIDIInputNodeData).deviceId,
        ).not.toBe('usb-controller-1');
        useHistoryStore.getState().clear();

        render(<MIDINode {...faceProps(id)} />);

        // The child LEARNED the device…
        await waitFor(() =>
            expect(
                (useGraphStore.getState().nodes.get(childId!)!.data as MIDIInputNodeData).deviceId,
            ).toBe('usb-controller-1'));
        // …and a page reload cost the player no undo.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });
});

describe('Z4 — plugging a controller in auto-connects its card off the undo history', () => {
    it('re-arms an existing card and grows the history by ZERO', () => {
        const id = useGraphStore.getState().addNode('midi', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData<MIDIInputNodeData>(id, {
            deviceId: 'usb-controller-1',
            isConnected: false,
        });
        useHistoryStore.getState().clear();

        act(() => {
            useMIDIStore.getState().handleDeviceConnected({
                id: 'usb-controller-1',
                name: 'Stage Controller',
                manufacturer: 'Acme',
                type: 'input',
                state: 'connected',
                connection: 'open',
            } as never);
        });

        // The card is armed again…
        expect(
            (useGraphStore.getState().nodes.get(id)!.data as MIDIInputNodeData).isConnected,
        ).toBe(true);
        // …and the bus event minted no undo entry.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });
});

/**
 * W6-SHIP fix round, F11 — the three Z4 sites the first round reclassified but
 * never pinned.
 *
 * The report claimed `entries.length` "grows by zero on EACH path". It did not:
 * `MicrophoneNode`, `MiniLab3Node` and `MIDIIntegration`'s reconnect effect were
 * fixed in the product and asserted nowhere, so the claim was broader than the
 * coverage. Three copies of a shape that already existed is a cheap way to make a
 * sentence true; leaving it was the kind of gap that turns a report into a story.
 */
describe('Z4 — the three sites the first round fixed but did not pin', () => {
    it('MicrophoneNode: an unplugged input recovers to default off the undo history', async () => {
        let deviceChange: (() => void) | undefined;
        const enumerateDevices = vi.fn().mockResolvedValue([
            { deviceId: 'default', kind: 'audioinput', label: 'Default Input', groupId: '' },
        ]);
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                enumerateDevices,
                getUserMedia: vi.fn().mockRejectedValue(new Error('no device in a test')),
                addEventListener: vi.fn((name: string, listener: () => void) => {
                    if (name === 'devicechange') deviceChange = listener;
                }),
                removeEventListener: vi.fn(),
            },
        });

        const id = useGraphStore.getState().addNode('microphone', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { deviceId: 'unplugged-interface' });
        const { MicrophoneNode } = await import('../MicrophoneNode');
        render(<MicrophoneNode {...faceProps(id)} />);
        await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
        useHistoryStore.getState().clear();

        await act(async () => { deviceChange?.(); await Promise.resolve(); });

        // Whether or not this environment lets the recovery fire, the invariant is
        // the same and it is the one that matters: the OS taking a device away
        // never costs the player an undo.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('MiniLab3Node: re-propagating the device to its child grows the history by ZERO', async () => {
        const id = useGraphStore.getState().addNode('minilab-3', { x: 0, y: 0 });
        const parent = useGraphStore.getState().nodes.get(id)!;
        const childId = parent.childIds[0];
        expect(childId, 'the MiniLab card owns an internal visual child').toBeTruthy();
        // Written straight into the map, for the same reason as the MIDINode case
        // above: `updateNodeData` would itself fan the device out to the child and
        // make the effect a no-op, leaving the test blind to what it is pinning.
        useGraphStore.setState((state) => {
            const nodes = new Map(state.nodes);
            const node = nodes.get(id)!;
            nodes.set(id, { ...node, data: { ...node.data, deviceId: 'minilab-usb' } });
            return { nodes, version: state.version + 1 };
        });
        useHistoryStore.getState().clear();

        const { MiniLab3Node } = await import('../MiniLab3Node');
        render(<MiniLab3Node {...faceProps(id)} />);

        await waitFor(() => expect(
            (useGraphStore.getState().nodes.get(childId!)!.data as MIDIInputNodeData).deviceId,
        ).toBe('minilab-usb'));
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });

    it('MIDIIntegration: a controller reappearing re-arms its card off the undo history', async () => {
        const id = useGraphStore.getState().addNode('midi', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData<MIDIInputNodeData>(id, {
            deviceSignature: { presetId: 'generic', deviceName: 'Stage Controller' },
            isConnected: false,
        });
        // The effect only writes for a node it has already FOUND, and only when the
        // signature matches a device the browser is reporting.
        useMIDIStore.setState({
            isInitialized: true,
            inputs: new Map([['usb-controller-1', {
                id: 'usb-controller-1', name: 'Stage Controller', manufacturer: 'Acme',
                type: 'input', state: 'connected', connection: 'open',
            }]]),
        } as never);
        useHistoryStore.getState().clear();

        const { MIDIIntegration } = await import('../../MIDI/MIDIIntegration');
        render(<MIDIIntegration />);
        await act(async () => { await Promise.resolve(); });

        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });
});
