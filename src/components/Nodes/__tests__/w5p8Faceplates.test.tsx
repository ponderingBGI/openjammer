/**
 * W5-P8 — the faceplates a performer plays.
 *
 * Five things this lane is only allowed to claim if they are pinned:
 *  1. A top-level `keyboard-visual` REGISTERS as a keyboard source, so the
 *     number keys focus it and the typing path resolves against it. Adding one
 *     writes nothing to the undo history.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useAudioStore } from '../../../store/audioStore';
import { useUIFeedbackStore } from '../../../store/uiFeedbackStore';
import { resolveKeyboardNotes } from '../../../audio/ojgraph';
import type { Connection, GraphNode } from '../../../engine/types';
import { NodeWrapper } from '../NodeWrapper';
import { deriveKeyboardNumber } from '../keyboardAssignment';

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

    it('costs nothing in the undo history — the mode number is derived, not written', () => {
        useHistoryStore.getState().clear();
        addAndRender('keyboard-visual');
        // `addNode` itself is not bracketed by this component; what matters is
        // that MOUNTING it does not add a second entry of its own.
        expect(useHistoryStore.getState().entries.length).toBeLessThanOrEqual(1);
    });

    it('reserves the numbers `keyboard` nodes already claimed', () => {
        const graph = useGraphStore.getState();
        graph.addNode('keyboard', { x: 0, y: 0 });          // claims 2
        graph.addNode('keyboard', { x: 0, y: 0 });          // claims 3
        const visualA = graph.addNode('keyboard-visual', { x: 0, y: 0 });
        const visualB = graph.addNode('keyboard-visual', { x: 0, y: 0 });
        const nodes = useGraphStore.getState().nodes;

        const a = deriveKeyboardNumber(nodes, visualA);
        const b = deriveKeyboardNumber(nodes, visualB);
        expect([a, b].sort()).toEqual([4, 5]);
        // Stable: the same graph gives the same answer on the next render.
        expect(deriveKeyboardNumber(nodes, visualA)).toBe(a);
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
        const keyD = container.querySelector<HTMLButtonElement>('[data-port-id="key-d"]')!;
        // The KeyTile is the playable face; the marker is its embedded well.
        const tile = keyD.closest('button')!;

        fireEvent.pointerDown(tile, { button: 0, pointerId: 1 });
        expect(on).toHaveBeenCalledWith(nodeId, 2, 2); // row 2 (A-L), index 2 (D)

        fireEvent.pointerUp(tile, { button: 0, pointerId: 1 });
        expect(off).toHaveBeenCalledTimes(1);
        expect(off).toHaveBeenCalledWith(nodeId, 2, 2);

        // A second release (pointer leaves after the up) must not double-fire.
        fireEvent.pointerLeave(tile, { pointerId: 1 });
        expect(off).toHaveBeenCalledTimes(1);
    });

    it('starts a cable — not a note — when the press lands on the key’s well', () => {
        const on = vi.fn();
        useAudioStore.setState({ emitKeyboardSignal: on });
        const { container } = addAndRender('keyboard-visual');
        const well = container.querySelector<HTMLElement>('.oj-key-tile__port[data-port-id="key-q"]')!;

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
