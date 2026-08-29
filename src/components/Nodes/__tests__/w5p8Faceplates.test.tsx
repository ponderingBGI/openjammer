/**
 * W5-P8 — the faceplates a performer plays.
 *
 * Five things this lane is only allowed to claim if they are pinned:
 *  1. A top-level `keyboard-visual` REGISTERS as a keyboard source, so the
 *     number keys focus it and the typing path resolves against it. Its mode
 *     number is allocated once by `addNode` and never moves (the law itself is
 *     pinned in `store/__tests__/keyboardModes.test.ts`).
 *  2. Clicking one of its keys emits a note through the SAME
 *     `emitKeyboardSignal` seam as typing — the one the e2e bridge taps — and
 *     releases it exactly once, even when the pointer leaves the key.
 *  3. Its `Row 1…3` bundles resolve to real MIDI notes on a connected
 *     instrument (`resolveKeyboardNotes`), which is what makes
 *     `keyboard-visual → instrument → speaker` a rig and not a picture.
 *  4. The instrument picker is operable from the keyboard alone.
 *  5. Every MiniLab 3 control is the shared socket, carrying `data-port-type`.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useAudioStore } from '../../../store/audioStore';
import { useUIFeedbackStore } from '../../../store/uiFeedbackStore';
import { resolveKeyboardNotes } from '../../../audio/ojgraph';
import type { Connection, GraphNode } from '../../../engine/types';
import { NodeWrapper } from '../NodeWrapper';
import { keyboardModeOf } from '../../../store/keyboardModes';
import { placePopover } from '../popoverPlacement';

function resetGraph() {
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
    useCanvasStore.setState({
        isConnecting: false,
        connectingFrom: null,
        pendingDisconnect: null,
        hoverTarget: null,
    });
    useUIFeedbackStore.setState({ flashingNodes: new Set() });
    useAudioStore.setState({
        keyboardNumberMap: new Map(),
        activeKeys: new Set(),
        activeKeyboardId: null,
        currentMode: 1,
        controlDown: false,
    });
}

function addAndRender(type: Parameters<ReturnType<typeof useGraphStore.getState>['addNode']>[0]) {
    const nodeId = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(nodeId)!;
    const view = render(<NodeWrapper node={node} />);
    return { nodeId, node, ...view };
}

beforeEach(resetGraph);
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// ============================================================================

describe('keyboard-visual is a first-class playable keyboard', () => {
    it('registers as a keyboard source, so the number keys can focus it', () => {
        const { nodeId } = addAndRender('keyboard-visual');
        expect(useAudioStore.getState().keyboardNumberMap.get(2)).toBe(nodeId);

        act(() => useAudioStore.getState().setCurrentMode(2));
        expect(useAudioStore.getState().activeKeyboardId).toBe(nodeId);
    });

    it('costs nothing in the undo history — the number rides the node’s own add', () => {
        useHistoryStore.getState().clear();
        addAndRender('keyboard-visual');
        // `addNode` itself is not bracketed by this component; what matters is
        // that MOUNTING it does not add a second entry of its own.
        expect(useHistoryStore.getState().entries.length).toBeLessThanOrEqual(1);
    });

    it('shows the number it was allocated, and keeps showing it', () => {
        const graph = useGraphStore.getState();
        graph.addNode('keyboard', { x: 0, y: 0 });          // claims 2
        graph.addNode('keyboard', { x: 0, y: 0 });          // claims 3
        const visualId = graph.addNode('keyboard-visual', { x: 0, y: 0 });
        const { container } = (() => {
            const node = useGraphStore.getState().nodes.get(visualId)!;
            return render(<NodeWrapper node={node} />);
        })();

        expect(keyboardModeOf(useGraphStore.getState().nodes.get(visualId))).toBe(4);
        expect(container.querySelector('.oj-node__type')?.textContent).toBe('MODE 4');
        expect(useAudioStore.getState().keyboardNumberMap.get(4)).toBe(visualId);
    });

    it('does NOT register the mirror inside a keyboard container', () => {
        const parentId = useGraphStore.getState().addNode('keyboard', { x: 0, y: 0 });
        const nodes = useGraphStore.getState().nodes;
        const mirror = [...nodes.values()].find(
            (n) => n.type === 'keyboard-visual' && n.parentId === parentId,
        );
        expect(mirror, 'a keyboard mints a keyboard-visual mirror').toBeDefined();
        // The parent claimed 2; the mirror must not fight it for a number.
        expect(useAudioStore.getState().keyboardNumberMap.get(2)).toBeUndefined();
        render(<NodeWrapper node={mirror!} />);
        expect(useAudioStore.getState().keyboardNumberMap.get(2)).toBeUndefined();
    });

    it('emits a note on key press and releases it exactly once', () => {
        const on = vi.fn();
        const off = vi.fn();
        useAudioStore.setState({ emitKeyboardSignal: on, releaseKeyboardSignal: off });

        const { nodeId, container } = addAndRender('keyboard-visual');
        // The whole tile is the playable face — there is no per-key socket to
        // aim at any more, so the key is found the way a player finds it.
        const tile = container.querySelector<HTMLButtonElement>('[aria-label="Row 2, key D"]')!;

        fireEvent.pointerDown(tile, { button: 0, pointerId: 1 });
        expect(on).toHaveBeenCalledWith(nodeId, 2, 2); // row 2 (A-L), index 2 (D)

        fireEvent.pointerUp(tile, { button: 0, pointerId: 1 });
        expect(off).toHaveBeenCalledTimes(1);
        expect(off).toHaveBeenCalledWith(nodeId, 2, 2);

        // A second release (pointer leaves after the up) must not double-fire.
        fireEvent.pointerLeave(tile, { pointerId: 1 });
        expect(off).toHaveBeenCalledTimes(1);
    });

    it('advertises NO per-key port — the keys play, the ROW socket patches', () => {
        const { node, container } = addAndRender('keyboard-visual');

        // The registry offers four sockets and no key ports: a per-key cable
        // connected, drew a socket and routed nothing, because no note path in
        // the app resolves one.
        expect(node.ports.map((p) => p.id).sort()).toEqual(['pedal', 'row-1', 'row-2', 'row-3']);
        expect(container.querySelector('[data-port-id^="key-"]'), 'no key well is drawn').toBeNull();
        // Every marker the faceplate DOES draw is a port the node really has.
        for (const marker of container.querySelectorAll('[data-port-id]')) {
            const portId = marker.getAttribute('data-port-id')!;
            expect(node.ports.some((p) => p.id === portId), `${portId} is not advertised`).toBe(true);
        }
    });

    it('keeps the per-key wells on the MIRROR, where they are really wired', () => {
        const parentId = useGraphStore.getState().addNode('keyboard', { x: 0, y: 0 });
        const nodes = useGraphStore.getState().nodes;
        const mirror = [...nodes.values()].find(
            (n) => n.type === 'keyboard-visual' && n.parentId === parentId,
        )!;
        const { container } = render(<NodeWrapper node={mirror} />);

        const well = container.querySelector<HTMLElement>('.oj-key-tile__port[data-port-id="key-q"]')!;
        expect(well, 'the mirror’s key ports feed the container’s output panel').not.toBeNull();

        const on = vi.fn();
        useAudioStore.setState({ emitKeyboardSignal: on });
        fireEvent.pointerDown(well, { button: 0, pointerId: 1 });
        expect(on).not.toHaveBeenCalled();
        expect(useCanvasStore.getState().isConnecting).toBe(true);
    });

    it('routes Row 1 to a connected instrument as a real MIDI note', () => {
        const graph = useGraphStore.getState();
        const keyboardId = graph.addNode('keyboard-visual', { x: 0, y: 0 });
        const instrumentId = graph.addNode('keys', { x: 400, y: 0 });

        const nodes = useGraphStore.getState().nodes;
        const keyboard = nodes.get(keyboardId)!;
        expect(
            keyboard.ports.some((p) => p.id === 'row-1' && p.name === 'Row 1'),
            'a playable visual keyboard advertises its row bundles',
        ).toBe(true);
        expect(keyboard.ports.some((p) => p.id === 'pedal')).toBe(true);

        const connection: Connection = {
            id: 'c1',
            sourceNodeId: keyboardId,
            sourcePortId: 'row-1',
            targetNodeId: instrumentId,
            targetPortId: 'input-1',
            type: 'control',
        };
        const notes = resolveKeyboardNotes(
            keyboardId,
            1,
            3,
            0.8,
            nodes as Map<string, GraphNode>,
            new Map([[connection.id, connection]]),
        );
        expect(notes).toHaveLength(1);
        expect(notes[0].targetNodeId).toBe(instrumentId);
        // Row 1 defaults to octave 5 (the rows split 5/4/3), so key index 3 is D#5.
        expect(notes[0].midiNote).toBe(75);
    });
});

// ============================================================================

describe('the instrument picker is operable from the keyboard', () => {
    it('opens from the header button, walks with Arrow keys, and closes on Escape', () => {
        const { container } = addAndRender('keys');

        const name = container.querySelector<HTMLButtonElement>('.inst-name')!;
        expect(name.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(name);
        expect(name.getAttribute('aria-expanded')).toBe('true');

        const search = container.querySelector<HTMLInputElement>('.inst-picker__search')!;
        expect(document.activeElement).toBe(search);

        // ArrowDown out of the field lands on the first row…
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        const items = [...container.querySelectorAll<HTMLElement>('.oj-menu-item')];
        expect(items.length).toBeGreaterThan(1);
        expect(document.activeElement).toBe(items[0]);

        // …and the Menu's own roving focus takes it from there.
        fireEvent.keyDown(items[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);

        fireEvent.keyDown(items[1], { key: 'Escape' });
        expect(container.querySelector('.inst-picker')).toBeNull();
    });

    it('flips ABOVE the card when the node sits low on the canvas', () => {
        // A 1050px viewport with the instrument at y ~1000: the menu measures
        // 360px, so opening downwards puts the WHOLE list below the fold — the
        // regression this pins. Nothing else can be mocked here: jsdom has no
        // layout, so the rects are supplied.
        const { container } = addAndRender('keys');
        const anchor = container.querySelector<HTMLElement>('.inst-anchor')!;
        const [w, h] = [window.innerWidth, window.innerHeight];
        onTestFinished(() => { window.innerWidth = w; window.innerHeight = h; });
        window.innerHeight = 1050;
        window.innerWidth = 1400;
        anchor.getBoundingClientRect = () => rect({ top: 1000, height: 20, left: 300, width: 232 });

        fireEvent.click(container.querySelector<HTMLButtonElement>('.inst-name')!);
        const picker = container.querySelector<HTMLElement>('.inst-picker')!;
        picker.getBoundingClientRect = () => rect({ top: 1026, height: 360, left: 300, width: 320 });
        // Re-measure with the picker's own rect in place (the open above ran
        // before the element existed to be mocked).
        act(() => { window.dispatchEvent(new Event('resize')); });

        expect(picker.dataset.flipped).toBe('true');
        // Local (anchor-relative) offset: 1000 - 6 - 360 = 634 in viewport space.
        expect(picker.style.top).toBe('-366px');
        expect(parseFloat(picker.style.maxHeight)).toBeLessThanOrEqual(360);

        // …and the whole menu is now inside the viewport.
        const top = 1000 + parseFloat(picker.style.top);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top + parseFloat(picker.style.maxHeight)).toBeLessThanOrEqual(1050);
    });

    it('selects a voice with Enter', () => {
        const { nodeId, container } = addAndRender('keys');
        fireEvent.click(container.querySelector<HTMLButtonElement>('.inst-name')!);
        const first = container.querySelector<HTMLElement>('.oj-menu-item')!;
        fireEvent.keyDown(first, { key: 'Enter' });

        const data = useGraphStore.getState().nodes.get(nodeId)!.data as { instrumentId?: string };
        expect(typeof data.instrumentId).toBe('string');
        expect(container.querySelector('.inst-picker')).toBeNull();
    });
});

// ============================================================================

describe('the MiniLab 3 panel is on the shared socket', () => {
    it('gives every advertised control a well with data-port-type', () => {
        const { nodeId, node, container } = addAndRender('minilab3-visual');
        expect(node.ports.length).toBeGreaterThan(30);

        for (const port of node.ports) {
            const marker = container.querySelector(
                `[data-node-id="${CSS.escape(nodeId)}"][data-port-id="${CSS.escape(port.id)}"]`,
            );
            expect(marker, `no marker for ${port.id}`).not.toBeNull();
            expect(marker!.classList.contains('oj-port'), `${port.id} is not a shared well`).toBe(true);
            expect(marker!.getAttribute('data-port-type')).toBe(port.type);
        }
    });

    it('draws its keys and pads as KeyTiles, not bare divs', () => {
        const { container } = addAndRender('minilab3-visual');
        expect(container.querySelectorAll('.minilab3-key.oj-key-tile').length).toBe(25);
        expect(container.querySelectorAll('.minilab3-pad.oj-key-tile').length).toBe(8);
        expect(container.querySelector('.minilab3-key-port'), 'the bare div marker is gone').toBeNull();
    });
});

// ============================================================================

function rect({ top, height, left, width }: { top: number; height: number; left: number; width: number }): DOMRect {
    return {
        top, height, left, width,
        bottom: top + height, right: left + width, x: left, y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

describe('placePopover keeps an anchored menu on screen', () => {
    const viewport = { width: 1400, height: 1050 };
    const size = { width: 320, height: 360 };

    it('opens BELOW when there is room, aligned with the card', () => {
        const placed = placePopover(rect({ top: 100, height: 20, left: 300, width: 232 }), size, viewport);
        expect(placed.flipped).toBe(false);
        expect(placed.top).toBe(126);
        expect(placed.left).toBe(300);
        expect(placed.maxHeight).toBe(360);
    });

    it('flips ABOVE when the card is low, and stays fully on screen', () => {
        const placed = placePopover(rect({ top: 1000, height: 20, left: 300, width: 232 }), size, viewport);
        expect(placed.flipped).toBe(true);
        expect(placed.top).toBe(634);
        expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(viewport.height);
    });

    it('caps the height when NEITHER side can hold the whole menu', () => {
        const placed = placePopover(rect({ top: 500, height: 20, left: 0, width: 232 }), size, { width: 1400, height: 600 });
        expect(placed.top).toBeGreaterThanOrEqual(8);
        expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(600);
        expect(placed.maxHeight).toBeGreaterThan(0);
    });

    it('right-aligns rather than running off the right edge', () => {
        const placed = placePopover(rect({ top: 100, height: 20, left: 1300, width: 232 }), size, viewport);
        expect(placed.left + size.width).toBeLessThanOrEqual(viewport.width);
        expect(placed.left).toBeGreaterThanOrEqual(8);
    });

    it('clamps a menu wider than the viewport to the padded edge', () => {
        const placed = placePopover(rect({ top: 100, height: 20, left: 40, width: 232 }), { width: 900, height: 200 }, { width: 500, height: 1050 });
        expect(placed.left).toBe(8);
    });
});
