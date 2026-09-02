/**
 * How big is a card? — the registry does not know, and cannot be made to.
 *
 * W6-SHIP measured a Looper declaring `height: 120` and rendering **267**, and a
 * Sampler declaring `140` and rendering **378**. The obvious repair (re-declare
 * all fourteen) was rejected for a reason this file pins: `dimensions` is the
 * nominal box the socket-anchor fallback normalises against, not the card's
 * footprint, and every edge-anchored port `position` literal in the registry is
 * recomputed from it by `engine/__tests__/socketGeometry.test.ts`. Bending it to
 * make spawning honest would move cable anchors on the first painted frame.
 *
 * So the placement rule measures the surface — and remembers.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { freeSpawnPoint, measureRenderedCards, resetMeasuredCards, spawnCardSize } from '../spawnPlacement';

/** Paint a card of `type` at a given rendered size. */
function paintCard(id: string, width: number, height: number) {
    const card = document.createElement('div');
    card.className = 'oj-node';
    const port = document.createElement('span');
    port.setAttribute('data-node-id', id);
    card.append(port);
    document.body.append(card);
    card.getBoundingClientRect = () => ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
    return card;
}

describe('spawn measurement', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        resetMeasuredCards();
    });

    it('measures a rendered card instead of believing the registry', () => {
        paintCard('looper-1', 260, 267);
        measureRenderedCards(1, () => 'looper');

        // The registry's stale 120 loses to the 267 the surface reported.
        expect(spawnCardSize('looper', { width: 240, height: 120 })).toEqual({ width: 260, height: 267 });
    });

    it('divides the zoom back out, so a measurement is in canvas px', () => {
        paintCard('sampler-1', 400, 756);
        measureRenderedCards(2, () => 'sampler');
        expect(spawnCardSize('sampler', { width: 200, height: 140 })).toEqual({ width: 200, height: 378 });
    });

    it('remembers a type after its last card is gone', () => {
        paintCard('sampler-1', 300, 378);
        measureRenderedCards(1, () => 'sampler');
        document.body.innerHTML = '';
        measureRenderedCards(1, () => undefined);
        expect(spawnCardSize('sampler', { width: 200, height: 140 }).height).toBe(378);
    });

    it('floors the HEIGHT of a type never seen, because that is the axis the registry lies about', () => {
        paintCard('sampler-1', 300, 378);
        measureRenderedCards(1, () => 'sampler');
        // A Multiplier declares 80x40 and has never rendered. Reserving too much
        // height only MOVES the new card; reserving too little puts it below the
        // fold, where the player never sees it land.
        expect(spawnCardSize('multiplier', { width: 80, height: 40 })).toEqual({ width: 80, height: 378 });
    });

    /*
     * The width floor was removed after it was measured costing a real slot: with
     * a 500px Library on screen, a Sampler needing a 224x397 hole was made to look
     * for a 500x400 one, found none, and landed two thirds off the bottom of a
     * 1440x900 viewport — with a free 224-wide column beside the Looper.
     */
    it('does NOT floor the width, so a narrow card can still take a narrow slot', () => {
        paintCard('library-1', 500, 400);
        measureRenderedCards(1, () => 'library');
        expect(spawnCardSize('sampler', { width: 200, height: 140 }).width).toBe(200);

        const bounds = { left: 0, top: 0, right: 1000, bottom: 900 };
        // A 500-wide wall down the middle leaves a 250-wide column on each side.
        const wall = [{ position: { x: 250, y: 0 }, width: 500, height: 900 }];
        const card = spawnCardSize('sampler', { width: 200, height: 140 });
        const point = freeSpawnPoint({ x: 300, y: 100 }, wall, card, bounds);
        expect(point.x + card.width).toBeLessThanOrEqual(bounds.right);
        expect(point.y + card.height).toBeLessThanOrEqual(bounds.bottom);
        expect(point.x >= 750 || point.x + card.width <= 250, 'lands in one of the free columns').toBe(true);
    });

    it('a measured card still lands fully inside the viewport when there is room', () => {
        const bounds = { left: 0, top: 0, right: 1440, bottom: 900 };
        const card = { width: 300, height: 378 };
        // The wish is deep enough that the card would hang off the bottom.
        const point = freeSpawnPoint({ x: 700, y: 700 }, [], card, bounds);
        expect(point.y + card.height).toBeLessThanOrEqual(bounds.bottom);
        expect(point.x + card.width).toBeLessThanOrEqual(bounds.right);
        expect(point.y).toBeGreaterThanOrEqual(bounds.top);
    });
});
