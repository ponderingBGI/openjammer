import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eraseNotes } from '../../../song/ops';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { PianoRollLane, PianoRollSurface } from '../PianoRoll';
import { resolveKeydown } from '../../../keymap/arbiter';
import { timelineFrameWriterCountForTests } from '../../Arrangement/sharedAnimationFrame';

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
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        const before = (() => {
            const arrangement = useArrangementStore.getState().arrangement!;
            const source = arrangement.sources![arrangement.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
            if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
            return source.notes.find((note) => note.id === noteId)!.vel ?? 96;
        })();
        for (let index = 0; index < 60; index += 1) {
            fireEvent.wheel(root, { deltaY: 1, altKey: true });
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

    it('leaves velocity untouched for a plain wheel so the roll can scroll', () => {
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        const before = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (before.kind !== 'midi') throw new Error('fixture must contain MIDI');
        const velocity = before.notes.find((note) => note.id === noteId)!.vel;
        fireEvent.wheel(root, { deltaY: 100 });
        const after = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (after.kind !== 'midi') throw new Error('fixture must contain MIDI');
        expect(after.notes.find((note) => note.id === noteId)!.vel).toBe(velocity);
        expect(useHistoryStore.getState().cursor).toBe(0);
    });

    it('routes inline-roll arrows through the focused piano-roll binding set', () => {
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        root.focus();
        const sourceBefore = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (sourceBefore.kind !== 'midi') throw new Error('fixture must contain MIDI');
        const pitch = sourceBefore.notes.find((note) => note.id === noteId)!.pitch;
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
        const sourceAfter = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (sourceAfter.kind !== 'midi') throw new Error('fixture must contain MIDI');
        expect(sourceAfter.notes.find((note) => note.id === noteId)!.pitch).toBe(pitch + 1);
    });

    it('undoes an inline-roll transpose with Ctrl+Z while the roll remains focused', () => {
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        root.focus();
        const pitch = (() => {
            const source = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
            if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
            return source.notes.find((note) => note.id === noteId)!.pitch;
        })();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
        expect(useHistoryStore.getState().cursor).toBe(1);
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
        const source = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        expect(source.notes.find((note) => note.id === noteId)!.pitch).toBe(pitch);
    });

    it('keeps one shared-frame subscription while published playhead ticks change', () => {
        const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        const baseline = timelineFrameWriterCountForTests();
        act(() => useArrangementStore.setState({ isPlaying: true }));
        renderRoll();
        expect(timelineFrameWriterCountForTests()).toBe(baseline + 1);
        const registrations = requestFrame.mock.calls.length;
        for (const playheadTick of [120, 240, 360]) act(() => useArrangementStore.setState({ playheadTick }));
        expect(timelineFrameWriterCountForTests()).toBe(baseline + 1);
        expect(requestFrame).toHaveBeenCalledTimes(registrations);
        requestFrame.mockRestore();
    });

    it('uses a non-passive wheel listener when preventing native scroll', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const addEventListener = vi.spyOn(HTMLElement.prototype, 'addEventListener');
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        fireEvent(root, new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -10, ctrlKey: true, shiftKey: true }));
        fireEvent(root, new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -10, altKey: true }));
        expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('passive event listener'));
        expect(addEventListener.mock.calls.some(([type, , options]) => type === 'wheel' && typeof options === 'object' && options?.passive === false)).toBe(true);
        addEventListener.mockRestore();
        consoleError.mockRestore();
    });

    it('gives armed step entry priority over transport and tool letters', () => {
        const { container } = renderRoll();
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        root.focus();
        const before = useArrangementStore.getState().arrangement!.sources![useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((clip) => clip.id === clipId)!.sourceId]!;
        if (before.kind !== 'midi') throw new Error('fixture must contain MIDI');
        act(() => { useEditingContextStore.getState().setSelection('arrangement', { noteIds: [] }); });
        const clip = useArrangementStore.getState().arrangement!.tracks.find((track) => track.id === trackId)!.clips.find((item) => item.id === clipId)!;
        act(() => { useEditingContextStore.getState().setStepEntry({ trackId, positionTick: clip.startTick + 1, length: '1/32' }); useEditingContextStore.getState().setViewport('arrangement', { tool: 'select' }); });
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'b', bubbles: true })); });
        expect(useEditingContextStore.getState().viewports.arrangement.tool).toBe('select');
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
        const after = useArrangementStore.getState().arrangement!.sources![clip.sourceId]!;
        if (after.kind !== 'midi') throw new Error('fixture must contain MIDI');
        expect(after.notes).toHaveLength(before.notes.length + 1);
        const position = useEditingContextStore.getState().stepEntry.positionTick;
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
        expect(useEditingContextStore.getState().stepEntry.positionTick).toBeGreaterThan(position);
    });

    it('cascades Escape from selection clear to closing the piano-roll surface', () => {
        const close = vi.fn();
        useEditingContextStore.getState().setSelection('pianoroll', { noteIds: [noteId] });
        const { container } = render(<PianoRollSurface trackId={trackId} clipId={clipId} pxPerTick={0.1} onClose={close} />);
        const root = container.querySelector<HTMLElement>('.piano-roll')!;
        root.focus();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(useEditingContextStore.getState().viewports.pianoroll.selection.noteIds).toEqual([]);
        expect(close).not.toHaveBeenCalled();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(close).toHaveBeenCalledOnce();
    });
});

/**
 * BC-30 — "an exact time+pitch duplicate is never minted" — and the other half of
 * the law, which is that a refusal has to SAY so.
 *
 * The guard was always right and always silent: a deliberate double-click that
 * produces nothing and explains nothing reads as a broken editor, while the
 * branch immediately above it ("The note would extend beyond this clip.") has
 * always spoken.
 *
 * The cell is taken from a note the fixture already has, by inverting the roll's
 * own geometry off that note's inline style — `left` is `(tick - leftTick) *
 * pxPerTick` and `top` is `(range.hi - pitch) * rowHeight`, and jsdom reports a
 * zero-origin field — so the aim is the note's own tick and pitch by
 * construction, not by pixel luck. The event goes to the FIELD, because a
 * double-click that lands ON a note opens the full surface instead.
 */
describe('PianoRoll — BC-30 refuses a duplicate, and says so', () => {
    let trackId: string;
    let clipId: string;

    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
        trackId = track.id!;
        clipId = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!.id!;
    });

    const renderRoll = () => render(<PianoRollLane trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
    const noteCount = () => {
        const arrangement = useArrangementStore.getState().arrangement!;
        const clip = arrangement.tracks.find((track) => track.id === trackId)!.clips.find((item) => item.id === clipId)!;
        const source = arrangement.sources![clip.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        return source.notes.length;
    };
    /** The centre of a cell an existing note already occupies. */
    const occupiedCell = (container: HTMLElement) => {
        const note = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]');
        expect(note, 'the fixture must render at least one note').not.toBeNull();
        const left = Number.parseFloat(note!.style.left);
        const top = Number.parseFloat(note!.style.top);
        const height = Number.parseFloat(note!.style.height) || 6;
        return { bubbles: true, clientX: left, clientY: top + height / 2 };
    };

    it('drawing on an occupied cell mints nothing, records nothing, and says why', () => {
        const { container } = renderRoll();
        const field = container.querySelector('.piano-roll__field')!;
        const cell = occupiedCell(container);
        const before = noteCount();
        expect(container.querySelector('.piano-roll__rejection'), 'nothing is being reported yet').toBeNull();

        act(() => { fireEvent.dblClick(field, cell); });

        expect(useHistoryStore.getState().cursor, 'a refused draw is not an edit').toBe(0);
        expect(noteCount(), 'and mints nothing').toBe(before);
        expect(container.querySelector('.piano-roll__rejection')?.textContent).toBe('That note is already there.');
    });

    it('reports without stealing focus, and clears itself', () => {
        vi.useFakeTimers();
        const { container } = renderRoll();
        const field = container.querySelector('.piano-roll__field')!;
        const focusBefore = document.activeElement;

        act(() => { fireEvent.dblClick(field, occupiedCell(container)); });

        const status = container.querySelector('.piano-roll__rejection')!;
        expect(status, 'the refusal is reported').not.toBeNull();
        expect(status.getAttribute('role'), 'a live region, never a dialog').toBe('status');
        expect(container.querySelector('[role="dialog"]'), 'no modal mid-set').toBeNull();
        expect(document.activeElement, 'nothing takes focus off the roll').toBe(focusBefore);

        act(() => { vi.advanceTimersByTime(1200); });
        expect(container.querySelector('.piano-roll__rejection'), 'the chip is transient').toBeNull();
    });

    it('erase the occupant and the identical cell draws — the guard is about duplicates only', () => {
        vi.useFakeTimers();
        const { container } = renderRoll();
        const field = container.querySelector('.piano-roll__field')!;
        const cell = occupiedCell(container);
        const occupant = container.querySelector<HTMLElement>('.piano-roll-note[data-note-id]')!.dataset.noteId!;

        act(() => { fireEvent.dblClick(field, cell); });
        expect(useHistoryStore.getState().cursor, 'refused: no edit').toBe(0);
        act(() => { vi.advanceTimersByTime(1200); });

        // Take the occupant away through the shared op, so the cell is provably
        // free rather than hopefully free.
        act(() => {
            const arrangement = useArrangementStore.getState().arrangement!;
            useArrangementStore.getState().apply(eraseNotes(arrangement, { noteIds: [occupant] }).verbs);
        });
        const afterErase = noteCount();

        act(() => { fireEvent.dblClick(field, cell); });

        expect(noteCount(), 'the same cell now draws').toBe(afterErase + 1);
        expect(container.querySelector('.piano-roll__rejection'), 'a successful draw says nothing').toBeNull();
    });
});

/**
 * W6-SHIP item 6 — the roll is ONE tab stop, not 128.
 *
 * Every note renders as a real `<button>`, which is right: notes are the primary
 * object of this editor and they carry excellent accessible names ("A3, tick 0,
 * duration 480, velocity 64"). But all of them were `tabIndex 0`, so the starter's
 * first clip put 128 tab stops on screen and tabbing INTO the roll cost one press
 * per note to get back out. That is worse in practice than the canvas ports being
 * unreachable: an unreachable control is merely absent, whereas the notes invite
 * the keyboard and then hold it.
 *
 * Roving tabindex is the standard answer for a composite widget and it is pinned
 * here at exactly the two things a player feels: one tab stop, and one press out.
 */
describe('PianoRoll roving tabindex', () => {
    let trackId: string;
    let clipId: string;

    beforeEach(() => {
        useArrangementStore.getState().setArrangement(buildPaperSketch());
        useHistoryStore.getState().clear();
        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
        const clip = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!;
        trackId = track.id!;
        clipId = clip.id!;
        // `PianoRollSurface` reads the `pianoroll` viewport (`mode === 'surface'`),
        // so that is the selection these tests have to speak to.
        useEditingContextStore.getState().setSelection('pianoroll', { noteIds: [] });
    });

    const notes = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLElement>('button.piano-roll-note')];

    it('renders many notes and exactly ONE of them tabbable', () => {
        const { container } = render(<PianoRollSurface trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
        const all = notes(container);
        // The trap needs a crowd to be a trap — assert the crowd is really there,
        // so a future change that renders one note cannot pass this vacuously.
        expect(all.length).toBeGreaterThan(20);
        expect(all.filter((note) => note.tabIndex === 0)).toHaveLength(1);
        expect(all.filter((note) => note.tabIndex === -1)).toHaveLength(all.length - 1);
    });

    it('leaves the roll in ONE press of Tab, from anywhere in the note field', () => {
        const { container } = render(<PianoRollSurface trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
        const all = notes(container);
        /*
         * A SPREAD, not all 128. Focusing every note re-renders the roll 128
         * times and took ~1.3s alone and over 5s under a full parallel run —
         * this test would have joined `KeybindingsPanel`'s flake for no extra
         * proof. The invariant is per-note and identical at every index, so
         * first / last / middle / a couple in between demonstrate it exactly as
         * well and in a twentieth of the time.
         */
        const sample = [0, 1, Math.floor(all.length / 3), Math.floor(all.length / 2), all.length - 2, all.length - 1]
            .filter((index, at, list) => index >= 0 && index < all.length && list.indexOf(index) === at)
            .map((index) => all[index]!);
        expect(sample.length).toBeGreaterThanOrEqual(5);
        // Whichever note the focus is on, the number of note tab stops still ahead
        // of it is zero — that is what "one press out" means mechanically.
        for (const note of sample) {
            act(() => note.focus());
            const stops = notes(container).filter((other) => other.tabIndex === 0);
            expect(stops).toHaveLength(1);
            expect(stops[0]).toBe(document.activeElement);
        }
    });

    it('moves the roving focus with the arrows when nothing is selected', () => {
        const { container } = render(<PianoRollSurface trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
        const first = notes(container).find((note) => note.tabIndex === 0)!;
        const firstId = first.dataset.noteId;
        act(() => first.focus());
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        const moved = notes(container).find((note) => note.tabIndex === 0)!;
        expect(moved.dataset.noteId).not.toBe(firstId);
    });

    it('does NOT touch the arrows when notes are selected — the edit grammar is unchanged', () => {
        const arrangement = useArrangementStore.getState().arrangement!;
        const clip = arrangement.tracks.find((item) => item.id === trackId)!.clips.find((item) => item.id === clipId)!;
        const source = arrangement.sources![clip.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        const selectedId = source.notes.find((note) => note.id)!.id!;
        useEditingContextStore.getState().setSelection('pianoroll', { noteIds: [selectedId] });

        const { container } = render(<PianoRollSurface trackId={trackId} clipId={clipId} pxPerTick={0.1} />);
        const target = container.querySelector<HTMLElement>(`[data-note-id="${selectedId}"]`)!;
        act(() => target.focus());
        const before = container.querySelector<HTMLElement>('button.piano-roll-note[tabindex="0"]')!.dataset.noteId;
        fireEvent.keyDown(target, { key: 'ArrowRight' });
        // With a selection live, ArrowRight belongs to `nudgeRight`. The roving
        // index must stay exactly where it is rather than racing the edit.
        expect(container.querySelector<HTMLElement>('button.piano-roll-note[tabindex="0"]')!.dataset.noteId).toBe(before);
    });
});
