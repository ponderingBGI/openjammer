/**
 * W6-T / F2 — §4's level grammar is reachable on the canvas in every mode.
 *
 * `E` goes in, `Q` comes out. On the canvas both used to sit inside a
 * `currentMode === 1` gate, and their binding entries sat AFTER the
 * computer-keyboard note row (`ROW_KEYS[1]` is `q w e r t y u i o p`) in the same
 * binding set. Installing a rig selects that rig's keyboard mode so typing plays
 * straight away — and every preset rig that carries a Song also carries a
 * keyboard — so from the first second of a first run `E` over a selected Song
 * node was a note and the arrangement was unreachable by key (W6-E2E finding F2).
 *
 * The fix is an ORDER plus a fall-through, and both halves need pinning: the
 * level grammar wins when it has somewhere to go, and the note row still gets
 * every key it did before when it does not. The second half is real playing, so
 * it is asserted through `emitKeyboardSignal` — the same call a pressed letter
 * makes on its way to the engine.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCanvas } from '../Canvas/NodeCanvas';
import { useAudioStore } from '../../store/audioStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { useGraphStore } from '../../store/graphStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { resolveKeydown } from '../../keymap/arbiter';

beforeAll(() => {
    class TestResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(cleanup);

const notes = vi.fn();

/** A keyboard mode is live and a keyboard is assigned — the first-run state. */
function armKeyboardMode() {
    useAudioStore.setState({ currentMode: 2, activeKeyboardId: 'kb-1', emitKeyboardSignal: notes, releaseKeyboardSignal: vi.fn() });
}

/** A real keydown is cancelable — `preventDefault` on anything else is a no-op. */
function press(key: string) {
    act(() => { resolveKeydown(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

describe('W6-T F2 — canvas level grammar vs the note row', () => {
    beforeEach(() => {
        notes.mockClear();
        localStorage.clear();
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useHistoryStore.getState().clear();
        useCanvasNavigationStore.setState({ currentViewNodeId: null, rootViewState: null, viewStates: new Map() });
        useUiViewStore.getState().setSurface('canvas');
        armKeyboardMode();
    });

    it('E over a selected Song node opens the arrangement, even in a keyboard mode', () => {
        render(<NodeCanvas />);
        let songId = '';
        act(() => { songId = useGraphStore.getState().addNode('song', { x: 0, y: 0 }); });
        act(() => { useGraphStore.getState().selectNodes([songId]); });

        press('e');

        expect(useUiViewStore.getState().surface, 'the fourth rung of the ladder must be reachable').toBe('arrangement');
        expect(notes, 'and the key must not also have played a note').not.toHaveBeenCalled();
    });

    it('E with nothing selected is still the note E — the row is the fall-through', () => {
        render(<NodeCanvas />);
        act(() => { useGraphStore.getState().addNode('song', { x: 0, y: 0 }); });
        act(() => { useGraphStore.getState().clearSelection(); });

        press('e');

        expect(useUiViewStore.getState().surface, 'nothing to enter, so nothing moves').toBe('canvas');
        // ROW_KEYS[1] = q w e r t y u i o p → `e` is row 1, index 2.
        expect(notes).toHaveBeenCalledWith('kb-1', 1, 2);
    });

    it('Q at the root is still the note Q, and Q inside a node exits the level', () => {
        render(<NodeCanvas />);
        press('q');
        expect(notes, 'at the root there is nowhere to go, so Q plays').toHaveBeenCalledWith('kb-1', 1, 0);

        notes.mockClear();
        act(() => { useCanvasNavigationStore.setState({ currentViewNodeId: 'container-1' }); });
        press('q');
        expect(useCanvasNavigationStore.getState().currentViewNodeId, 'inside a node Q comes back out').toBeNull();
        expect(notes, 'and does not also play').not.toHaveBeenCalled();
    });

    it('a node with nothing to enter leaves the key to the note row', () => {
        render(<NodeCanvas />);
        // A speaker has no inner canvas: entering it is not a thing, so `E` must
        // stay a note rather than spending the key on a flash.
        let speakerId = '';
        act(() => { speakerId = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 }); });
        act(() => { useGraphStore.getState().selectNodes([speakerId]); });

        press('e');

        expect(useUiViewStore.getState().surface).toBe('canvas');
        expect(notes).toHaveBeenCalledWith('kb-1', 1, 2);
    });

    it('config mode is unchanged: E and Q belong to the canvas, notes do not exist', () => {
        useAudioStore.setState({ currentMode: 1, activeKeyboardId: null });
        render(<NodeCanvas />);
        let songId = '';
        act(() => { songId = useGraphStore.getState().addNode('song', { x: 0, y: 0 }); });
        act(() => { useGraphStore.getState().selectNodes([songId]); });

        press('e');
        expect(useUiViewStore.getState().surface).toBe('arrangement');
        expect(notes).not.toHaveBeenCalled();
    });
});
