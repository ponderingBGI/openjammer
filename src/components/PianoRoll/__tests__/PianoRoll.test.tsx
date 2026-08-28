import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { PianoRollLane } from '../PianoRoll';

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('PianoRoll pointer gesture lifetime', () => {
    let trackId: string;
    let clipId: string;
    let noteId: string;

    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
        const clip = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!;
        const source = arrangement.sources![clip.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        trackId = track.id!;
        clipId = clip.id!;
        noteId = source.notes.find((note) => note.id)!.id!;
        useEditingContextStore.getState().setSelection('arrangement', { noteIds: [noteId] });
    });

    const renderRoll = () => render(<PianoRollLane trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
    const noteTick = () => {
        const arrangement = useArrangementStore.getState().arrangement!;
        const source = arrangement.sources![arrangement.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        return source.notes.find((note) => note.id === noteId)!.tick;
    };

    it('commits a note drag released on window as one history entry after capture loss', () => {
        const { container } = renderRoll();
        const note = container.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!;
        const original = noteTick();
        const offsetX = Number.parseFloat(note.style.width) / 2;
        const down = new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 31 });
        Object.defineProperty(down, 'offsetX', { value: offsetX });
        fireEvent(note, down);
        fireEvent.pointerMove(window, { pointerId: 31, clientX: 220, clientY: 100 });
        note.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 31 }));
        fireEvent.pointerUp(window, { pointerId: 31, clientX: 220, clientY: 100 });
        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().cursor).toBe(1);
        expect(noteTick()).toBeGreaterThan(original);
    });

    it('aborts a note drag on window pointercancel and restores the note', () => {
        const { container } = renderRoll();
        const note = container.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!;
        const original = noteTick();
        fireEvent.pointerDown(note, { button: 0, pointerId: 32, clientX: 100, clientY: 100, offsetX: 50 });
        fireEvent.pointerMove(window, { pointerId: 32, clientX: 140, clientY: 100 });
        fireEvent.pointerCancel(window, { pointerId: 32 });
        expect(noteTick()).toBe(original);
        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().cursor).toBe(0);
    });

    it('keeps 60 velocity-wheel notches over 6 seconds in one live undo entry', () => {
        vi.useFakeTimers();
        useEditingContextStore.setState({ scrollVelocityEditing: true });
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        const before = (() => {
            const arrangement = useArrangementStore.getState().arrangement!;
            const source = arrangement.sources![arrangement.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
            if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
            return source.notes.find((note) => note.id === noteId)!.vel ?? 96;
        })();
        for (let index = 0; index < 60; index += 1) {
            fireEvent.wheel(root, { deltaY: 1 });
            act(() => vi.advanceTimersByTime(100));
        }
        act(() => vi.advanceTimersByTime(181));
        const arrangement = useArrangementStore.getState().arrangement!;
        const source = arrangement.sources![arrangement.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        expect(source.notes.find((note) => note.id === noteId)!.vel).toBe(Math.max(0, before - 60));
        expect(useHistoryStore.getState().cursor).toBe(1);
        expect(useArrangementStore.getState().isGestureOpen()).toBe(false);
    });
});
