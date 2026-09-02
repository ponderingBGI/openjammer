import type { Position } from '../engine/types';

/**
 * Where a new card actually lands.
 *
 * The palette had no answer to this: `Ctrl+K -> Add Looper -> Add Library -> Add
 * Sampler` computed the viewport centre three times and got the same point three
 * times, so the second and third cards landed exactly on top of the first. The
 * player watched the change land ON the last one — the most direct violation of
 * "design for instant" on the surface, because the feedback the gesture promises
 * is the card appearing, and two of three appeared invisibly.
 *
 * The rule is the one every windowing system has used since the Macintosh: if the
 * spot is taken, step down-right and try again. It is deliberately a CASCADE and
 * not a scatter — a cascade is legible (the player can see the run they just made,
 * in order, and drag the top one off the pile), where a random free-space search
 * produces a layout nobody authored.
 *
 * Two things the first version of this got wrong, both measured rather than
 * argued, and both fixed here (this also closes HA-17 in
 * `plans/ux-intuitive/HEURISTIC-AUDIT.md`):
 *
 *  1. **It tested points, not cards.** Occupancy was "is another node's ORIGIN
 *     within half a step", so a 380px-tall Library and a 90px Multiplier counted
 *     the same, and two large cards 30px apart read as "not overlapping" while
 *     covering each other almost entirely.
 *  2. **It let the card leave the screen.** `CASCADE_STEP`'s own comment claimed a
 *     run of eight stayed on screen; measured at 1440x900, cards two and three of
 *     the brief's own sequence ended at y-bottom 904 and 927 against a 900px
 *     viewport. The cascade made containment WORSE than no cascade at all, because
 *     the spawn point is the card's top-LEFT and a tall card already starts near
 *     the bottom edge. A candidate that would push the card off-screen is now
 *     rejected outright and the run wraps early.
 *
 * This lives in one place because there is one add path: `addNodeFromCtx` serves
 * BOTH the palette (no `ctx.point` -> viewport centre) and the right-click menu
 * (`ctx.point` -> the clicked pixel). Right-click gets it too, and should: two
 * right-clicks on the same pixel stack for exactly the same reason.
 */

/** One diagonal step, in canvas px. Big enough to read as a stack, small enough
 *  that the offset never hides the card underneath it. */
export const CASCADE_STEP = 28;

/** Steps before the run starts again, shifted sideways, instead of marching off
 *  the bottom of the viewport. */
const CASCADE_WRAP = 8;

/** How far one complete run travels on each axis. */
const RUN_SPAN = CASCADE_WRAP * CASCADE_STEP;

/**
 * Runs per row before the next run starts a row DOWN instead of further right.
 *
 * Laps used to advance on x only, which put every candidate the rule would ever
 * consider inside a band 196px tall — barely more than one card height. On a busy
 * canvas the search ran out of ideas and fell back to stacking. Laps now walk a
 * grid, so the candidates actually cover an area rather than a stripe.
 */
const RUNS_PER_ROW = 4;

/** Give up and stack rather than loop forever on a very crowded canvas. */
const MAX_TRIES = CASCADE_WRAP * 16;

/** A card on the canvas: where it starts and how much room it takes. */
export interface SpawnBox {
    position: Position;
    width: number;
    height: number;
}

/** The canvas-space rectangle a new card may not leave, when the caller knows it. */
export interface SpawnBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Do two axis-aligned rectangles overlap at all? */
function overlaps(a: SpawnBox, b: SpawnBox): boolean {
    return a.position.x < b.position.x + b.width
        && a.position.x + a.width > b.position.x
        && a.position.y < b.position.y + b.height
        && a.position.y + a.height > b.position.y;
}

/**
 * The first point at or after `desired` where the new card neither covers an
 * existing sibling nor leaves the visible canvas.
 *
 * `occupied` is the boxes of the nodes the new card will be a sibling of — the
 * CURRENT canvas level only, because a card two levels down is not something the
 * player can see being covered.
 *
 * `bounds`, when given, is the visible canvas rectangle. A candidate whose whole
 * card does not fit inside it is skipped, so the cascade wraps sideways (and, on
 * the last resort, back to the wish) rather than walking the card off-screen.
 */
export function freeSpawnPoint(
    desired: Position,
    occupied: readonly SpawnBox[],
    card: { width: number; height: number } = { width: 200, height: 150 },
    bounds?: SpawnBounds,
): Position {
    /*
     * WRAP into the visible canvas, rather than clamping to its edge or rejecting
     * outright.
     *
     * A cascade only ever steps down-right, so when the bottom edge is close there
     * may be no down-right candidate left on screen at all — the shipped version
     * simply walked the run off the bottom. Clamping is no better: every clamped
     * candidate saturates onto the same edge, collides with the same card, and the
     * search dies without ever looking at the space ABOVE the wish, which is
     * usually where the room is.
     *
     * Wrapping keeps the whole viewport reachable while the run stays a legible
     * diagonal: a card that would fall past the bottom reappears near the top, one
     * step further right, which is what a tab-cycle through positions looks like.
     */
    const wrap = (position: Position): Position => {
        if (!bounds) return position;
        // The last position at which the whole card still fits, per axis.
        const spanX = Math.max(0, (bounds.right - card.width) - bounds.left);
        const spanY = Math.max(0, (bounds.bottom - card.height) - bounds.top);
        const into = (value: number, origin: number, span: number) => {
            if (span <= 0) return origin;
            const offset = ((value - origin) % (span + 1) + (span + 1)) % (span + 1);
            return origin + offset;
        };
        return {
            x: into(position.x, bounds.left, spanX),
            y: into(position.y, bounds.top, spanY),
        };
    };
    const clear = (position: Position) =>
        !occupied.some((other) => overlaps({ position, ...card }, other));

    /**
     * How much of the card would be ON SCREEN at `position`, in px^2. Used only
     * to choose between spots that are all uncovered but none of which fits
     * entirely — "mostly visible" beats "just below the fold", and both beat
     * "buried", which is the one outcome the player cannot recover from.
     */
    const visibleArea = (position: Position) => {
        if (!bounds) return card.width * card.height;
        const w = Math.max(0, Math.min(position.x + card.width, bounds.right) - Math.max(position.x, bounds.left));
        const h = Math.max(0, Math.min(position.y + card.height, bounds.bottom) - Math.max(position.y, bounds.top));
        return w * h;
    };

    let best: { position: Position; area: number } | null = null;
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
        const lap = Math.floor(attempt / CASCADE_WRAP);
        const step = attempt % CASCADE_WRAP;
        // Each new lap starts a full run to the right; every fourth starts a run
        // lower instead, so a ninth card sits beside the pile and a twenty-fifth
        // starts a new band below it.
        const raw = {
            x: desired.x + step * CASCADE_STEP + (lap % RUNS_PER_ROW) * RUN_SPAN,
            y: desired.y + step * CASCADE_STEP + Math.floor(lap / RUNS_PER_ROW) * RUN_SPAN,
        };
        for (const candidate of [wrap(raw), raw]) {
            if (!clear(candidate)) continue;
            const area = visibleArea(candidate);
            // A candidate that fits entirely is the answer; nothing later can beat it.
            if (area >= card.width * card.height) return candidate;
            if (!best || area > best.area) best = { position: candidate, area };
        }
    }
    /*
     * Nothing fits entirely. Return the most VISIBLE uncovered spot rather than
     * the first one found: on a canvas whose middle is already spanned by a rig
     * there may be no room for a 380px faceplate at all, and in that case a card
     * two thirds on screen is a far better answer than one just past the fold —
     * and either is better than one dropped on top of the player's work.
     */
    return best?.position ?? desired;
}
