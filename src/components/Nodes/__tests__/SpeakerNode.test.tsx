import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakerNode } from '../SpeakerNode';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';

const setSpeakerDevice = vi.fn();

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        setSpeakerDevice,
        setSpeakerVolume: vi.fn(),
        subscribeSignalLevels: () => () => {},
    }),
}));

describe('SpeakerNode device recovery policy', () => {
    let enumerateDevices: ReturnType<typeof vi.fn>;
    let deviceChange: (() => void) | undefined;

    beforeEach(() => {
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
        setSpeakerDevice.mockClear();
        deviceChange = undefined;
        enumerateDevices = vi.fn().mockResolvedValue([
            { deviceId: 'default', kind: 'audiooutput', label: 'Default Output', groupId: '' },
        ]);
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                enumerateDevices,
                addEventListener: vi.fn((name: string, listener: () => void) => {
                    if (name === 'devicechange') deviceChange = listener;
                }),
                removeEventListener: vi.fn(),
            },
        });
    });

    it('does not change routing on mount, then falls back when devicechange removes the selected output', async () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { deviceId: 'unplugged-interface' });
        const node = useGraphStore.getState().nodes.get(id)!;

        render(<SpeakerNode node={node} />);
        await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
        expect(setSpeakerDevice).not.toHaveBeenCalled();
        expect((useGraphStore.getState().nodes.get(id)!.data as { deviceId?: string }).deviceId)
            .toBe('unplugged-interface');

        await act(async () => {
            deviceChange?.();
            await Promise.resolve();
        });

        await waitFor(() => expect(setSpeakerDevice).toHaveBeenCalledWith(id, 'default'));
        expect((useGraphStore.getState().nodes.get(id)!.data as { deviceId?: string }).deviceId)
            .toBe('default');
    });

    it('preserves an explicit route when permission-less enumeration withholds device ids', async () => {
        enumerateDevices.mockResolvedValue([
            { deviceId: '', kind: 'audiooutput', label: '', groupId: '' },
        ]);
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { deviceId: 'stage-interface' });
        render(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);
        await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

        await act(async () => {
            deviceChange?.();
            await Promise.resolve();
        });

        expect(setSpeakerDevice).not.toHaveBeenCalled();
        expect((useGraphStore.getState().nodes.get(id)!.data as { deviceId?: string }).deviceId)
            .toBe('stage-interface');
    });

    it('recovers WITHOUT growing the undo history — an unplugged cable is not an edit', async () => {
        // W6-SHIP Z4. The OS taking a device away is the environment, not the
        // player. If this write records, the next `Ctrl+Z` mid-set re-selects an
        // output that is physically gone — undo spent on bookkeeping, and the
        // performer's actual last edit still on the stack behind it.
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { deviceId: 'unplugged-interface' });
        render(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);
        await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
        useHistoryStore.getState().clear();

        await act(async () => {
            deviceChange?.();
            await Promise.resolve();
        });

        // The recovery LANDED…
        await waitFor(() =>
            expect((useGraphStore.getState().nodes.get(id)!.data as { deviceId?: string }).deviceId)
                .toBe('default'));
        // …and history never noticed.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });
});
