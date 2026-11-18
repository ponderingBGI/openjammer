import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement } from '../../../song/types';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useHistoryStore } from '../../../store/historyStore';
import { MixerDrawer } from '../MixerDrawer';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ subscribeSignalLevels: () => () => {} }),
}));

const arrangement: Arrangement = {
    name: 'Mixer', tempoBpm: 120, ppq: 960,
    graph: { nodes: [], connections: [] },
    tracks: [{ id: 'track-1', ref: 'track-1', name: 'Track 1', clips: [] }],
};

describe('TL-12 mixer gesture history', () => {
    beforeEach(() => {
        useArrangementStore.getState().setArrangement(arrangement);
        useHistoryStore.getState().clear();
        HTMLElement.prototype.setPointerCapture = vi.fn();
    });

    it('applies a typed pan value through the real inline editor', () => {
        render(<MixerDrawer />);
        fireEvent.click(screen.getByLabelText('Track 1 pan'));
        const editor = screen.getByRole('spinbutton', { name: 'Edit value' });
        fireEvent.change(editor, { target: { value: '0.4' } });
        fireEvent.keyDown(editor, { key: 'Enter' });
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.pan).toBe(0.4);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('owns pan pointer commit once, suppresses the post-drag editor, and still accepts later typing', () => {
        render(<MixerDrawer />);
        const pan = screen.getByLabelText('Track 1 pan');
        act(() => {
            fireEvent.pointerDown(pan, { pointerId: 4, clientY: 100 });
            fireEvent.pointerMove(pan, { pointerId: 4, clientY: 60 });
            fireEvent.pointerUp(pan, { pointerId: 4, clientY: 60 });
        });
        expect(useHistoryStore.getState().cursor).toBe(1);
        fireEvent.click(pan);
        expect(screen.queryByRole('spinbutton', { name: 'Edit value' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Track 1 pan'));
        const editor = screen.getByRole('spinbutton', { name: 'Edit value' });
        fireEvent.change(editor, { target: { value: '-0.3' } });
        fireEvent.keyDown(editor, { key: 'Enter' });
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.pan).toBe(-0.3);
        expect(useHistoryStore.getState().cursor).toBe(2);
    });
});
