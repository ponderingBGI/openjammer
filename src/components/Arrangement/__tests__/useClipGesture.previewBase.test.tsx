import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement, ArrangementClip } from '../../../song/types';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useClipGesture } from '../useClipGesture';

const CLIP: ArrangementClip = { id: 'clip-1', sourceId: 'source-1', startTick: 1_000, lengthTick: 480, sourceStart: 200 };
const ARRANGEMENT: Arrangement = {
    name: 'Gesture base', tempoBpm: 120, ppq: 960,
    sources: { 'source-1': { id: 'source-1', kind: 'midi', name: 'Source', notes: [], lengthTick: 2_000 } },
    graph: { nodes: [], connections: [] },
    tracks: [{ id: 'track-1', ref: 'track-1', clips: [CLIP] }],
};

function Harness() {
    const gesture = useClipGesture(CLIP, 'track-1', 1, 200, 56, () => undefined);
    return <div data-track-id="track-1"><button aria-label="clip" onPointerDown={gesture.onPointerDown} onPointerCancel={gesture.onPointerCancel}>clip</button></div>;
}

const currentClip = () => useArrangementStore.getState().arrangement!.tracks[0]!.clips[0]!;

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
});

beforeEach(() => {
    useArrangementStore.getState().setArrangement(structuredClone(ARRANGEMENT));
    useHistoryStore.getState().clear();
    useEditingContextStore.setState({ snapMode: 'off' });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => screen.getByLabelText('clip').parentElement) });
});

afterEach(() => {
    cleanup();
    useArrangementStore.getState().abortGesture();
});

describe('useClipGesture gesture base', () => {
    it('does not compound 25 pointermove reports at the same coordinate', () => {
        render(<Harness />);
        const clip = screen.getByLabelText('clip');
        fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 50 });
        for (let index = 0; index < 24; index++) fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 50 });
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 150, clientY: 50 });
        expect(currentClip().startTick).toBe(1_100);
    });

    it('maps +100 px to +100 ticks and commits one undoable history entry', () => {
        render(<Harness />);
        const clip = screen.getByLabelText('clip');
        fireEvent.pointerDown(clip, { button: 0, pointerId: 2, clientX: 50, clientY: 50 });
        for (let index = 0; index < 10; index++) fireEvent.pointerMove(window, { pointerId: 2, clientX: 150, clientY: 50 });
        fireEvent.pointerUp(window, { pointerId: 2, clientX: 150, clientY: 50 });
        expect(currentClip().startTick).toBe(1_100);
        expect(useHistoryStore.getState().cursor).toBe(1);
        act(() => useArrangementStore.getState().undo());
        expect(currentClip().startTick).toBe(1_000);
    });

    it('computes repeated slip previews from the pointerdown source window', () => {
        render(<Harness />);
        const clip = screen.getByLabelText('clip');
        fireEvent.pointerDown(clip, { button: 0, pointerId: 3, clientX: 50, clientY: 50, ctrlKey: true, shiftKey: true });
        fireEvent.pointerMove(window, { pointerId: 3, clientX: 150, clientY: 50, ctrlKey: true, shiftKey: true });
        for (let index = 0; index < 24; index++) fireEvent.pointerMove(window, { pointerId: 3, clientX: 150, clientY: 50, ctrlKey: true, shiftKey: true });
        fireEvent.pointerUp(window, { pointerId: 3, clientX: 150, clientY: 50 });
        expect(currentClip().sourceStart).toBe(300);
    });
});
