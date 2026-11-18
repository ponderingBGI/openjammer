/**
 * W6-T / F4 — an editor open in a lane owns its own pointers.
 *
 * The inline piano roll renders INSIDE `.arrangement-lane`, in place of the
 * clips. The lane's empty-ground gesture excluded `.arrangement-clip` but not the
 * roll, so every press on a note ALSO started the arrangement's range-select:
 * the roll set `noteIds` first, the lane wrote the surface selection last, and
 * every roll keyboard action — which all begin `if (!selectedNoteIds.length)
 * return` — went dead the moment a pointer touched a note. The FULL roll surface
 * was never affected, which is the tell (W6-E2E finding F4).
 *
 * These tests drive the same pointer stream a finger and a mouse produce, through
 * the real `ArrangementSurface` with a real Paper Sketch, and assert the two
 * halves that matter: the roll keeps its selection, and the lane's own gesture on
 * its own ground is untouched.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { useUiViewStore } from '../../../store/uiViewStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { resolveKeydown } from '../../../keymap/arbiter';

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    class TestResizeObserver {
        observe() {}
        disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(cleanup);

let trackId = '';
let clipId = '';

function openInlineRoll() {
    useArrangementStore.getState().setArrangement(buildPaperSketch());
    useHistoryStore.getState().clear();
    const arrangement = useArrangementStore.getState().arrangement!;
    const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
    const clip = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!;
    trackId = track.id ?? track.ref;
    clipId = clip.id!;
    useTrackLaneViewStore.setState({
        expandedPianoRolls: { [trackId]: clipId },
        laneHeights: { [trackId]: 220 },
        previousLaneHeights: { [trackId]: 72 },
        automationLaneByTrack: {},
        headerWidth: 200,
        mixerOpen: false,
    });
    useUiViewStore.getState().setSurface('arrangement');
    return render(<ArrangementSurface active songNodeId="song-1" />);
}

const selection = () => useEditingContextStore.getState().viewports.arrangement.selection;

/** The whole stream a press-and-release produces, capture and all. */
function pressAndRelease(target: Element, at: { clientX: number; clientY: number }) {
    act(() => {
        fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId: 7, ...at });
        fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerId: 7, ...at });
    });
}

describe('W6-T F4 — the inline roll keeps its note selection', () => {
    beforeEach(() => {
        useEditingContextStore.getState().clearSelection('arrangement');
    });

    it('clicking a note selects that note, and ArrowUp transposes it', () => {
        const { container } = openInlineRoll();
        const note = container.querySelector<HTMLElement>('.piano-roll--inline .piano-roll-note[data-note-id]');
        expect(note, 'Paper Sketch\'s first MIDI clip has a note to press').not.toBeNull();
        const noteId = note!.dataset.noteId!;
        const pitchOf = () => {
            const arrangement = useArrangementStore.getState().arrangement!;
            const source = Object.values(arrangement.sources ?? {}).find((item) => item.kind === 'midi' && item.notes.some((entry) => entry.id === noteId));
            return source && source.kind === 'midi' ? source.notes.find((entry) => entry.id === noteId)!.pitch : -1;
        };
        const before = pitchOf();

        pressAndRelease(note!, { clientX: 420, clientY: 300 });

        expect(selection().noteIds, 'a pointer gesture on a note leaves it selected').toEqual([noteId]);
        expect(selection().timeRange, 'and does not hand the selection to the lane').toBeNull();

        // The whole point of the selection: every roll keyboard action begins
        // `if (!selectedNoteIds.length) return`, so this is the behaviour F4 killed.
        const roll = container.querySelector<HTMLElement>('[data-keymap-surface="pianoroll"]')!;
        roll.focus();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
        expect(pitchOf(), 'ArrowUp must transpose the note the pointer just selected').toBe(before + 1);
    });

    it('a press on the roll\'s own empty grid never creates an arrangement time range', () => {
        const { container } = openInlineRoll();
        const roll = container.querySelector<HTMLElement>('.piano-roll--inline')!;
        for (const selector of ['.piano-roll__field', '.piano-roll__keys', '.piano-roll__velocity']) {
            const target = roll.querySelector(selector);
            if (!target) continue;
            pressAndRelease(target, { clientX: 420, clientY: 300 });
            // The roll's own marquee may replace `noteIds` — that is its gesture.
            // What must never happen is the LANE writing a range over the top.
            expect(selection().timeRange, `${selector} must not start a lane range`).toBeNull();
        }
    });

    it('still clears the selection when the press really is on the lane ground', () => {
        const { container } = openInlineRoll();
        // A lane with no roll open: its own ground, its own gesture, unchanged.
        const plainLane = [...container.querySelectorAll<HTMLElement>('.arrangement-lane')]
            .find((lane) => !lane.querySelector('.piano-roll'));
        expect(plainLane, 'Paper Sketch has more than one track').toBeDefined();

        useEditingContextStore.getState().setSelection('arrangement', { noteIds: ['pinned-note'] });
        pressAndRelease(plainLane!, { clientX: 420, clientY: 300 });

        expect(selection().noteIds, 'a click on empty lane ground still clears').toEqual([]);
    });
});
