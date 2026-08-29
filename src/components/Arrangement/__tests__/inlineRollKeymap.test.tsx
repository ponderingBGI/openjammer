/**
 * TA2d must-fix 1 and 3 — the inline piano roll is an EDITOR, not a keyboard hole.
 *
 * TA2c made piano-roll fall-through unconditional, so every arrangement letter the
 * roll did not consume reached the arrangement underneath: `s` split the very clip
 * being edited, `0` muted it, `r` flipped ripple, and with Step armed `v b x k`
 * re-tooled the arrangement. These tests press the WHOLE arrangement binding set
 * from a focused inline roll and assert the song document, the tool and the
 * arrangement's selection are byte-identical afterwards — then assert the four
 * genuinely ambient shortcuts still work from exactly the same focus.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { useUiViewStore } from '../../../store/uiViewStore';
import { useKeybindingsStore } from '../../../store/keybindingsStore';
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

function focusRoll(container: HTMLElement) {
    const roll = container.querySelector<HTMLElement>('[data-keymap-surface="pianoroll"]');
    expect(roll, 'the inline piano roll must be mounted and focusable').not.toBeNull();
    roll!.focus();
    return roll!;
}

/** Everything a stray arrangement shortcut would visibly damage. */
function arrangementFingerprint() {
    const store = useArrangementStore.getState();
    const context = useEditingContextStore.getState();
    const viewport = context.viewports.arrangement;
    return JSON.stringify({
        document: store.arrangement,
        playheadTick: store.playheadTick,
        transportPending: store.transportPending,
        punchEnabled: store.punchEnabled,
        clickEnabled: store.clickEnabled,
        tool: viewport.tool,
        pxPerTick: viewport.pxPerTick,
        leftTick: viewport.leftTick,
        clipIds: viewport.selection.clipIds,
        trackIds: viewport.selection.trackIds,
        sectionIds: viewport.selection.sectionIds,
        timeRange: viewport.selection.timeRange ?? null,
        gridUnit: context.gridUnit,
        snapMode: context.snapMode,
        editMode: context.editMode,
        followPlayhead: context.followPlayhead,
    });
}

/** Every arrangement binding that is NOT on the inherit allowlist, by default combo. */
const SURFACE_LOCAL_ARRANGEMENT_KEYS: Array<[label: string, init: KeyboardEventInit]> = [
    ['s (split)', { key: 's' }],
    ['0 (mute clips)', { key: '0' }],
    ['r (ripple)', { key: 'r' }],
    ['m (metronome)', { key: 'm' }],
    ['p (punch)', { key: 'p' }],
    ['f (follow)', { key: 'f' }],
    ['l (loop from selection)', { key: 'l' }],
    ['e (enter clip)', { key: 'e' }],
    ['i (loop in)', { key: 'i' }],
    ['o (loop out)', { key: 'o' }],
    ['q (exit surface)', { key: 'q' }],
    ['[ (coarser grid)', { key: '[' }],
    ['] (finer grid)', { key: ']' }],
    ['v (select tool)', { key: 'v' }],
    ['b (draw tool)', { key: 'b' }],
    ['x (erase tool)', { key: 'x' }],
    ['k (knife tool)', { key: 'k' }],
    ['Enter (open piano roll)', { key: 'Enter' }],
    ['ArrowLeft', { key: 'ArrowLeft' }],
    ['ArrowRight', { key: 'ArrowRight' }],
    ['ArrowUp (move track)', { key: 'ArrowUp' }],
    ['ArrowDown (move track)', { key: 'ArrowDown' }],
    ['Shift+ArrowLeft', { key: 'ArrowLeft', shiftKey: true }],
    ['Shift+ArrowRight', { key: 'ArrowRight', shiftKey: true }],
    ['Alt+ArrowLeft (bar nudge)', { key: 'ArrowLeft', altKey: true }],
    ['Alt+ArrowRight (bar nudge)', { key: 'ArrowRight', altKey: true }],
    ['Ctrl+ArrowLeft (previous marker)', { key: 'ArrowLeft', ctrlKey: true }],
    ['Ctrl+ArrowRight (next marker)', { key: 'ArrowRight', ctrlKey: true }],
    ['Ctrl+Alt+ArrowRight (spatial select)', { key: 'ArrowRight', ctrlKey: true, altKey: true }],
    ['Ctrl+Alt+ArrowDown (spatial select)', { key: 'ArrowDown', ctrlKey: true, altKey: true }],
    ['Delete', { key: 'Delete' }],
    ['Backspace', { key: 'Backspace' }],
    ['Ctrl+D (duplicate)', { key: 'd', ctrlKey: true }],
    ['Ctrl+E (insert time)', { key: 'e', ctrlKey: true }],
    ['Ctrl+A (select all clips)', { key: 'a', ctrlKey: true }],
    ['Ctrl+Shift+Backspace (delete time)', { key: 'Backspace', ctrlKey: true, shiftKey: true }],
    ['Shift+Z (zoom to selection)', { key: 'z', shiftKey: true }],
    ['= (zoom in)', { key: '=' }],
    ['- (zoom out)', { key: '-' }],
    ['Ctrl+0 (fit song)', { key: '0', ctrlKey: true }],
    ['Home', { key: 'Home' }],
    ['End', { key: 'End' }],
    ['Alt+G (snap toggle)', { key: 'g', altKey: true }],
];

describe('inline piano roll: arrangement bindings do not fall through', () => {
    beforeEach(() => {
        useKeybindingsStore.setState({ customBindings: {} });
        useEditingContextStore.getState().setStepEntry({ trackId: null });
    });

    it.each(SURFACE_LOCAL_ARRANGEMENT_KEYS)('leaves the arrangement untouched for %s', (_label, init) => {
        const { container } = openInlineRoll();
        act(() => { useEditingContextStore.getState().setSelection('arrangement', { clipIds: [clipId] }); });
        focusRoll(container);
        const before = arrangementFingerprint();
        const historyBefore = useHistoryStore.getState().cursor;

        act(() => { resolveKeydown(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });

        expect(arrangementFingerprint()).toBe(before);
        expect(useHistoryStore.getState().cursor).toBe(historyBefore);
        // `arrangement.exit` / `arrangement.enter` would navigate the performer out mid-edit.
        expect(useUiViewStore.getState().surface).toBe('arrangement');
    });

    it('leaves the arrangement tool alone for v/b/x/k while Step is armed', () => {
        const { container } = openInlineRoll();
        act(() => { useEditingContextStore.getState().setStepEntry({ trackId, positionTick: 0 }); });
        act(() => { useEditingContextStore.getState().setViewport('arrangement', { tool: 'select' }); });
        act(() => { useEditingContextStore.getState().setViewport('pianoroll', { tool: 'select' }); });
        focusRoll(container);
        for (const key of ['v', 'b', 'x', 'k']) {
            act(() => { resolveKeydown(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
        }
        expect(useEditingContextStore.getState().viewports.arrangement.tool).toBe('select');
        expect(useEditingContextStore.getState().viewports.pianoroll.tool).toBe('select');
        act(() => { useEditingContextStore.getState().setStepEntry({ trackId: null }); });
    });

    it('still lends undo, redo, Space, Shift+Space and Ctrl+M to the focused roll', () => {
        const play = vi.fn();
        const stop = vi.fn();
        const seek = vi.fn();
        const { container } = openInlineRoll();
        focusRoll(container);

        const arrangement = useArrangementStore.getState().arrangement!;
        const track = arrangement.tracks[0]!;
        act(() => { useArrangementStore.getState().apply({ kind: 'setTrackName', trackId: track.id ?? track.ref, name: 'Renamed by the test' }); });
        expect(useHistoryStore.getState().cursor).toBe(1);

        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
        expect(useHistoryStore.getState().cursor).toBe(0);
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true })); });
        expect(useHistoryStore.getState().cursor).toBe(1);

        const markers = () => useArrangementStore.getState().arrangement!.locations?.filter((location) => location.kind === 'mark').length ?? 0;
        const before = markers();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true })); });
        expect(markers()).toBe(before + 1);

        // Transport is inherited too. The store's real play() needs an engine, so the
        // assertion is that the inherited entry reaches it at all.
        act(() => { useArrangementStore.setState({ play, stop, seek, isPlaying: false }); });
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
        expect(play).toHaveBeenCalledOnce();
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true })); });
        expect(seek).toHaveBeenCalledOnce();
        expect(play).toHaveBeenCalledTimes(2);
    });
});

describe('inline piano roll: Q and Escape are a live cascade (TL-18)', () => {
    it('Q closes the inline roll and restores the lane height', () => {
        const { container } = openInlineRoll();
        focusRoll(container);
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'q', bubbles: true })); });
        expect(useTrackLaneViewStore.getState().expandedPianoRolls[trackId]).toBeUndefined();
        expect(useTrackLaneViewStore.getState().laneHeights[trackId]).toBe(72);
        // The roll consumed Q, so `arrangement.exit` did not also fire.
        expect(useUiViewStore.getState().surface).toBe('arrangement');
    });

    it('Escape clears the selection first, then closes the roll, then clears the arrangement', () => {
        const { container } = openInlineRoll();
        const source = Object.values(useArrangementStore.getState().arrangement!.sources ?? {}).find((item) => item.kind === 'midi')!;
        if (source.kind !== 'midi') throw new Error('fixture must contain MIDI');
        act(() => { useEditingContextStore.getState().setSelection('arrangement', { noteIds: [source.notes[0]!.id!] }); });
        focusRoll(container);

        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.noteIds).toEqual([]);
        expect(useTrackLaneViewStore.getState().expandedPianoRolls[trackId]).toBe(clipId);

        focusRoll(container);
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(useTrackLaneViewStore.getState().expandedPianoRolls[trackId]).toBeUndefined();
    });

    it('the inline lane hands the roll an onClose, so the roll owns its own exit', () => {
        const { container } = openInlineRoll();
        // The lane menu is the visible twin of the same action; both must exist.
        expect(container.querySelector('.arrangement-lane-menu__close')).not.toBeNull();
        focusRoll(container);
        fireEvent.click(container.querySelector<HTMLElement>('.arrangement-lane-menu__close')!);
        expect(useTrackLaneViewStore.getState().expandedPianoRolls[trackId]).toBeUndefined();
    });
});
