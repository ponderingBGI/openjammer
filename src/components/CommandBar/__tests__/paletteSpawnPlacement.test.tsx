/**
 * W6-SHIP item 3 — three adds from the palette are three visible cards.
 *
 * `Ctrl+K → Add Looper → Add Library → Add Sampler` used to put three cards on
 * ONE point: the palette has no `ctx.point`, so `addNodeFromCtx` fell back to
 * `viewportCenter()`, which is a pure function of pan/zoom/rect and therefore
 * returns the same coordinate every time. The first two cards ended up ~90%
 * occluded under the third, and the stack ran off the viewport bottom.
 *
 * Two lanes were each individually fine — the palette (`041ff72`) and the
 * faceplates (`79c71b4`) — and together adding a node was broken. It is the most
 * direct "design for instant" break on the branch: the feedback the gesture
 * promises IS the card appearing, and two of three appeared invisibly.
 *
 * Pinned at both altitudes: the placement rule on its own, and the real
 * registered palette actions running end to end through the registry.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CASCADE_STEP, freeSpawnPoint } from '../../../utils/spawnPlacement';
import { useCommandSources } from '../useCommandSources';
import { getCommand, _resetForTests } from '../../../store/commandRegistry';
import { useGraphStore } from '../../../store/graphStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useHistoryStore } from '../../../store/historyStore';

function resetGraph(): void {
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
    // A viewport with a real centre, so `viewportCenter()` is a fixed point —
    // which is precisely the condition that made every add collide.
    useCanvasStore.setState({
        canvasRect: { left: 0, top: 0, width: 1280, height: 800 },
        pan: { x: 0, y: 0 },
        zoom: 1,
    });
}

beforeEach(() => {
    _resetForTests();
    resetGraph();
});
afterEach(() => _resetForTests());

describe('the placement rule', () => {
    /** A card of the default registry size, at `position`. */
    const box = (x: number, y: number, width = 200, height = 150) =>
        ({ position: { x, y }, width, height });
    const CARD = { width: 200, height: 150 };

    it('returns the wish itself when nothing is there', () => {
        expect(freeSpawnPoint({ x: 100, y: 50 }, [])).toEqual({ x: 100, y: 50 });
    });

    it('steps down-right off a taken spot, in a legible cascade', () => {
        // A SMALL card, so one cascade step already clears the one under it and
        // the diagonal is visible within a single lap. (With a 200x150 card a step
        // of 28px still overlaps, so the run has to travel most of a lap before it
        // is free — correct, but it is the rectangle test, not the cascade shape.)
        const small = { width: 20, height: 20 };
        const first = { x: 100, y: 50 };
        const placed = [first];
        for (let i = 0; i < 3; i += 1) {
            placed.push(freeSpawnPoint(first, placed.map((p) => ({ position: p, ...small })), small));
        }
        for (let i = 1; i < placed.length; i += 1) {
            expect(placed[i]!.x).toBe(first.x + i * CASCADE_STEP);
            expect(placed[i]!.y).toBe(first.y + i * CASCADE_STEP);
        }
    });

    it('never returns a spot that overlaps a card already there', () => {
        // The invariant that actually matters, held across enough adds to force a
        // lap wrap: within a lap the run is a diagonal, and a new lap restarts
        // higher and further right — but no placement may ever cover a sibling.
        // With BOUNDS, because that is the shipping configuration — the real
        // caller always passes the visible canvas.
        const bounds = { left: 0, top: 0, right: 1440, bottom: 900 };
        const placed: { position: { x: number; y: number }; width: number; height: number }[] = [];
        for (let i = 0; i < 12; i += 1) {
            const next = freeSpawnPoint({ x: 100, y: 50 }, placed, CARD, bounds);
            for (const other of placed) {
                const covers = next.x < other.position.x + other.width
                    && next.x + CARD.width > other.position.x
                    && next.y < other.position.y + other.height
                    && next.y + CARD.height > other.position.y;
                expect(covers, `add ${i} landed on a card already there`).toBe(false);
            }
            placed.push({ position: next, ...CARD });
        }
        expect(new Set(placed.map((p) => `${p.position.x},${p.position.y}`)).size).toBe(12);
    });

    it('measures overlap by the CARD, not by a point radius', () => {
        // The first version asked "is another node's ORIGIN within 14px", so a
        // 380px-tall Library one step away read as a free spot while covering the
        // new card almost entirely. The origins here are 28px apart; the cards are
        // not.
        const wish = { x: 0, y: 0 };
        const library = box(28, 28, 580, 380);
        expect(freeSpawnPoint(wish, [library], CARD)).not.toEqual(wish);
        // …and a card genuinely clear of it is left alone.
        expect(freeSpawnPoint(wish, [box(1000, 1000)], CARD)).toEqual(wish);
    });

    it('never places a card where it would leave the visible canvas', () => {
        // Measured at 1440x900, the brief's own three adds put cards two and
        // three at y-bottom 904 and 927 — the cascade made containment WORSE than
        // no cascade at all, while the code's comment claimed a run of eight
        // stayed on screen.
        const bounds = { left: 0, top: 0, right: 1440, bottom: 900 };
        const tall = { width: 580, height: 380 };
        const wish = { x: 400, y: 496 };
        const occupied = [{ position: wish, ...tall }];
        const placed = freeSpawnPoint(wish, occupied, tall, bounds);
        expect(placed.y + tall.height).toBeLessThanOrEqual(bounds.bottom);
        expect(placed.x + tall.width).toBeLessThanOrEqual(bounds.right);
        expect(placed.x).toBeGreaterThanOrEqual(bounds.left);
        expect(placed.y).toBeGreaterThanOrEqual(bounds.top);
    });

    it('still returns an uncovered spot when nothing on screen is free', () => {
        // A wall of cards filling the viewport must not make the rule give up and
        // stack — being off-screen is recoverable by scrolling, being buried is not.
        const bounds = { left: 0, top: 0, right: 300, bottom: 300 };
        const wall = Array.from({ length: 40 }, (_, i) => box(i * 4, i * 4, 300, 300));
        const placed = freeSpawnPoint({ x: 0, y: 0 }, wall, CARD, bounds);
        expect(wall.some((other) =>
            placed.x < other.position.x + other.width && placed.x + CARD.width > other.position.x
            && placed.y < other.position.y + other.height && placed.y + CARD.height > other.position.y,
        )).toBe(false);
    });
});

describe('three adds from the palette', () => {
    it('produce three distinct positions, none occluding another', () => {
        renderHook(() => useCommandSources());

        // No `ctx` — this is exactly what the palette passes.
        for (const type of ['looper', 'library', 'sampler']) {
            getCommand(`node.add.${type}`)!.run({} as never);
        }

        const positions = [...useGraphStore.getState().nodes.values()]
            .filter((node) => node.parentId === null)
            .map((node) => node.position);
        expect(positions).toHaveLength(3);

        const keys = new Set(positions.map((point) => `${point.x},${point.y}`));
        expect(keys.size, 'three adds, three coordinates').toBe(3);
        // "Distinct" is not enough — a 1px offset is still an occlusion. Every
        // pair has to be at least one cascade step apart on some axis.
        for (const a of positions) {
            for (const b of positions) {
                if (a === b) continue;
                expect(
                    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
                    'cards are visibly apart',
                ).toBeGreaterThanOrEqual(CASCADE_STEP);
            }
        }
    });

    it('still honours the right-click point — the menu was never broken', () => {
        renderHook(() => useCommandSources());

        getCommand('node.add.looper')!.run({ point: { x: 640, y: 400 } } as never);
        const [node] = [...useGraphStore.getState().nodes.values()];
        expect(node!.position).toEqual({ x: 640, y: 400 });
    });
});
