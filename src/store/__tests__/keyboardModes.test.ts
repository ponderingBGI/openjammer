/**
 * W5-P8b — ONE law for keyboard mode numbers.
 *
 * A mode number is what a performer's left hand reaches for mid-set. It is
 * allocated once, persisted, and never moves because of something that happened
 * to another node. Both keyboard kinds obey the same law, so these tests run the
 * same scenarios against `keyboard` and `keyboard-visual` — and against a mixed
 * canvas, which is where the two old laws collided.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGraphStore } from '../graphStore';
import { useHistoryStore } from '../historyStore';
import { useCanvasNavigationStore } from '../canvasNavigationStore';
import { lowestFreeKeyboardMode, normalizeKeyboardModes, keyboardModeOf } from '../keyboardModes';
import type { GraphNode, NodeType } from '../../engine/types';

const STORAGE_KEY = 'openjammer-graph-v2';

const KEYBOARD_KINDS: NodeType[] = ['keyboard', 'keyboard-visual'];

function reset() {
    localStorage.removeItem(STORAGE_KEY);
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
    useCanvasNavigationStore.setState({ currentViewNodeId: null, rootViewState: null, viewStates: new Map() });
}

const modeOf = (id: string) => keyboardModeOf(useGraphStore.getState().nodes.get(id));

function add(type: NodeType): string {
    return useGraphStore.getState().addNode(type, { x: 0, y: 0 });
}

describe('keyboard mode numbers', () => {
    beforeEach(reset);
    afterEach(() => localStorage.removeItem(STORAGE_KEY));

    describe.each(KEYBOARD_KINDS)('%s', (kind) => {
        it('is allocated the lowest free number and persisted on the node', () => {
            const a = add(kind);
            const b = add(kind);
            const c = add(kind);
            expect([modeOf(a), modeOf(b), modeOf(c)]).toEqual([2, 3, 4]);
        });

        it('never moves when another keyboard is added or deleted', () => {
            const a = add(kind);
            const b = add(kind);
            const c = add(kind);

            // Delete the MIDDLE one: the survivors keep exactly what they had.
            useGraphStore.getState().removeNode(b);
            expect(modeOf(a)).toBe(2);
            expect(modeOf(c)).toBe(4);

            // The freed number goes to the next NEW keyboard, not to a survivor.
            const d = add(kind);
            expect(modeOf(d)).toBe(3);
            expect(modeOf(a)).toBe(2);
            expect(modeOf(c)).toBe(4);
        });

        it('survives undo/redo of the delete with the same number', () => {
            const a = add(kind);
            const b = add(kind);

            useGraphStore.getState().removeNode(b);
            useGraphStore.getState().undo();
            expect(modeOf(b)).toBe(3);
            expect(modeOf(a)).toBe(2);

            useGraphStore.getState().redo();
            expect(useGraphStore.getState().nodes.get(b)).toBeUndefined();
            expect(modeOf(a)).toBe(2);
        });

        it('costs no extra history entry — the number rides the add', () => {
            useHistoryStore.getState().clear();
            useGraphStore.getState().beginGesture();
            const a = add(kind);
            useGraphStore.getState().endGesture();
            expect(useHistoryStore.getState().entries).toHaveLength(1);
            expect(modeOf(a)).toBe(2);
        });
    });

    it('shares ONE pool across both kinds — a mixed canvas never collides', () => {
        const visualA = add('keyboard-visual');   // 2
        const bundle = add('keyboard');           // 3
        const visualB = add('keyboard-visual');   // 4

        expect([modeOf(visualA), modeOf(bundle), modeOf(visualB)]).toEqual([2, 3, 4]);

        // The finding this round closes: adding a bundle keyboard used to shift
        // every visual keyboard's number by one.
        add('keyboard');
        expect([modeOf(visualA), modeOf(bundle), modeOf(visualB)]).toEqual([2, 3, 4]);

        useGraphStore.getState().removeNode(bundle);
        expect([modeOf(visualA), modeOf(visualB)]).toEqual([2, 4]);
    });

    it('honours an explicit pin from a project file, rig or agent', () => {
        const pinned = useGraphStore.getState().addNode('keyboard-visual', { x: 0, y: 0 }, null, { assignedKey: 7 });
        expect(modeOf(pinned)).toBe(7);
        // …and the next keyboard fills the lowest free number around it.
        expect(modeOf(add('keyboard'))).toBe(2);
    });

    it('gives the MIRROR inside a keyboard container no number of its own', () => {
        const parentId = add('keyboard');
        const nodes = useGraphStore.getState().nodes;
        const mirror = [...nodes.values()].find(
            (n) => n.type === 'keyboard-visual' && n.parentId === parentId,
        );
        expect(mirror, 'a keyboard mints a keyboard-visual mirror').toBeDefined();
        expect(keyboardModeOf(mirror)).toBeUndefined();
        // …so it does not consume a number the next real keyboard wants.
        expect(modeOf(add('keyboard-visual'))).toBe(3);
    });

    it('survives a reload byte-identically', () => {
        const a = add('keyboard-visual');
        const b = add('keyboard');
        const c = add('keyboard-visual');
        useGraphStore.getState().removeNode(b);
        const before = [modeOf(a), modeOf(c)];

        // The persist middleware's own round trip: serialize, then rehydrate.
        const serialized = localStorage.getItem(STORAGE_KEY);
        expect(serialized, 'the graph persisted').toBeTruthy();
        useGraphStore.persist.clearStorage();
        localStorage.setItem(STORAGE_KEY, serialized!);
        useGraphStore.persist.rehydrate();

        expect([modeOf(a), modeOf(c)]).toEqual(before);
        expect(before).toEqual([2, 4]);
    });

    it('re-allocates only the PASTED copy when a keyboard is duplicated', () => {
        const original = add('keyboard-visual');
        useGraphStore.getState().selectNode(original);
        useGraphStore.getState().duplicateSelected();

        const copies = [...useGraphStore.getState().nodes.values()]
            .filter((n) => n.type === 'keyboard-visual' && n.id !== original);
        expect(copies).toHaveLength(1);
        // The node already under the player's hands keeps its number.
        expect(modeOf(original)).toBe(2);
        expect(keyboardModeOf(copies[0])).toBe(3);
    });
});

// ============================================================================

describe('the pure law', () => {
    const node = (id: string, type: string, assignedKey?: number, parentId: string | null = null) =>
        ({ id, type, parentId, data: assignedKey === undefined ? {} : { assignedKey }, ports: [], childIds: [] } as unknown as GraphNode);

    it('hands out the lowest free number and wraps when 2-9 are all taken', () => {
        expect(lowestFreeKeyboardMode(new Set())).toBe(2);
        expect(lowestFreeKeyboardMode(new Set([2, 3, 5]))).toBe(4);
        expect(lowestFreeKeyboardMode(new Set([2, 3, 4, 5, 6, 7, 8, 9]))).toBe(2);
    });

    it('leaves a healthy graph completely alone', () => {
        const changes = normalizeKeyboardModes([
            node('a', 'keyboard', 2),
            node('b', 'keyboard-visual', 5),
            node('c', 'speaker'),
        ]);
        expect(changes.size).toBe(0);
    });

    it('moves the NEWER node on a collision, never the older one', () => {
        const changes = normalizeKeyboardModes([
            node('old', 'keyboard', 3),
            node('new', 'keyboard-visual', 3),
        ]);
        expect([...changes]).toEqual([['new', 2]]);
    });

    it('allocates for a legacy node that was never given one', () => {
        const changes = normalizeKeyboardModes([
            node('old', 'keyboard', 2),
            node('legacy', 'keyboard-visual'),
        ]);
        expect(changes.get('legacy')).toBe(3);
    });

    it('skips a mirror living inside a keyboard container', () => {
        const changes = normalizeKeyboardModes([
            node('kb', 'keyboard', 2),
            node('mirror', 'keyboard-visual', undefined, 'kb'),
        ]);
        expect(changes.size).toBe(0);
    });
});
