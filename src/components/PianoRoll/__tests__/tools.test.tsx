/**
 * U11 / HA-13 — the roll's Erase and Knife tools do what their buttons say.
 *
 * `K` was rendered, enabled, labelled "Knife tool" and wired to nothing; `X`
 * deleted a note on click but a stroke across nine of them cost nine undos.
 * Both now lower to the shipped ops (`eraseNotes`, `splitNotes`) inside ONE
 * gesture, so a rub-out and a cut each cost exactly one Ctrl+Z, and both say
 * what they did in the roll's own polite status line.
 */

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
    document.elementFromPoint = originalElementFromPoint;
});

const originalElementFromPoint = document.elementFromPoint;

const PX_PER_TICK = 0.1;

describe('piano-roll Erase and Knife', () => {
    let trackId: string;
    let clipId: string;

    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        // Snapping is a separate contract; these tests are about WHAT the tools
        // do, so the pointer tick is the pointer tick.
        useEditingContextStore.setState({ gridUnit: 'none', snapMode: 'off' });
        useEditingContextStore.getState().setSelection('arrangement', { noteIds: [] });
        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
        trackId = track.id!;
        clipId = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!.id!;
    });

    const renderRoll = () => render(<PianoRollLane trackId={trackId} clipId={clipId} pxPerTick={PX_PER_TICK} />);

    function midi() {
        const arrangement = useArrangementStore.getState().arrangement!;
        const clip = arrangement.tracks.find((track) => track.id === trackId)!.clips.find((item) => item.id === clipId)!;
        const source = arrangement.sources![clip.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        return { clip, notes: source.notes };
    }

    const press = (element: Element, init: PointerEventInit = {}) =>
        act(() => { fireEvent(element, new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, ...init })); });

    describe('Erase (X)', () => {
        it('a click deletes the note under the pointer, in one undo', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'erase' });
            const { container } = renderRoll();
            const before = midi().notes.length;
            const note = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!;
            const id = note.dataset.noteId!;

            press(note);
            act(() => { fireEvent(window, new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); });

            expect(midi().notes.map((item) => item.id)).not.toContain(id);
            expect(midi().notes.length).toBe(before - 1);
            expect(useHistoryStore.getState().cursor).toBe(1);
            expect(container.querySelector('.piano-roll__notice')?.textContent).toBe('Note erased.');
        });

        it('a stroke deletes everything it sweeps — and it is still ONE undo', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'erase' });
            const { container } = renderRoll();
            const before = midi().notes.length;
            const notes = [...container.querySelectorAll<HTMLElement>('.piano-roll-note[data-note-id]')].slice(0, 3);
            expect(notes.length, 'the fixture must have three notes to sweep').toBe(3);
            const ids = notes.map((element) => element.dataset.noteId!);

            // jsdom has no layout, so the hit test is stubbed: x = which note.
            document.elementFromPoint = ((x: number) => notes[x] ?? null) as typeof document.elementFromPoint;

            press(notes[0]!);
            act(() => {
                fireEvent(window, new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 1 }));
                fireEvent(window, new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 2 }));
                fireEvent(window, new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 2 }));
            });

            expect(midi().notes.length).toBe(before - 3);
            for (const id of ids) expect(midi().notes.map((item) => item.id)).not.toContain(id);
            expect(useHistoryStore.getState().cursor, 'one stroke, one Ctrl+Z').toBe(1);
            expect(container.querySelector('.piano-roll__notice')?.textContent).toBe('3 notes erased.');

            act(() => { useHistoryStore.getState().undo(); });
            expect(midi().notes.length).toBe(before);
        });

        it('a stroke that touches nothing records nothing', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'erase' });
            const { container } = renderRoll();
            const before = midi().notes.length;
            document.elementFromPoint = (() => null) as typeof document.elementFromPoint;

            press(container.querySelector('.piano-roll__field')!, { clientX: 4000, clientY: 4000 });
            act(() => { fireEvent(window, new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); });

            expect(midi().notes.length).toBe(before);
            expect(useHistoryStore.getState().cursor, 'a miss is not an edit').toBe(0);
        });
    });

    describe('Knife (K)', () => {
        /** The clientX that lands mid-way through `note`, in song pixels. */
        const midpointX = (note: { tick: number; durTick: number }, clip: { startTick: number; sourceStart?: number }) =>
            (clip.startTick + note.tick - (clip.sourceStart ?? 0) + note.durTick / 2) * PX_PER_TICK;

        it('a click cuts the note in two at the pointer, in one undo', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
            const { container } = renderRoll();
            const { clip, notes } = midi();
            const before = notes.length;
            const element = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!;
            const target = notes.find((item) => item.id === element.dataset.noteId)!;

            press(element, { clientX: midpointX(target, clip) });

            const after = midi().notes;
            expect(after.length).toBe(before + 1);
            const left = after.find((item) => item.id === target.id)!;
            const right = after.find((item) => item.pitch === target.pitch && item.tick === left.tick + left.durTick)!;
            // Abutting, same pitch, same total length — a cut, not an edit.
            expect(right).toBeDefined();
            expect(left.durTick + right.durTick).toBe(target.durTick);
            expect(useHistoryStore.getState().cursor).toBe(1);
            expect(container.querySelector('.piano-roll__notice')?.textContent).toBe('Note split.');
            expect(useEditingContextStore.getState().viewports.arrangement.selection.noteIds).toEqual([left.id, right.id]);

            act(() => { useHistoryStore.getState().undo(); });
            expect(midi().notes.length).toBe(before);
        });

        it('a cut on the note\'s own edge says so instead of minting a zero-length note', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
            const { container } = renderRoll();
            const { clip, notes } = midi();
            const before = notes.length;
            const element = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!;
            const target = notes.find((item) => item.id === element.dataset.noteId)!;

            press(element, { clientX: (clip.startTick + target.tick - (clip.sourceStart ?? 0)) * PX_PER_TICK });

            expect(midi().notes.length).toBe(before);
            expect(useHistoryStore.getState().cursor).toBe(0);
            expect(container.querySelector('.piano-roll__notice')?.textContent).toBe('Cut inside the note, not on its edge.');
        });

        it('refuses a sliver, and says which refusal it is (F3)', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
            const { container } = renderRoll();
            const { clip, notes } = midi();
            const before = notes.length;
            const element = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!;
            const target = notes.find((item) => item.id === element.dataset.noteId)!;

            // One tick inside the left edge. Before F3 this minted a fragment
            // about a pixel wide, under the drag floor and impossible to grab.
            press(element, { clientX: (clip.startTick + target.tick - (clip.sourceStart ?? 0) + 1) * PX_PER_TICK });

            expect(midi().notes.length).toBe(before);
            expect(useHistoryStore.getState().cursor).toBe(0);
            expect(container.querySelector('.piano-roll__notice')?.textContent).toBe('Too close to the edge to split.');
        });

        it('does not also start a move drag', () => {
            useEditingContextStore.getState().setViewport('arrangement', { tool: 'knife' });
            const { container } = renderRoll();
            const { clip, notes } = midi();
            const element = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!;
            const target = notes.find((item) => item.id === element.dataset.noteId)!;

            press(element, { clientX: midpointX(target, clip) });
            act(() => {
                fireEvent(window, new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 9000, clientY: 400 }));
                fireEvent(window, new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 9000, clientY: 400 }));
            });

            // The cut, and nothing else: a stray drag after the click must not
            // have opened a second history entry.
            expect(useHistoryStore.getState().cursor).toBe(1);
        });
    });

    describe('HA-18 — the roll carries its own zoom', () => {
        it('offers a zoom control whose title names the wheel shortcut', () => {
            const { container } = renderRoll();
            const group = container.querySelector<HTMLElement>('.piano-roll__zoom')!;
            expect(group).not.toBeNull();
            const titles = [...group.querySelectorAll('button')].map((button) => button.getAttribute('title'));
            expect(titles).toEqual(['Zoom out — Ctrl+wheel', 'Zoom in — Ctrl+wheel']);
        });

        it('widens the notes without touching the Song\'s own axis', () => {
            const { container } = renderRoll();
            const widthOf = () => Number.parseFloat(container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!.style.width);
            const before = widthOf();
            const songAxis = useEditingContextStore.getState().viewports.arrangement.pxPerTick;

            act(() => { fireEvent.click(container.querySelector('.piano-roll__zoom button:last-of-type')!); });

            expect(widthOf()).toBeGreaterThan(before);
            expect(useEditingContextStore.getState().viewports.arrangement.pxPerTick).toBe(songAxis);
        });
    });
});
