/**
 * HA-22 and HA-20 — one tool strip at a time, and a live region that is empty
 * at rest.
 *
 * HA-22: two `V B X` groups were on screen at once, both labelled "Tool",
 * meaning different things — and one of them was dead (HA-13). The strips are
 * now mutually exclusive by construction (the roll SURFACE drops the ruler's
 * corner strip; the inline lane has no toolbar of its own) and the one that IS
 * on screen names its scope.
 *
 * HA-20: the recording region rendered "Recording stopped" unconditionally, in
 * an ASSERTIVE region, so entering the Song on a document that had never
 * recorded interrupted a screen-reader user with a false event — and a real stop
 * could never announce, because the words were already there.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArrangementSurface } from '../ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';
import { useEditingContextStore } from '../../../store/editingContextStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useTrackLaneViewStore } from '../../../store/trackLaneViewStore';
import { useUiViewStore } from '../../../store/uiViewStore';
import { buildPaperSketch } from '../../../song/songs/paperSketch';

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

function mountSong({ rollOpen }: { rollOpen: boolean }) {
    useArrangementStore.getState().setArrangement(buildPaperSketch());
    useHistoryStore.getState().clear();
    const arrangement = useArrangementStore.getState().arrangement!;
    const track = arrangement.tracks.find((item) => item.clips.some((clip) => arrangement.sources?.[clip.sourceId]?.kind === 'midi'))!;
    trackId = track.id ?? track.ref;
    clipId = track.clips.find((item) => arrangement.sources?.[item.sourceId]?.kind === 'midi')!.id!;
    useTrackLaneViewStore.setState({
        expandedPianoRolls: rollOpen ? { [trackId]: clipId } : {},
        laneHeights: rollOpen ? { [trackId]: 220 } : {},
        previousLaneHeights: {},
        automationLaneByTrack: {},
        headerWidth: 200,
        mixerOpen: false,
    });
    useUiViewStore.getState().setSurface('arrangement');
    return render(<ArrangementSurface active songNodeId="song-1" />);
}

/** Every tool segmented-control on screen, by its accessible name. */
const toolGroups = (container: HTMLElement) =>
    [...container.querySelectorAll('[role="group"]')]
        .map((element) => element.getAttribute('aria-label') ?? '')
        .filter((label) => label.startsWith('Tool'));

describe('HA-22 — one tool strip, and it says whose', () => {
    beforeEach(() => {
        useEditingContextStore.getState().setViewport('arrangement', { tool: 'select' });
    });

    it('shows exactly one scope-named strip on the Song', () => {
        const { container } = mountSong({ rollOpen: false });
        expect(toolGroups(container)).toEqual(['Tool — Song']);
    });

    it('still shows exactly one with the inline roll open', () => {
        const { container } = mountSong({ rollOpen: true });
        expect(container.querySelector('.piano-roll--inline')).not.toBeNull();
        expect(toolGroups(container)).toEqual(['Tool — Song']);
    });

    it('offers every tool that has a binding — Knife included (HA-13)', () => {
        const { container } = mountSong({ rollOpen: false });
        const strip = container.querySelector('.arrangement-tool')!;
        expect([...strip.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')))
            .toEqual(['Select tool', 'Draw tool', 'Erase tool', 'Knife tool']);
    });

    it('arms the tool it names when pressed', () => {
        const { container } = mountSong({ rollOpen: false });
        const knife = container.querySelector<HTMLButtonElement>('.arrangement-tool button:last-of-type')!;
        act(() => { knife.click(); });
        expect(useEditingContextStore.getState().viewports.arrangement.tool).toBe('knife');
        expect(knife.getAttribute('aria-pressed')).toBe('true');
    });
});

describe('HA-20 — the recording live region is empty at rest', () => {
    it('says nothing on a document that has never recorded', () => {
        const { container } = mountSong({ rollOpen: false });
        const region = container.querySelector('.arrangement-record-live')!;
        expect(region.textContent).toBe('');
        // A status, not an alert: a take starting is not worth cutting across
        // whatever the player is having read to them.
        expect(region.getAttribute('aria-live')).toBe('polite');
    });

    it('writes only on a transition, and says the transition it saw', async () => {
        const { container } = mountSong({ rollOpen: false });
        const region = () => container.querySelector('.arrangement-record-live')!;

        act(() => { useArrangementStore.setState({ isRecording: true }); });
        await waitFor(() => expect(region().textContent).toBe('Recording started'));

        act(() => { useArrangementStore.setState({ isRecording: false }); });
        await waitFor(() => expect(region().textContent).toBe('Recording stopped'));
    });
});
