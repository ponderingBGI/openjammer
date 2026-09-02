/**
 * U11 / HA-13 — Erase and Knife are real on the Song.
 *
 * `X` was a rendered, enabled button in the ruler corner that did nothing when
 * clicked: `ArrangementSurface` read the tool in exactly one place and tested it
 * against `'draw'`. `K` was a keybinding with no behaviour and no button. Both
 * now press through `useClipGesture` — the same place a move, a trim and a slip
 * begin — and lower to the shipped ops (`deleteClips`, `splitAt`), so the hand,
 * the keyboard and the agent are still speaking one vocabulary.
 *
 * The two laws being pinned: a stroke is ONE undo, and a gesture that lands on
 * nothing writes nothing.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement, ArrangementClip } from '../../../song/types';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useClipGesture } from '../useClipGesture';

const CLIP_A: ArrangementClip = { id: 'clip-a', sourceId: 'source-1', startTick: 1_000, lengthTick: 480, sourceStart: 0 };
const CLIP_B: ArrangementClip = { id: 'clip-b', sourceId: 'source-1', startTick: 2_000, lengthTick: 480, sourceStart: 0 };
const ARRANGEMENT: Arrangement = {
    name: 'Song tools', tempoBpm: 120, ppq: 960,
    sources: { 'source-1': { id: 'source-1', kind: 'midi', name: 'Source', notes: [], lengthTick: 4_000 } },
    graph: { nodes: [], connections: [] },
    tracks: [{ id: 'track-1', ref: 'track-1', clips: [CLIP_A, CLIP_B] }],
};

/** One `<button class="arrangement-clip">` per clip, wired exactly as `ClipView` wires it. */
function Clip({ clip }: { clip: ArrangementClip }) {
    const gesture = useClipGesture(clip, 'track-1', 1, clip.lengthTick, 56, () => undefined);
    return (
        <button
            className="arrangement-clip"
            data-clip-id={clip.id}
            aria-label={clip.id}
            onPointerDown={gesture.onPointerDown}
            onPointerCancel={gesture.onPointerCancel}
        >{clip.id}</button>
    );
}

function Harness() {
    return <div data-track-id="track-1"><Clip clip={CLIP_A} /><Clip clip={CLIP_B} /></div>;
}

const clips = () => useArrangementStore.getState().arrangement!.tracks[0]!.clips;

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
    useEditingContextStore.getState().setSelection('arrangement', { clipIds: [] });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
});

afterEach(() => {
    cleanup();
    useArrangementStore.getState().abortGesture();
    useEditingContextStore.getState().setViewport('arrangement', { tool: 'select' });
});

describe('Erase tool (X) on the Song', () => {
    it('a click deletes the clip under the pointer, in one undo', () => {
        useEditingContextStore.getState().setViewport('arrangement', { tool: 'erase' });
        render(<Harness />);

        fireEvent.pointerDown(screen.getByLabelText('clip-a'), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 10 });

        expect(clips().map((clip) => clip.id)).toEqual(['clip-b']);
        expect(useHistoryStore.getState().cursor).toBe(1);
        act(() => useArrangementStore.getState().undo());
        expect(clips().map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
    });

    it('a drag deletes everything it sweeps, and it is still ONE undo', () => {
        useEditingContextStore.getState().setViewport('arrangement', { tool: 'erase' });
        render(<Harness />);
        // jsdom has no layout: the hit test is stubbed to the second clip once
        // the stroke has moved past it.
        (document.elementFromPoint as unknown as ReturnType<typeof vi.fn>).mockImplementation(
            (x: number) => (x > 500 ? screen.getByLabelText('clip-b') : null),
        );

        fireEvent.pointerDown(screen.getByLabelText('clip-a'), { button: 0, pointerId: 2, clientX: 20, clientY: 10 });
        fireEvent.pointerMove(window, { pointerId: 2, clientX: 900, clientY: 10 });
        fireEvent.pointerUp(window, { pointerId: 2, clientX: 900, clientY: 10 });

        expect(clips()).toHaveLength(0);
        expect(useHistoryStore.getState().cursor, 'one stroke, one Ctrl+Z').toBe(1);
        act(() => useArrangementStore.getState().undo());
        expect(clips()).toHaveLength(2);
    });
});

describe('Knife tool (K) on the Song', () => {
    it('a click splits the clip at the pointer, in one undo', () => {
        useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
        render(<Harness />);

        // pxPerTick is 1 and jsdom puts the element's left edge at 0, so
        // clientX 240 is 240 ticks into a clip that starts at tick 1000.
        fireEvent.pointerDown(screen.getByLabelText('clip-a'), { button: 0, pointerId: 3, clientX: 240, clientY: 10 });

        const after = clips();
        expect(after).toHaveLength(3);
        const halves = after.filter((clip) => clip.startTick === 1_000 || clip.startTick === 1_240);
        expect(halves).toHaveLength(2);
        expect(halves.map((clip) => clip.lengthTick).sort((a, b) => a - b)).toEqual([240, 240]);
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toHaveLength(2);
        expect(useHistoryStore.getState().cursor).toBe(1);

        act(() => useArrangementStore.getState().undo());
        expect(clips().map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
    });

    it('a click on the clip\'s own edge is not a cut and writes nothing', () => {
        useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
        render(<Harness />);

        fireEvent.pointerDown(screen.getByLabelText('clip-a'), { button: 0, pointerId: 4, clientX: 0, clientY: 10 });

        expect(clips()).toHaveLength(2);
        expect(useHistoryStore.getState().cursor).toBe(0);
    });

    it('leaves the move gesture alone when the tool is Select', () => {
        render(<Harness />);
        fireEvent.pointerDown(screen.getByLabelText('clip-a'), { button: 0, pointerId: 5, clientX: 240, clientY: 10 });
        fireEvent.pointerMove(window, { pointerId: 5, clientX: 340, clientY: 10 });
        fireEvent.pointerUp(window, { pointerId: 5, clientX: 340, clientY: 10 });

        expect(clips()).toHaveLength(2);
        expect(clips()[0]!.startTick).toBe(1_100);
    });
});
