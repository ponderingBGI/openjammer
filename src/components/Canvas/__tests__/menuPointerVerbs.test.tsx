/**
 * 1C-01 — the context menu's edit verbs must work under a real POINTER.
 *
 * HA-26 exists because "delete, copy, paste, duplicate and select-all have no
 * pointer route anywhere in the app". The lane gave each of them a menu row, and
 * the gate measured that **clicking Delete, Duplicate or Copy still did nothing**:
 * `ContextMenu`'s host is portalled to `document.body` but is a React *child* of
 * the `.node-canvas` div, so React bubbled a row's `mousedown` into
 * `NodeCanvas.handleMouseDown`, which saw a target that is neither a node nor a
 * port, cleared the selection and started a marquee — before the row's `onSelect`
 * fired on click. Every verb that reads the prior selection was a silent no-op.
 * `Select all`, `Paste` and the adds "worked" only because none of them reads it.
 *
 * The lane's own unit test passed straight through that, because it called
 * `onSelect` directly and never sent the canvas a `mousedown`. So this file
 * renders the WHOLE canvas, opens the menu with a real right-click, and drives
 * the rows with real bubbling pointer events — the only shape of test that can
 * catch this class of bug in jsdom. (`.scratch/ux-1c/f1-menu-verbs.mjs` does the
 * same thing in a real browser; both are kept, because the browser check is the
 * proof and this one is the tripwire.)
 */

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCanvas } from '../NodeCanvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { DESKTOP_CAPABILITIES } from '../../../engine/capabilities';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        subscribeSignalLevels: () => () => {},
        // `buildMenuCtx` reads the capability seam to gate the add actions.
        getCapabilities: () => DESKTOP_CAPABILITIES,
    }),
}));

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

/**
 * How many CARDS sit on the canvas.
 *
 * Not `nodes.size`: an `effect` arrives with its own internal nodes (three in
 * total), so counting the raw map measures the wrong thing and would move if a
 * faceplate's insides ever changed. Cards are what the player deletes.
 */
function cards(): number {
    return [...useGraphStore.getState().nodes.values()].filter((node) => (node.parentId ?? null) === null).length;
}

/** The menu row whose label is exactly `label`, in the ROOT panel. */
function row(label: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>('.context-menu > .oj-menu-item'))
        .find((el) => el.querySelector('.oj-menu-item__label')?.textContent?.trim() === label);
    if (!found) throw new Error(`no menu row "${label}"`);
    return found;
}

/**
 * A real pointer press on a row: `mousedown` (which is what leaked into the
 * canvas), then `mouseup`, then `click`. Every one bubbles, exactly as a browser
 * sends them.
 */
function pressRow(label: string) {
    const el = row(label);
    act(() => {
        fireEvent.mouseDown(el, { button: 0, bubbles: true });
        fireEvent.mouseUp(el, { button: 0, bubbles: true });
        fireEvent.click(el, { button: 0, bubbles: true });
    });
}

/** Right-click the canvas at a point, the way `NodeCanvas` expects. */
function openMenu(canvas: HTMLElement, at = { x: 400, y: 400 }) {
    // Two separate `act`s on purpose: the press stores the point in React state
    // and the release reads it, so they cannot share a batch.
    act(() => { fireEvent.mouseDown(canvas, { button: 2, clientX: at.x, clientY: at.y }); });
    act(() => { fireEvent.mouseUp(canvas, { button: 2, clientX: at.x, clientY: at.y }); });
}

describe('context menu — the pointer route (1C-01)', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useHistoryStore.getState().clear();
        useCanvasStore.getState().resetView();
    });

    afterEach(() => vi.unstubAllGlobals());

    function twoCards() {
        const graph = useGraphStore.getState();
        const a = graph.addNode('effect', { x: 0, y: 0 });
        const b = graph.addNode('effect', { x: 400, y: 0 });
        const { container } = render(<NodeCanvas />);
        return { a, b, canvas: container.querySelector<HTMLElement>('.node-canvas')! };
    }

    it('a mousedown on a menu row does NOT reach the canvas and clear the selection', () => {
        const { a, canvas } = twoCards();
        act(() => useGraphStore.getState().selectNode(a));
        expect(useGraphStore.getState().selectedNodeIds.size).toBe(1);

        openMenu(canvas);
        act(() => { fireEvent.mouseDown(row('Copy'), { button: 0, bubbles: true }); });

        // The measured failure: selection emptied before the row could act.
        expect([...useGraphStore.getState().selectedNodeIds]).toEqual([a]);
        expect(useCanvasStore.getState().isDragging).toBe(false);
    });

    it('Delete removes the selected card', () => {
        const { a, canvas } = twoCards();
        act(() => useGraphStore.getState().selectNode(a));

        openMenu(canvas);
        pressRow('Delete');

        expect(useGraphStore.getState().nodes.has(a)).toBe(false);
        expect(cards()).toBe(1);
    });

    it('Duplicate makes a second card', () => {
        const { a, canvas } = twoCards();
        act(() => useGraphStore.getState().selectNode(a));

        openMenu(canvas);
        pressRow('Duplicate');

        expect(cards()).toBe(3);
    });

    it('Copy then Paste makes a third card', () => {
        const { a, canvas } = twoCards();
        act(() => useGraphStore.getState().selectNode(a));

        openMenu(canvas);
        pressRow('Copy');
        expect(useGraphStore.getState().clipboard).not.toBeNull();

        openMenu(canvas);
        pressRow('Paste');
        expect(cards()).toBe(3);
    });

    it('Select all selects every card at this level', () => {
        const { canvas } = twoCards();
        act(() => useGraphStore.getState().clearSelection());

        openMenu(canvas);
        pressRow('Select all');

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
    });
});
