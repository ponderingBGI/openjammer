/**
 * W6-E2E — the §11 acceptance list of the New DNA timeline interaction spec.
 *
 * One `test()` per T-item, named `T<n> — <the spec's own title>`, asserting the
 * spec's OBSERVABLE outcome: the document through `window.__openjammerE2E`
 * where §11 says "assert document state", DOM geometry only where geometry IS
 * the contract (pixel-lock, virtualization, the sky band), and `history()`
 * where the law is "one gesture, one undo".
 *
 * Three things are worth knowing before reading further.
 *
 * 1. THE ENGINE DOES NOT ANSWER HEADLESSLY. Chromium runs the real wasm
 *    worklet here, but no `TransportFrame` ever comes back, so the store
 *    honestly refuses to claim it is playing and raises "The audio engine did
 *    not acknowledge the transport command". That is correct product behaviour
 *    and a useless fixture, so every transport-dependent T-item installs
 *    `installEngineProbe` — the same worklet mirror `e2e/timeline-preview.spec.ts`
 *    has always used. Tests that do not touch the transport do not install it.
 *
 * 2. SOME T-ITEMS ARE NOT E2E ITEMS. T37/T40/T41/T42 are named in §11 as unit
 *    gates over pure functions and token files, and T38 is J3, which already
 *    asserts verb-replay convergence and is §11's own "keep as the regression
 *    gate". Re-implementing them here would fork the gate, which is exactly
 *    what the covenant forbids. They are `test.skip` with the owning file
 *    named, and this lane's report verifies those owners are green.
 *
 * 3. GRIP GEOMETRY IS LOAD-BEARING. `clipGrabPoint` keeps every clip press
 *    clear of the header column's `col-resize` grip (6px, `z-index: 20`), which
 *    otherwise silently swallows the press on any clip starting at tick 0. And
 *    every geometric assertion measures AFTER the surface's entry animation, via
 *    `settleField` — `surface-transition-in` scales the whole surface from
 *    1.015, so an early `getBoundingClientRect` is 1.5% short of the truth.
 *
 * 4. FOUR ITEMS WERE `test.fixme` OVER A REAL PRODUCT GAP, never over a flaky
 *    harness: T19b (canvas `E` eaten by the note row), T27 (no shipped path
 *    calls `stop()` twice), T39 (no `touch-action`, so Chromium cancels every
 *    touch drag) and X5b (a pointer gesture on a note clears the inline roll's
 *    note selection). All four are FIXED and live — findings F1-F4 in
 *    `plans/redesign-new-dna/W6-E2E-REPORT.md`, closed by lane W6-T, whose
 *    report records the root cause and the pinning unit test behind each.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
    bootApp,
    bridge,
    clipCount,
    clipGrabPoint,
    documentJson,
    dragBy,
    dragClip,
    dragClipEdge,
    fieldMetrics,
    flatClips,
    focusArrangement,
    historyLength,
    installEngineProbe,
    isPlaying,
    loadFixture,
    locationsOf,
    openPaperSketch,
    openSongRig,
    playButton,
    playheadDisplay,
    releaseDrag,
    selectionOf,
    settleField,
    snapshot,
    songEndTick,
    tabToOtherSurface,
    verbLogOf,
    visibleSurface,
    zoomIn,
    zoomToBarWidth,
    type FieldMetrics,
} from './journeys/support';

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers — everything that is about THIS list rather than about booting.
// ─────────────────────────────────────────────────────────────────────────────

const clips = (page: Page) => page.locator('.arrangement-clip');
const lanes = (page: Page) => page.locator('.arrangement-lane');
const dragGhost = (page: Page) => page.locator('[data-drag-ghost]');
const snapIndicator = (page: Page) => page.locator('.arrangement-snap-indicator');

/** Collect uncaught exceptions for the "no `pageerror`" halves of §11. */
function collectPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    return errors;
}

/** Where a tick sits on screen right now. */
const tickToX = (metrics: FieldMetrics, tick: number) => metrics.headerRight + tick * metrics.pxPerTick - metrics.scrollLeft;

/**
 * Put the grid on a named unit through the shipped `[` / `]` bindings.
 *
 * The default is `adaptive`, which is deliberately zoom-dependent — good for a
 * player, useless for an assertion about WHICH anchor snap chose. Every snap
 * test therefore names its grid first.
 */
async function setGridUnit(page: Page, unit: 'none' | 'bar' | 'beat' | '1/4' | '1/8' | '1/16'): Promise<void> {
    const chip = page.locator('.arrangement-grid-chip');
    const order = ['none', 'bar', 'beat', '1/2', '1/4', '1/8', '1/16', '1/32'];
    await focusArrangement(page);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const label = (await chip.getAttribute('aria-label')) ?? '';
        const current = label.replace('Grid unit: ', '').trim();
        if (current === unit) return;
        const from = order.indexOf(current);
        const to = order.indexOf(unit);
        // `adaptive` is not in the ladder; one `]` lands on `bar`, the bottom rung.
        await page.keyboard.press(from < 0 ? ']' : from < to ? ']' : '[');
        await expect.poll(() => chip.getAttribute('aria-label')).not.toBe(label);
    }
    throw new Error(`Could not put the grid on ${unit}`);
}

/** The notes of the MIDI source a clip is a window onto. */
async function notesOfClip(page: Page, clipId: string): Promise<Array<{ id?: string; tick: number; durTick: number; pitch: number; vel?: number }>> {
    const document_ = await snapshot(page) as { sources?: Record<string, { kind: string; notes?: Array<{ id?: string; tick: number; durTick: number; pitch: number; vel?: number }> }> };
    const clip = (await flatClips(page)).find((item) => item.id === clipId);
    if (!clip) throw new Error(`No clip ${clipId}`);
    const source = document_.sources?.[clip.sourceId];
    return source?.kind === 'midi' ? (source.notes ?? []) : [];
}

/** Put the keyboard on the roll itself, where its `surface: 'pianoroll'` set lives. */
async function focusRoll(page: Page): Promise<void> {
    await page.locator('[data-keymap-surface="pianoroll"]').last().focus();
}

/** Open the inline roll on a clip and wait for its notes to paint. */
async function openInlineRoll(page: Page, clip: Locator): Promise<void> {
    await clip.dblclick({ position: { x: 40, y: 34 } });
    await expect(page.locator('.piano-roll--inline')).toBeVisible();
    await expect(page.locator('.piano-roll--inline .piano-roll-note').first()).toBeVisible();
}

/**
 * Open the FULL piano-roll surface on the selected MIDI clip, the `E` way.
 *
 * The settle is H1 applied here too, and it is load-bearing rather than
 * defensive. `.surface-transition-in` scales the surface `1.015 → 1` over 180ms
 * after a 60ms delay, so until it finishes every `getBoundingClientRect` on this
 * surface is a moving target: measured across 32 runs, the note field's left edge
 * slides over a **6.84px** range (67.54 → 74.38) before settling on its true 76px
 * (`SCROOMER_WIDTH` 12 + `SURFACE_KEY_WIDTH` 64). `T33` aims ~5px from that edge,
 * where 2.4px of drift is enough to move the snapped tick from the first note's
 * END anchor to its START — and drawing on an existing note's own tick and pitch
 * is refused by BC-30 with zero verbs, so `history().cursor` never moves and the
 * test fails having proved nothing. That was ~1 run in 5 (W6-T report §9).
 *
 * Settled, the same 16 runs put the edge on 76.000 every time. It hardens every
 * T-item that comes through this helper — T18, T19, T33–T36 — not just T33.
 */
async function openRollSurface(page: Page, clip: Locator): Promise<void> {
    await clip.click({ position: { x: 40, y: 34 } });
    await focusArrangement(page);
    await page.keyboard.press('e');
    const surface = page.locator('[data-surface-root="pianoroll"]');
    await expect(surface).toBeVisible();
    await expect(surface.locator('.piano-roll-note').first()).toBeVisible();
    await surface.evaluate(async (element) => {
        await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 / §3 — the gesture laws
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §1/§3 — gestures', () => {
    test('T1 — One gesture = one undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const before = await documentJson(page);
        const cursor = await historyLength(page);

        await dragClip(page, clips(page).first(), 60);

        await expect.poll(() => historyLength(page)).toBe(cursor + 1);
        await focusArrangement(page);
        await page.keyboard.press('Control+z');
        await expect.poll(() => documentJson(page)).toBe(before);
    });

    test('T2 — Drag threshold', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const cursor = await historyLength(page);
        const start = (await flatClips(page))[0]!.startTick;

        await dragClip(page, clips(page).first(), 3, 0, { steps: 3 });

        expect(await historyLength(page)).toBe(cursor);
        expect((await flatClips(page))[0]!.startTick).toBe(start);
    });

    test('T3 — Escape aborts', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const before = await documentJson(page);
        const cursor = await historyLength(page);

        await dragClip(page, clips(page).first(), 80, 0, { hold: true, dwell: 120 });
        await expect(dragGhost(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await releaseDrag(page);

        await expect(dragGhost(page)).toHaveCount(0);
        await expect.poll(() => documentJson(page)).toBe(before);
        expect(await historyLength(page)).toBe(cursor);
    });

    test('T4 — Magnetic snap radius', async ({ page }) => {
        await openPaperSketch(page);
        await setGridUnit(page, 'bar');
        await zoomToBarWidth(page, 200);
        const metrics = await fieldMetrics(page);

        // Aim ten pixels PAST the next bar line: inside the 12px grid magnet.
        await dragClip(page, clips(page).first(), Math.round(metrics.pxPerBar) + 10, 0, { hold: true, dwell: 150 });
        await expect(snapIndicator(page)).toHaveCount(1);
        await releaseDrag(page);

        const moved = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        expect(moved.startTick).toBe(metrics.ticksPerBar);
    });

    test('T5 — Snap override', async ({ page }) => {
        await openPaperSketch(page);
        await setGridUnit(page, 'bar');
        const barWidth = await zoomToBarWidth(page, 200);
        const metrics = await fieldMetrics(page);
        const deltaX = Math.round(barWidth) + 10;

        // Ctrl goes down only once the pointer is already moving: press-phase
        // Ctrl means "toggle selection", move-phase Ctrl means "invert snap".
        await dragClip(page, clips(page).first(), deltaX, 0, { moveModifiers: ['Control'] });

        const moved = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        const raw = deltaX / metrics.pxPerTick;
        expect(moved.startTick % metrics.ticksPerBar).not.toBe(0);
        expect(Math.abs(moved.startTick - raw)).toBeLessThanOrEqual(2);
    });

    test('T6 — Axis lock (BC-12)', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const before = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;

        await dragClip(page, clips(page).first(), 60, 40, { modifiers: ['Shift'] });

        const after = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        expect(after.trackId).toBe(before.trackId);
        expect(after.startTick).not.toBe(before.startTick);
    });

    test('T7 — Copy-drag threshold', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const before = await clipCount(page);
        const cursor = await historyLength(page);
        const from = await clipGrabPoint(page, clips(page).first());

        await page.keyboard.down('Alt');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 8, from.y, { steps: 4 });
        await page.waitForTimeout(150);
        expect(await clipCount(page), 'eight pixels is under the 12px copy threshold').toBe(before);

        await page.mouse.move(from.x + 40, from.y, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Alt');

        await expect.poll(() => clipCount(page)).toBe(before + 1);
        expect(await historyLength(page)).toBe(cursor + 1);
    });

    test('T8 — Trim preserves the source window (BC-17)', async ({ page }) => {
        await openPaperSketch(page);
        await setGridUnit(page, 'bar');
        const barWidth = await zoomToBarWidth(page, 160);
        // Track 2's clip starts at bar 3, clear of the header grip at tick 0.
        const clip = clips(page).nth(1);
        const before = (await flatClips(page)).find((item) => item.id === 't1.c0')!;

        await dragClipEdge(page, clip, 'start', Math.round(barWidth) + 6);

        const after = (await flatClips(page)).find((item) => item.id === 't1.c0')!;
        const startDelta = after.startTick - before.startTick;
        const sourceDelta = (after.sourceStart ?? 0) - (before.sourceStart ?? 0);
        expect(startDelta).toBeGreaterThan(0);
        expect(sourceDelta).toBe(startDelta);
        expect(before.lengthTick - after.lengthTick).toBe(startDelta);
    });

    test('T9 — Slip (BC-19)', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 5);
        const before = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;

        await dragClip(page, clips(page).first(), 45, 0, { modifiers: ['Control', 'Shift'] });

        const after = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        expect(after.sourceStart ?? 0).not.toBe(before.sourceStart ?? 0);
        expect(after.startTick).toBe(before.startTick);
        expect(after.lengthTick).toBe(before.lengthTick);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.2 — the field, the ruler and the locations
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §3.2 — field, ruler, locations', () => {
    test('T10 — Loop brace creation', async ({ page }) => {
        await openPaperSketch(page);
        const metrics = await fieldMetrics(page);
        const braces = (await page.locator('.arrangement-braces-row').boundingBox())!;
        const y = braces.y + braces.height / 2;
        const fromTick = 2 * metrics.ticksPerBar;
        const toTick = 6 * metrics.ticksPerBar;

        await dragBy(page, { x: tickToX(metrics, fromTick), y }, tickToX(metrics, toTick) - tickToX(metrics, fromTick), 0, { steps: 14 });

        const loop = (await locationsOf(page)).find((location) => location.kind === 'loop');
        expect(loop, 'the brace row must be able to CREATE a loop range').toBeTruthy();
        expect(loop!.startTick).toBe(fromTick);
        expect(loop!.endTick).toBe(toTick);

        // The wash spans exactly the same ticks, so the eye and the model agree.
        // Re-measure: geometry asserted against geometry must be measured at the
        // same instant, never against metrics captured before a paint.
        const wash = page.locator('.arrangement-loop-wash');
        await expect(wash).toBeVisible();
        const now = await fieldMetrics(page);
        const washBox = (await wash.boundingBox())!;
        expect(Math.abs(washBox.x - tickToX(now, fromTick))).toBeLessThanOrEqual(1.5);
        expect(Math.abs(washBox.width - (toTick - fromTick) * now.pxPerTick)).toBeLessThanOrEqual(1.5);
    });

    test('T11 — Marker lifecycle', async ({ page }) => {
        await openPaperSketch(page);
        const chipLabel = page.locator('.arrangement-section-chip .arrangement-section-chip__label').first();
        const label = (await chipLabel.boundingBox())!;

        // CREATE. Alt is required: a section chip's label fills the chip, so on
        // Paper Sketch (sections on every bar) there is no bare row to press.
        const marksBefore = await page.locator('.arrangement-section-chip--mark').count();
        await page.keyboard.down('Alt');
        await page.mouse.dblclick(label.x + label.width / 2, label.y + label.height / 2);
        await page.keyboard.up('Alt');
        await expect(page.locator('.arrangement-section-chip--mark')).toHaveCount(marksBefore + 1);
        const afterCreate = await historyLength(page);

        // RENAME.
        const rename = page.locator('input.arrangement-section-chip');
        if (await rename.count()) {
            await rename.fill('Chorus');
            await page.keyboard.press('Enter');
        } else {
            await page.locator('.arrangement-section-chip--mark .arrangement-section-chip__label').first().dblclick();
            await page.locator('input.arrangement-section-chip').fill('Chorus');
            await page.keyboard.press('Enter');
        }
        await expect.poll(async () => (await locationsOf(page)).some((location) => location.name === 'Chorus')).toBe(true);
        expect(await historyLength(page), 'rename is its own undo step').toBe(afterCreate + 1);

        // MOVE.
        const mark = page.locator('.arrangement-section-chip--mark').first();
        const markBox = (await mark.boundingBox())!;
        const tickBefore = (await locationsOf(page)).find((location) => location.name === 'Chorus')!.startTick;
        await dragBy(page, { x: markBox.x + markBox.width / 2, y: markBox.y + markBox.height / 2 }, 90);
        await expect.poll(async () => (await locationsOf(page)).find((location) => location.name === 'Chorus')!.startTick).not.toBe(tickBefore);

        // SELECT, then DELETE.
        await mark.click();
        await expect.poll(async () => (await selectionOf(page)).sectionIds.length).toBe(1);
        await page.keyboard.press('Delete');
        await expect.poll(async () => (await locationsOf(page)).some((location) => location.name === 'Chorus')).toBe(false);

        const kinds = (await verbLogOf(page)).map((entry) => entry.verb.kind);
        const wanted = ['addLocation', 'setLocationName', 'moveLocation', 'removeLocation'];
        const seen = kinds.filter((kind) => wanted.includes(kind));
        expect(wanted.every((kind) => seen.includes(kind))).toBe(true);
        expect(seen.indexOf('addLocation')).toBeLessThan(seen.indexOf('setLocationName'));
        expect(seen.indexOf('setLocationName')).toBeLessThan(seen.indexOf('moveLocation'));
        expect(seen.indexOf('moveLocation')).toBeLessThan(seen.indexOf('removeLocation'));
    });

    test('T12 — Empty-lane drag selects time', async ({ page }) => {
        await openPaperSketch(page);
        const lane = (await lanes(page).nth(2).boundingBox())!;

        await dragBy(page, { x: lane.x + 40, y: lane.y + lane.height / 2 }, 220);

        const selection = await selectionOf(page);
        expect(selection.timeRange, 'an empty-lane drag is a TIME range').not.toBeNull();
        expect(selection.clipIds).toEqual([]);
        await expect(page.locator('.arrangement-range-selection')).toBeVisible();
    });

    test('T13 — Alt+drag on empty = marquee', async ({ page }) => {
        await openPaperSketch(page);
        const metrics = await fieldMetrics(page);
        const lane1 = (await lanes(page).nth(1).boundingBox())!;
        const lane2 = (await lanes(page).nth(2).boundingBox())!;
        // Press in the genuinely empty right half of the Lead lane and sweep
        // back over the two clips that live under it.
        const from = { x: tickToX(metrics, 58_000), y: lane2.y + lane2.height / 2 };
        const to = { x: tickToX(metrics, 12_000), y: lane1.y + lane1.height / 2 };

        await dragBy(page, from, to.x - from.x, to.y - from.y, { modifiers: ['Alt'], steps: 14 });

        const selection = await selectionOf(page);
        expect(selection.clipIds.length).toBe(2);
        expect(selection.timeRange).toBeNull();
    });

    test('T14 — Draw a clip', async ({ page }) => {
        await openPaperSketch(page);
        await focusArrangement(page);
        await page.keyboard.press('b');
        const metrics = await fieldMetrics(page);
        const lane = (await lanes(page).nth(2).boundingBox())!;
        const before = await clipCount(page);
        const sourcesBefore = Object.keys(((await snapshot(page)) as { sources?: object }).sources ?? {}).length;

        const x = tickToX(metrics, 58_000);
        await dragBy(page, { x, y: lane.y + lane.height / 2 }, Math.round(2 * metrics.pxPerBar), 0, { steps: 10 });

        await expect.poll(() => clipCount(page)).toBe(before + 1);
        expect(Object.keys(((await snapshot(page)) as { sources?: object }).sources ?? {}).length).toBe(sourcesBefore + 1);

        await focusArrangement(page);
        await page.keyboard.press('Control+z');
        await expect.poll(() => clipCount(page)).toBe(before);
        expect(Object.keys(((await snapshot(page)) as { sources?: object }).sources ?? {}).length, 'one undo removes BOTH the clip and its minted source').toBe(sourcesBefore);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the selection model
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §5 — selection', () => {
    test('T15 — Selection exclusivity (BC-23)', async ({ page }) => {
        await openPaperSketch(page);
        const lane = (await lanes(page).nth(2).boundingBox())!;
        await dragBy(page, { x: lane.x + 40, y: lane.y + lane.height / 2 }, 220);
        expect((await selectionOf(page)).timeRange).not.toBeNull();

        await clips(page).first().click({ position: { x: 40, y: 34 } });

        const selection = await selectionOf(page);
        expect(selection.timeRange).toBeNull();
        expect(selection.clipIds.length).toBe(1);
    });

    test('T16 — Delete preserves the clipboard (BC-27)', async ({ page }) => {
        await openPaperSketch(page);
        const copied = (await flatClips(page)).find((clip) => clip.id === 't2.c0')!;

        await clips(page).nth(2).click({ position: { x: 30, y: 34 } });
        await focusArrangement(page);
        await page.keyboard.press('Control+c');
        await clips(page).nth(1).click({ position: { x: 30, y: 34 } });
        await page.keyboard.press('Delete');
        await expect.poll(async () => (await flatClips(page)).some((clip) => clip.id === 't1.c0')).toBe(false);
        await page.keyboard.press('Control+v');

        await expect.poll(async () => (await flatClips(page)).filter((clip) => clip.sourceId === copied.sourceId).length)
            .toBeGreaterThan(1);
        const pasted = (await flatClips(page)).filter((clip) => clip.sourceId === copied.sourceId && clip.id !== copied.id);
        expect(pasted.length, 'Delete must not have replaced the copied clip in the cut buffer').toBe(1);
        expect(pasted[0]!.lengthTick).toBe(copied.lengthTick);
    });

    test('T17 — Range delete keeps outside material (BC-25)', async ({ page }) => {
        await openPaperSketch(page);
        const metrics = await fieldMetrics(page);
        const lane1 = (await lanes(page).nth(1).boundingBox())!;
        const lane2 = (await lanes(page).nth(2).boundingBox())!;
        const untouched = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        const fromTick = 2 * metrics.ticksPerBar;
        const toTick = 5 * metrics.ticksPerBar;

        // Press on the empty Lead lane, sweep up into the Bass lane: two tracks.
        await dragBy(
            page,
            { x: tickToX(metrics, fromTick), y: lane2.y + lane2.height / 2 },
            tickToX(metrics, toTick) - tickToX(metrics, fromTick),
            lane1.y + lane1.height / 2 - (lane2.y + lane2.height / 2),
            { steps: 12 },
        );
        const range = (await selectionOf(page)).timeRange;
        expect(range).not.toBeNull();
        expect(range!.trackIds.length).toBe(2);

        await focusArrangement(page);
        await page.keyboard.press('Delete');

        const after = await flatClips(page);
        expect(after.find((clip) => clip.id === untouched.id), 'a track outside the range keeps its clip').toEqual(untouched);
        const bass = after.filter((clip) => clip.trackId === 't1');
        expect(bass.length, 'a clip crossing the range is trimmed, not removed').toBeGreaterThan(0);
        for (const clip of bass) {
            expect(clip.startTick >= range!.toTick || clip.startTick + clip.lengthTick <= range!.fromTick).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the keyboard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §4 — keyboard', () => {
    test('T18 — Space plays from the piano-roll surface', async ({ page }) => {
        await installEngineProbe(page);
        await openPaperSketch(page);
        await openRollSurface(page, clips(page).first());

        await focusRoll(page);
        await page.keyboard.press('Space');

        await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true);
    });

    test('T19 — Level grammar', async ({ page }) => {
        await openPaperSketch(page);
        expect(await visibleSurface(page)).toBe('arrangement');

        // arrangement `E` → the selected MIDI clip's piano roll
        await clips(page).first().click({ position: { x: 40, y: 34 } });
        await focusArrangement(page);
        await page.keyboard.press('e');
        await expect.poll(() => visibleSurface(page)).toBe('pianoroll');

        // `Q` → back out one level, then out again to the canvas
        await focusRoll(page);
        await page.keyboard.press('q');
        await expect.poll(() => visibleSurface(page)).toBe('arrangement');
        await focusArrangement(page);
        await page.keyboard.press('q');
        await expect.poll(() => visibleSurface(page)).toBe('canvas');
    });

    /**
     * The fourth rung of §4's ladder — `E` on the canvas over a selected Song
     * node — in the state a first run actually lands in: a rig installed, so a
     * keyboard mode is live and the computer-keyboard note row (`ROW_KEYS[1]` is
     * `q w e r t y u i o p`) is armed. That row used to be registered BEFORE the
     * canvas actions in the same binding set and consumed the key
     * unconditionally, so `canvas.enterNode` never ran (finding F2).
     *
     * W6-T lifted `canvas.enterNode` / `canvas.exitLevel` above the row and made
     * them fall through when they have nowhere to go, so `E` with nothing
     * selected is still the note E. Both halves are pinned in
     * `src/components/__tests__/canvasLevelGrammar.test.tsx`.
     */
    test('T19b — Level grammar: canvas E enters the selected Song node', async ({ page }) => {
        await openSongRig(page);
        expect(await visibleSurface(page)).toBe('canvas');
        await page.locator('.song-node').click({ position: { x: 40, y: 10 } });
        await expect(page.locator('.song-node')).toHaveClass(/is-selected/);
        await page.keyboard.press('e');
        await expect.poll(() => visibleSurface(page)).toBe('arrangement');
    });

    test('T20 — Text-field guard', async ({ page }) => {
        await openPaperSketch(page);
        await clips(page).first().click({ position: { x: 40, y: 34 } });
        const cursor = await historyLength(page);
        const before = await clipCount(page);

        await page.locator('.arrangement-track__name').first().dblclick();
        const input = page.locator('.arrangement-track__rename');
        await expect(input).toBeVisible();
        await input.press('s');
        await input.press('s');
        await input.press('s');

        expect(await clipCount(page), '`s` in a text field must not split').toBe(before);
        expect(await historyLength(page)).toBe(cursor);
        await input.press('Escape');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §6 — navigation', () => {
    test('T21 — Ctrl+wheel zooms around the cursor', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 3);
        const probeX = 600;
        const tickUnder = async () => {
            const metrics = await fieldMetrics(page);
            return (probeX - metrics.headerRight + metrics.scrollLeft) / metrics.pxPerTick;
        };
        const before = await tickUnder();
        const scaleBefore = (await fieldMetrics(page)).pxPerTick;

        await page.mouse.move(probeX, 400);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -300);
        await page.keyboard.up('Control');
        await expect.poll(async () => (await fieldMetrics(page)).pxPerTick).not.toBe(scaleBefore);
        // The scale and the scroll offset land on different frames. Reading
        // between them pairs the new pxPerTick with the old scrollLeft and
        // reports a 329px miss on a surface that anchors to 0.15px.
        await settleField(page);

        const after = await tickUnder();
        const metrics = await fieldMetrics(page);
        expect(Math.abs(after - before) * metrics.pxPerTick, 'the tick under the pointer stays put').toBeLessThanOrEqual(1);
    });

    test('T22 — Wheel scrolls the piano roll', async ({ page }) => {
        await openPaperSketch(page);
        await openInlineRoll(page, clips(page).first());
        const roll = page.locator('.piano-roll--inline');
        await page.locator('[data-surface-root="arrangement"] .piano-roll--inline').click({ position: { x: 200, y: 60 } });
        await focusArrangement(page);

        // Select every note in the clip, then scroll with a plain wheel.
        await roll.click({ position: { x: 8, y: 8 } });
        await page.keyboard.press('Control+a');
        const velocitiesBefore = (await notesOfClip(page, 't0.c0')).map((note) => note.vel ?? 96);
        const scrollTop = () => page.evaluate(() => document.querySelector('.arrangement-scroll')!.scrollTop);
        const beforeScroll = await scrollTop();

        const box = (await roll.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 240);

        await expect.poll(scrollTop).not.toBe(beforeScroll);
        expect((await notesOfClip(page, 't0.c0')).map((note) => note.vel ?? 96)).toEqual(velocitiesBefore);
    });

    test('T23 — Follow-playhead disarms on touch', async ({ page }) => {
        await installEngineProbe(page, { samplesPerFrame: 9_600 });
        await openPaperSketch(page);
        await zoomIn(page, 5);
        const scrollLeft = () => page.evaluate(() => document.querySelector('.arrangement-scroll')!.scrollLeft);

        await focusArrangement(page);
        await page.keyboard.press('Space');
        await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true);
        await expect.poll(scrollLeft, { timeout: 15_000 }).toBeGreaterThan(0);

        // Press clear of the field's own 28px edge band — a pointer parked in it
        // legitimately auto-scrolls, which would measure the wrong law — and read
        // the origin AFTER the press, so the sample and the gesture are one
        // instant apart rather than one follow-frame apart.
        const metrics = await fieldMetrics(page);
        const box = (await clips(page).first().boundingBox())!;
        const grab = { x: Math.max(box.x + 24, metrics.headerRight + 60), y: box.y + box.height / 2 };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        const at = await scrollLeft();
        await page.mouse.move(grab.x + 10, grab.y, { steps: 3 });
        await page.mouse.move(grab.x + 40, grab.y, { steps: 9 });
        await page.waitForTimeout(400);
        const during = await scrollLeft();
        await page.mouse.up();

        expect(during, 'nothing moves under the cursor mid-gesture').toBe(at);
        await expect(page.locator('.arrangement-follow')).toHaveAttribute('aria-pressed', 'false');
    });

    test('T24 — Pixel-lock', async ({ page }) => {
        await openPaperSketch(page);
        const barTickX = async (bar: number) => page.evaluate((label) => {
            const mark = [...document.querySelectorAll<HTMLElement>('.oj-time-ruler__mark')]
                .find((element) => element.textContent?.trim() === label);
            return mark ? mark.getBoundingClientRect().left : null;
        }, String(bar));

        for (const zoomSteps of [0, 2, 4]) {
            if (zoomSteps) await zoomIn(page, 2);
            const clipLeft = (await clips(page).nth(1).boundingBox())!.x;
            const tick = await barTickX(3);
            expect(tick, 'bar 3 must have a ruler tick').not.toBeNull();
            expect(Math.abs(tick! - clipLeft), `bar 3 tick vs the clip edge that starts on it at zoom step ${zoomSteps}`).toBeLessThanOrEqual(1);
        }
    });

    test('T25 — Virtualization', async ({ page }) => {
        const errors = collectPageErrors(page);
        await loadFixture(page, 'hundredTracks');
        await page.evaluate(() => {
            const scroll = document.querySelector<HTMLElement>('.arrangement-scroll')!;
            scroll.scrollTop = scroll.scrollHeight / 2;
        });
        await page.waitForTimeout(400);

        const measured = await page.evaluate(() => {
            const scroll = document.querySelector<HTMLElement>('.arrangement-scroll')!;
            const lane = document.querySelector<HTMLElement>('.arrangement-lane');
            const laneHeight = lane ? lane.getBoundingClientRect().height : 72;
            return { mounted: document.querySelectorAll('.arrangement-track').length, viewportLanes: Math.ceil(scroll.clientHeight / laneHeight) };
        });
        expect(measured.mounted).toBeLessThanOrEqual(measured.viewportLanes + 4);
        expect(errors).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — transport and time
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §7 — transport', () => {
    /**
     * The auto-stop is a WALL-CLOCK timer, not an engine-frame count:
     * `startPreview` arms `setTimeout(onEnd, remainSec * 1000 + 80)`. A faster
     * stub engine therefore cannot shorten this — only starting nearer the end
     * can. So park the playhead at 92% of the song and let the real clock run
     * out; measured ≈5.8s, against the ~45s a play from bar 1 would take.
     */
    test('T26 — Honest stop at the end', async ({ page }) => {
        const errors = collectPageErrors(page);
        await installEngineProbe(page, { samplesPerFrame: 9_600 });
        await openPaperSketch(page);

        const metrics = await fieldMetrics(page);
        const ruler = page.locator('.arrangement-ruler-viewport');
        const rulerBox = (await ruler.boundingBox())!;
        const nearTheEnd = Math.round((await songEndTick(page)) * 0.92);
        await ruler.click({ position: { x: tickToX(metrics, nearTheEnd) - rulerBox.x, y: 50 } });

        await focusArrangement(page);
        await page.keyboard.press('Space');
        await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true);

        await expect.poll(() => isPlaying(page), { timeout: 30_000 }).toBe(false);
        await expect(page.locator('.arrangement-sky__alert')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    /**
     * §7's "stop twice and you are back where you started", driven on the pill.
     *
     * `arrangementStore.stop()` always carried the behaviour; every caller asked
     * one question too few (`if (isPlaying) stop() else play()`), so the second
     * press played (finding F1). W6-T made the gesture the three-state grammar
     * §7 describes — rolling → Stop, stopped away from the origin → the second
     * Stop, otherwise → Play — through one shared predicate
     * (`stopReturnsToOrigin`) that the pill's glyph reads too, so the button
     * shows a Return arrow rather than a play triangle that would not play. That
     * is why `isPlaying()` (aria-label === 'Stop') still reads false between the
     * two clicks. Pinned in `src/store/__tests__/transportGesture.test.ts`.
     */
    test('T27 — Double-stop returns', async ({ page }) => {
        await installEngineProbe(page, { samplesPerFrame: 9_600 });
        await openPaperSketch(page);
        const ruler = page.locator('.arrangement-ruler-viewport');
        const rulerBox = (await ruler.boundingBox())!;
        const metrics = await fieldMetrics(page);
        await ruler.click({ position: { x: tickToX(metrics, 4 * metrics.ticksPerBar) - rulerBox.x, y: 50 } });
        const origin = await playheadDisplay(page);

        await focusArrangement(page);
        await page.keyboard.press('Space');
        await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => playheadDisplay(page), { timeout: 10_000 }).not.toBe(origin);

        await playButton(page).click();
        await expect.poll(() => isPlaying(page)).toBe(false);
        const frozen = await playheadDisplay(page);
        expect(frozen, 'the first Stop freezes the playhead where it is').not.toBe(origin);

        await playButton(page).click();
        await expect.poll(() => playheadDisplay(page), { timeout: 10_000 }).toBe(origin);
    });

    test('T28 — Tempo scrub = one verb', async ({ page }) => {
        await openPaperSketch(page);
        const tempo = page.locator('.oj-transport__tempo');
        const box = (await tempo.boundingBox())!;

        await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 40, 0, { steps: 12 });

        const setTempos = (await verbLogOf(page)).filter((entry) => entry.verb.kind === 'setTempo');
        expect(setTempos.length).toBe(1);
        const bpm = ((await snapshot(page)) as { tempoBpm: number }).tempoBpm;
        expect(bpm).toBeGreaterThanOrEqual(20);
        expect(bpm).toBeLessThanOrEqual(300);
    });

    test('T29 — Record needs an arm', async ({ page }) => {
        await openPaperSketch(page);
        const record = page.locator('.oj-transport__record');

        await expect(record).toBeDisabled();
        await expect(record).toHaveAttribute('title', /arm a track first/i);
        await record.click({ force: true });

        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — feedback and states
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §8 — feedback', () => {
    test('T30 — Edit while playing holds the sound', async ({ page }) => {
        const errors = collectPageErrors(page);
        await installEngineProbe(page, { samplesPerFrame: 9_600 });
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await focusArrangement(page);
        await page.keyboard.press('Space');
        await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true);

        const at = await playheadDisplay(page);
        await dragClip(page, clips(page).first(), 60, 0, { hold: true, dwell: 300 });
        expect(await isPlaying(page), 'a held note beats a glitch: the transport does not stop for an edit').toBe(true);
        await releaseDrag(page);

        expect(await isPlaying(page)).toBe(true);
        await expect.poll(() => playheadDisplay(page), { timeout: 10_000 }).not.toBe(at);
        expect(errors).toEqual([]);
    });

    test('T31 — Reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPaperSketch(page);

        const motion = await page.evaluate(() => {
            const running = (element: Element | null) => {
                if (!element) return null;
                const style = getComputedStyle(element);
                return { name: style.animationName, duration: style.animationDuration };
            };
            return {
                play: running(document.querySelector('.oj-transport__play')),
                dot: running(document.querySelector('.oj-transport__record-dot')),
                snap: running(document.querySelector('.arrangement-snap-indicator')),
            };
        });
        expect(motion.play, 'the attention pulse is a static ring under reduced motion').toBeTruthy();
        expect(motion.play!.name === 'none' || motion.play!.duration === '0s').toBe(true);
        if (motion.dot) expect(motion.dot.name === 'none' || motion.dot.duration === '0s').toBe(true);
    });

    test('T32 — Empty state paths', async ({ page }) => {
        await bootApp(page);
        await tabToOtherSurface(page);
        await expect(page.getByRole('heading', { name: 'An empty page.' })).toBeVisible();

        for (const name of [/Start from .Paper Sketch./i, /Start from .First Light./i, /^Record something$/, /^Draw a clip$/]) {
            await expect(page.getByRole('button', { name })).toBeVisible();
        }
        await expect(page.getByRole('button', { name: /Add an empty track/i })).toBeVisible();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the piano roll
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §9 — piano roll', () => {
    test('T33 — Draw + overlap is one batch (BC-30 / BC-34)', async ({ page }) => {
        await openPaperSketch(page);
        await openRollSurface(page, clips(page).first());
        const roll = page.locator('[data-surface-root="pianoroll"]');
        const before = await notesOfClip(page, 't0.c0');
        const cursor = await historyLength(page);

        /*
         * Widen first, through the roll's own zoom (HA-18's `− +` pair).
         *
         * This test draws at the MIDDLE of an existing note, and `snapTimeline`
         * pulls to a note anchor within 18px. So the gesture only means "draw on
         * top of a note" while the note is wider than ~36px — below that the
         * midpoint is inside the start anchor's radius, the snapped tick lands on
         * the note's own tick, and BC-30 correctly refuses an exact duplicate
         * with zero verbs. It used to pass on a 4.8px note by aiming 6px in,
         * which is PAST the note: the end anchor, not the middle. Now that the
         * surface opens fitted (F4) that accident is gone, so the test asks for
         * the width it actually needs instead of inheriting one.
         */
        const zoomIn = roll.getByRole('group', { name: 'Zoom the piano roll' }).getByRole('button', { name: 'Zoom the piano roll in' });
        const target = roll.locator(`.piano-roll-note[data-note-id="${before[0]!.id}"]`);
        for (let attempt = 0; attempt < 8 && ((await target.boundingBox())?.width ?? 0) < 40; attempt += 1) await zoomIn.click();
        const box = (await target.boundingBox())!;
        expect(box.width, 'the note is wide enough for its middle to be its middle').toBeGreaterThan(36);
        await roll.locator('.piano-roll__field').first().dispatchEvent('dblclick', {
            bubbles: true,
            clientX: box.x + Math.max(6, box.width / 2),
            clientY: box.y + box.height / 2,
        });

        await expect.poll(() => historyLength(page)).toBe(cursor + 1);
        const after = await notesOfClip(page, 't0.c0');
        expect(after.length, 'the overlap resolves in the same batch that drew the note').toBeGreaterThan(before.length);
        const survivor = after.find((note) => note.id === before[0]!.id);
        expect(survivor, 'the existing note is truncated, not duplicated or deleted').toBeTruthy();

        await focusRoll(page);
        await page.keyboard.press('Control+z');
        await expect.poll(async () => JSON.stringify(await notesOfClip(page, 't0.c0'))).toBe(JSON.stringify(before));
    });

    test('T34 — Multi-note move is one clamped delta (BC-31)', async ({ page }) => {
        await openPaperSketch(page);
        await openRollSurface(page, clips(page).first());
        const roll = page.locator('[data-surface-root="pianoroll"]');
        await focusRoll(page);
        await page.keyboard.press('Control+a');
        const before = await notesOfClip(page, 't0.c0');
        const intervals = before.map((note) => note.pitch - before[0]!.pitch);

        // Drag the whole selection far below the bottom of the pitch range.
        const lowest = [...before].sort((a, b) => a.pitch - b.pitch)[0]!;
        const handle = roll.locator(`.piano-roll-note[data-note-id="${lowest.id}"]`);
        const box = (await handle.boundingBox())!;
        await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 0, 900, { steps: 16 });

        const after = await notesOfClip(page, 't0.c0');
        const orderedAfter = before.map((note) => after.find((item) => item.id === note.id)!);
        expect(orderedAfter.every(Boolean)).toBe(true);
        expect(orderedAfter.map((note) => note.pitch - orderedAfter[0]!.pitch), 'every interval survives one clamped delta').toEqual(intervals);
    });

    test('T35 — Velocity / transpose reject wholly (BC-33 / BC-35)', async ({ page }) => {
        await openPaperSketch(page);
        await openRollSurface(page, clips(page).first());
        await focusRoll(page);
        await page.keyboard.press('Control+a');

        // Velocity, all the way past 127.
        for (let press = 0; press < 16; press += 1) {
            const before = (await notesOfClip(page, 't0.c0')).map((note) => note.vel ?? 96);
            await page.keyboard.press('Control+ArrowUp');
            const after = (await notesOfClip(page, 't0.c0')).map((note) => note.vel ?? 96);
            const changed = after.filter((value, index) => value !== before[index]).length;
            expect(changed === 0 || changed === before.length, 'velocity is all-or-nothing').toBe(true);
        }

        // Transpose by octaves, all the way past pitch 127.
        for (let press = 0; press < 12; press += 1) {
            const before = (await notesOfClip(page, 't0.c0')).map((note) => note.pitch);
            await page.keyboard.press('Alt+ArrowUp');
            const after = (await notesOfClip(page, 't0.c0')).map((note) => note.pitch);
            const changed = after.filter((value, index) => value !== before[index]).length;
            expect(changed === 0 || changed === before.length, 'transpose is all-or-nothing').toBe(true);
        }
    });

    test('T36 — Quantize (BC-37)', async ({ page }) => {
        await openPaperSketch(page);
        await openRollSurface(page, clips(page).first());
        const roll = page.locator('[data-surface-root="pianoroll"]');

        // Turn the magnet off and draw a deliberately off-grid note.
        await page.getByRole('button', { name: 'Snap to grid' }).click();
        const field = roll.locator('.piano-roll__field').first();
        const box = (await field.boundingBox())!;
        await field.dispatchEvent('dblclick', { bubbles: true, clientX: box.x + 137, clientY: box.y + 41 });
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).length).toBeGreaterThan(0);

        await focusRoll(page);
        await page.keyboard.press('Control+a');
        const before = await notesOfClip(page, 't0.c0');
        const cursor = await historyLength(page);
        await page.keyboard.press('Control+q');

        await expect.poll(() => historyLength(page)).toBe(cursor + 1);
        const after = await notesOfClip(page, 't0.c0');
        expect(after.length).toBe(before.length);
        const grid = 240; // the roll's own quantize grid chip default
        expect(after.every((note) => note.tick % grid === 0), 'every onset lands on the grid').toBe(true);

        await page.keyboard.press('Control+z');
        await expect.poll(async () => JSON.stringify(await notesOfClip(page, 't0.c0'))).toBe(JSON.stringify(before));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 / §2 — parity, replay, contrast, tokens, ladder
//
// These five are named in §11 but are NOT e2e items: they are gates over pure
// functions, CSS files and one existing journey. Duplicating them here would
// fork the gate — the covenant's "extend, never fork a parallel version".
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E §10/§2 — gates owned elsewhere', () => {
    test.skip('T37 — Agent parity', async () => {
        // Owner: src/ai/__tests__/piToolParity.test.ts — asserts every advertised
        // gesture has a matching EDIT_OPS / verb payload. Run with `bun run test:run`.
    });

    test.skip('T38 — Verb replay convergence', async () => {
        // Owner: e2e/journeys/J3-editors-hour.spec.ts, which replays verbLog()
        // onto the fixture and compares byte-for-byte. §11 itself says
        // "already asserted; keep as the regression gate".
    });

    test.skip('T40 — Contrast floors', async () => {
        // Owner: src/components/Arrangement/__tests__/contrast.test.ts (light AND
        // dark, token-resolved). A screenshot-based copy here would measure the
        // same numbers less precisely.
    });

    test.skip('T41 — Token purity', async () => {
        // Owner: src/components/Arrangement/__tests__/tokenLiteralGate.test.ts.
    });

    test.skip('T42 — Ruler ladder', async () => {
        // Owner: src/song/__tests__/rulerMarks.test.ts (getGridLadder strides) and
        // src/components/Arrangement/__tests__/rulerStack.test.tsx.
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 / §2 / §1 — touch, teardown, nested transactions
// ─────────────────────────────────────────────────────────────────────────────

test.describe('W6-E2E — touch parity', () => {
    test.use({ hasTouch: true });

    /**
     * A finger moves a clip, and moving it does not scroll the field.
     *
     * Nothing in the timeline field used to declare `touch-action`, so
     * `.arrangement-clip` computed `auto` inside `.arrangement-scroll`
     * (`overflow: auto`) and the moment a touch drag crossed Chromium's slop the
     * compositor claimed it as a scroll: pointerdown → `is-dragging` →
     * pointercancel → the app correctly restored the pre-gesture document and
     * the clip never moved (finding F3). W6-T declared spec §3's split —
     * `touch-action: none` on every grab target, `pan-x pan-y` on the scroller,
     * and deliberately nothing on the lane, so empty ground still pans by touch.
     * The declarations are pinned in
     * `src/components/Arrangement/__tests__/touchAction.test.ts`.
     */
    test('T39 — Touch parity', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const scrollTop = () => page.evaluate(() => document.querySelector('.arrangement-scroll')!.scrollTop);
        const before = (await flatClips(page)).find((clip) => clip.id === 't0.c0')!;
        const beforeScroll = await scrollTop();
        const from = await clipGrabPoint(page, clips(page).first());

        // Playwright's `touchscreen` only taps, so the stream goes through CDP —
        // which produces the same real PointerEvents a finger does.
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
        } as never);
        await touch('touchStart', from.x, from.y);
        for (let step = 1; step <= 10; step += 1) await touch('touchMove', from.x + step * 8, from.y);
        await touch('touchEnd', from.x + 80, from.y);

        await expect.poll(async () => (await flatClips(page)).find((clip) => clip.id === 't0.c0')!.startTick).not.toBe(before.startTick);
        expect(await scrollTop(), 'a clip drag must not scroll the field under the finger').toBe(beforeScroll);
    });
});

test.describe('W6-E2E §1/§2 — teardown and transactions', () => {
    test('T43 — Surface teardown', async ({ page }) => {
        await openPaperSketch(page);
        const arrangement = page.locator('[data-surface-root="arrangement"]');

        await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
        await page.waitForTimeout(300);

        await expect(arrangement).toBeHidden();
        await expect(arrangement).toHaveAttribute('inert');
        await expect(page.locator('[data-surface-root="canvas"]')).toBeVisible();
        await expect(page.locator('[data-surface-root="canvas"]')).not.toHaveAttribute('inert');
    });

    test('T44 — Gesture transaction (BC-01)', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await page.getByTitle('Open mixer').click();
        const fader = page.locator('.mixer-strip').first().getByRole('slider', { name: /gain/i });
        await expect(fader).toBeVisible();

        const before = await documentJson(page);
        const cursor = await historyLength(page);
        const faderBox = (await fader.boundingBox())!;

        // Outer gesture: the mouse holds a clip. Inner gesture: a real second
        // pointer (touch, through CDP) works the fader while the clip is held.
        await dragClip(page, clips(page).first(), 60, 0, { hold: true, dwell: 150 });
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: string, y: number) => cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x: faderBox.x + faderBox.width / 2, y, id: 2, radiusX: 6, radiusY: 6, force: 1 }],
        } as never);
        await touch('touchStart', faderBox.y + faderBox.height * 0.75);
        await touch('touchMove', faderBox.y + faderBox.height * 0.4);
        await touch('touchEnd', faderBox.y + faderBox.height * 0.4);

        // Abort the whole nest.
        await page.keyboard.press('Escape');
        await releaseDrag(page);

        expect(await historyLength(page), 'the abort leaves the cursor where it was').toBe(cursor);
        await expect.poll(() => documentJson(page)).toBe(before);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// W6 extras — the redesign behaviours the orchestrator named that §11's table
// does not number: the overlay pane, edge auto-scroll, the two view-state
// handles, the sky band's reserve, the inline roll, and the agent queue.
// ─────────────────────────────────────────────────────────────────────────────

/*
 * U11 / HA-13 — the tools that shipped.
 *
 * `X` was a rendered, enabled button in the ruler corner that did nothing when
 * clicked, and `K` was a binding with no behaviour and no button, on BOTH
 * surfaces. These four drive the shipped BUTTONS (not the keys) precisely
 * because "the affordance answered the click" is the thing that was broken, and
 * they assert the §1 law each tool has to obey: one gesture, one Ctrl+Z.
 */
test.describe('W6-E2E §3 — Erase and Knife (U11)', () => {
    /** Arm a tool from the Song's own strip, the way a hand does. */
    async function armSongTool(page: Page, name: 'Erase tool' | 'Knife tool'): Promise<void> {
        const strip = page.getByRole('group', { name: 'Tool — Song' });
        await strip.getByRole('button', { name }).click();
        await expect(strip.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }

    test('T45 — Erase deletes the clip it is clicked on, in one undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const before = await documentJson(page);
        const count = await clipCount(page);
        const cursor = await historyLength(page);

        await armSongTool(page, 'Erase tool');
        const point = await clipGrabPoint(page, clips(page).first(), 40);
        await page.mouse.click(point.x, point.y);

        await expect.poll(() => clipCount(page)).toBe(count - 1);
        await expect.poll(() => historyLength(page)).toBe(cursor + 1);

        await focusArrangement(page);
        await page.keyboard.press('Control+z');
        await expect.poll(() => documentJson(page)).toBe(before);
    });

    test('T46 — Knife splits the clip at the pointer, in one undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await setGridUnit(page, 'bar');
        const before = await flatClips(page);
        const count = await clipCount(page);
        const cursor = await historyLength(page);

        const cut = before[0]!;
        await armSongTool(page, 'Knife tool');
        const box = (await clips(page).first().boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        await expect.poll(() => clipCount(page)).toBe(count + 1);
        await expect.poll(() => historyLength(page)).toBe(cursor + 1);
        // Two abutting halves ON THAT TRACK, no gap and no overlap, spanning
        // exactly what the one clip spanned. (Sorting every clip in the document
        // by tick would compare clips on different tracks, which abut nothing.)
        const onTrack = (await flatClips(page)).filter((clip) => clip.trackId === cut.trackId).sort((a, b) => a.startTick - b.startTick);
        expect(onTrack).toHaveLength(2);
        expect(onTrack[0]!.startTick).toBe(cut.startTick);
        expect(onTrack[1]!.startTick).toBe(onTrack[0]!.startTick + onTrack[0]!.lengthTick);
        expect(onTrack[0]!.lengthTick + onTrack[1]!.lengthTick).toBe(cut.lengthTick);

        await focusArrangement(page);
        await page.keyboard.press('Control+z');
        // The CLIPS, not `documentJson`: a cut mints two ids, so the document's
        // `idCounter` legitimately moves and never comes back. Ids are minted
        // monotonically on purpose (a re-used id is a far worse bug than a gap),
        // so the undo contract is about the material, not the counter.
        await expect.poll(() => flatClips(page)).toEqual(before);
    });

    test('T47 — Erase deletes the note it is clicked on, in one undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await openRollSurface(page, clips(page).first());
        const clipId = (await flatClips(page))[0]!.id!;
        const before = await documentJson(page);
        const count = (await notesOfClip(page, clipId)).length;
        const cursor = await historyLength(page);

        await page.getByRole('group', { name: 'Tool — piano roll' }).getByRole('button', { name: 'Erase tool' }).click();
        const note = page.locator('[data-surface-root="pianoroll"] .piano-roll-note[data-note-id]').first();
        await note.click({ position: { x: 2, y: 2 } });

        await expect.poll(() => notesOfClip(page, clipId).then((notes) => notes.length)).toBe(count - 1);
        await expect.poll(() => historyLength(page)).toBe(cursor + 1);

        await focusRoll(page);
        await page.keyboard.press('Control+z');
        await expect.poll(() => documentJson(page)).toBe(before);
    });

    test('T48 — Knife splits the note at the pointer, in one undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await openRollSurface(page, clips(page).first());
        const clipId = (await flatClips(page))[0]!.id!;
        const before = await notesOfClip(page, clipId);
        const count = before.length;
        const cursor = await historyLength(page);

        await page.getByRole('group', { name: 'Tool — piano roll' }).getByRole('button', { name: 'Knife tool' }).click();
        // Widen the note first: a cut needs somewhere to land that is not an
        // edge, and the roll's own zoom is the affordance that makes it possible
        // (HA-18).
        const zoom = page.getByRole('group', { name: 'Zoom the piano roll' }).getByRole('button', { name: 'Zoom the piano roll in' });
        await zoom.click();
        await zoom.click();
        const note = page.locator('[data-surface-root="pianoroll"] .piano-roll-note[data-note-id]').first();
        const box = (await note.boundingBox())!;
        // `Ctrl` suspends the snap, exactly as it does for every other gesture on
        // these surfaces. Without it a note that is EXACTLY one grid unit long
        // can only be cut on its own edges, and the roll says so rather than
        // pretending — see the status line this same tool writes.
        //
        // Held on the KEYBOARD rather than passed as `mouse.click({ modifiers })`:
        // the option sets the modifier on the synthesized click, but the tool
        // presses on `pointerdown`, which arrives without it (verified in the
        // browser — the cut is refused and the roll reports the grid).
        await page.keyboard.down('Control');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.up('Control');

        await expect.poll(() => notesOfClip(page, clipId).then((notes) => notes.length)).toBe(count + 1);
        await expect.poll(() => historyLength(page)).toBe(cursor + 1);

        await focusRoll(page);
        await page.keyboard.press('Control+z');
        await expect.poll(() => notesOfClip(page, clipId)).toEqual(before);
    });

    /*
     * F1 — the lane is a real second viewport, measured with real layout.
     *
     * The unit test pins that the two playheads mark the same TICK; only a
     * browser can say whether the lane's scroller actually reaches the notes.
     * Before this, the lane drew 3 264px of content inside a 1 184px box with
     * `overflow: hidden` — 51 of 128 notes with no way to reach them.
     */
    test('T50 — the inline lane scrolls its own axis, and reaches every note', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await openInlineRoll(page, clips(page).first());

        const lane = await page.evaluate(() => {
            const field = document.querySelector<HTMLElement>('.piano-roll--inline .piano-roll__field')!;
            const content = document.querySelector<HTMLElement>('.piano-roll--inline .piano-roll__content')!;
            return {
                scrollWidth: field.scrollWidth,
                clientWidth: field.clientWidth,
                contentWidth: Math.round(Number.parseFloat(content.style.width)),
                overflowX: getComputedStyle(field).overflowX,
                barMarks: document.querySelectorAll('.piano-roll--inline .piano-roll__lane-ruler i').length,
                notes: document.querySelectorAll('.piano-roll--inline .piano-roll-note[data-note-id]').length,
            };
        });

        // The scroller IS the content: nothing is clipped away with no way out.
        // Within a pixel, because the closing bar line is 1px wide and sits ON
        // the content's right edge; before the grid was clamped it overshot by
        // 181px, a full bar of empty ruled space to scroll into.
        expect(lane.overflowX).toBe('auto');
        expect(Math.abs(lane.scrollWidth - lane.contentWidth)).toBeLessThanOrEqual(1);
        expect(lane.scrollWidth).toBeGreaterThan(lane.clientWidth);
        expect(lane.barMarks, 'the lane carries its own bar strip').toBeGreaterThan(1);

        // And scrolling to the end really does bring the last note on screen.
        await page.evaluate(() => {
            const field = document.querySelector<HTMLElement>('.piano-roll--inline .piano-roll__field')!;
            field.scrollLeft = field.scrollWidth;
        });
        await page.waitForTimeout(120);
        const visible = await page.evaluate(() => {
            const field = document.querySelector<HTMLElement>('.piano-roll--inline .piano-roll__field')!;
            const box = field.getBoundingClientRect();
            const notes = [...document.querySelectorAll<HTMLElement>('.piano-roll--inline .piano-roll-note[data-note-id]')];
            const onScreen = notes.filter((note) => {
                const rect = note.getBoundingClientRect();
                return rect.right > box.left && rect.left < box.right;
            });
            const last = notes.at(-1)!.getBoundingClientRect();
            return { onScreen: onScreen.length, lastVisible: last.right > box.left && last.left < box.right };
        });
        expect(visible.onScreen).toBeGreaterThan(0);
        expect(visible.lastVisible, 'the end of the clip is reachable').toBe(true);
    });

    /*
     * Two viewports are honest when they disagree about PIXELS and agree about
     * TIME. Both axes below are read out of the DOM — the clip's own width for
     * the Song, the lane strip's bar spacing for the lane — so nothing here
     * trusts a number the app also computed for itself.
     */
    test('T51 — both playheads mark the same tick, on axes that differ', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await openInlineRoll(page, clips(page).first());
        const ruler = page.locator('.arrangement-ruler-viewport');
        const rulerBox = (await ruler.boundingBox())!;

        const axes = await page.evaluate(() => {
            const marks = [...document.querySelectorAll<HTMLElement>('.piano-roll--inline .piano-roll__lane-ruler i')];
            return {
                markStride: Number(marks[1]!.textContent) - Number(marks[0]!.textContent),
                markGap: Number.parseFloat(marks[1]!.style.left) - Number.parseFloat(marks[0]!.style.left),
            };
        });
        // The Song's axis through the shipped helper — it matches the rendered
        // clip by id, which matters here because the lane the roll is open in
        // renders no clips at all.
        const songMetrics = await fieldMetrics(page);
        const songPxPerTick = songMetrics.pxPerTick;
        const lanePxPerTick = axes.markGap / (axes.markStride * songMetrics.ticksPerBar);
        // The premise: the axes really do differ, or this asserts nothing.
        expect(lanePxPerTick / songPxPerTick).toBeGreaterThan(2);

        const readTicks = () => page.evaluate(() => {
            const px = (element: Element | null) => Number.parseFloat(/translate(?:X|3d)?\(([-\d.]+)px/.exec((element as HTMLElement | null)?.style.transform ?? '')?.[1] ?? 'NaN');
            return {
                song: px(document.querySelector('.arrangement-playhead')),
                lane: px(document.querySelector('.piano-roll--inline .piano-roll__playhead')),
            };
        });

        for (const bar of [0, 4, 9]) {
            const metrics = await fieldMetrics(page);
            await ruler.click({ position: { x: tickToX(metrics, bar * metrics.ticksPerBar) - rulerBox.x, y: 50 } });
            await page.waitForTimeout(150);
            const pixels = await readTicks();
            expect(Number.isNaN(pixels.song), `bar ${bar}: the Song draws a playhead`).toBe(false);
            expect(Number.isNaN(pixels.lane), `bar ${bar}: the lane draws its own`).toBe(false);
            expect(pixels.lane / lanePxPerTick, `bar ${bar}: same tick, different pixels`)
                .toBeCloseTo(pixels.song / songPxPerTick, 0);
        }
    });

    test('T49 — one tool strip at a time (HA-22)', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        /*
         * The shell keeps every surface MOUNTED and hides the inactive ones
         * (`hidden` + `inert` + `aria-hidden`), so "on screen" has to mean
         * inside the surface that is showing — a `document.querySelectorAll`
         * over the whole page counts chrome the player cannot see or reach.
         */
        const strips = () => page.evaluate(() => {
            const shown = document.querySelector('[data-surface-root]:not([hidden])');
            return [...(shown?.querySelectorAll('[role="group"]') ?? [])]
                .map((element) => element.getAttribute('aria-label') ?? '')
                .filter((label) => label.startsWith('Tool'));
        });

        expect(await strips()).toEqual(['Tool — Song']);

        await openInlineRoll(page, clips(page).first());
        expect(await strips(), 'the inline lane adds no second strip').toEqual(['Tool — Song']);

        await openRollSurface(page, clips(page).first());
        expect(await strips(), "the roll surface's corner drops the Song's").toEqual(['Tool — piano roll']);
    });
});

test.describe('W6-E2E extras — redesign behaviours', () => {
    test('X1 — a cross-track drag ghost never paints on the header or the ruler', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        await page.evaluate(() => { document.querySelector<HTMLElement>('.arrangement-scroll')!.scrollLeft = 420; });
        await page.waitForTimeout(300);

        const clip = clips(page).nth(1);
        const from = await clipGrabPoint(page, clip, 60);
        // Up a lane and back toward the header, but stopping well clear of the
        // 28px edge band so the field's own auto-scroll does not undo the setup.
        await dragBy(page, from, 300 - from.x, -70, { steps: 14, hold: true, dwell: 250 });

        const overlap = await page.evaluate(() => {
            const box = (element: Element | null) => {
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            };
            const area = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => (a && b
                ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
                : 0);
            // getBoundingClientRect reports the border box; an ancestor's
            // `overflow: hidden` never shows up in it. What may not touch the
            // chrome is the ghost INTERSECTED with its clipping pane.
            const clipTo = (a: ReturnType<typeof box>, pane: ReturnType<typeof box>) => (!a ? null : !pane ? a : {
                left: Math.max(a.left, pane.left), top: Math.max(a.top, pane.top),
                right: Math.min(a.right, pane.right), bottom: Math.min(a.bottom, pane.bottom),
            });
            const pane = box(document.querySelector('[data-field-overlay]'));
            const ghost = clipTo(box(document.querySelector('[data-drag-ghost]')), pane);
            const readout = clipTo(box(document.querySelector('.arrangement-drag-readout')), pane);
            const headers = [...document.querySelectorAll('.arrangement-track__header')].map(box).filter(Boolean) as NonNullable<ReturnType<typeof box>>[];
            const column = headers.length
                ? { left: headers[0]!.left, right: headers[0]!.right, top: Math.min(...headers.map((h) => h.top)), bottom: Math.max(...headers.map((h) => h.bottom)) }
                : null;
            const ruler = box(document.querySelector('.arrangement-ruler-shell'));
            return {
                hasGhost: !!document.querySelector('[data-drag-ghost]'),
                ghostOverHeader: Math.round(area(ghost, column)),
                ghostOverRuler: Math.round(area(ghost, ruler)),
                readoutOverHeader: Math.round(area(readout, column)),
                readoutOverRuler: Math.round(area(readout, ruler)),
            };
        });
        await releaseDrag(page);

        expect(overlap.hasGhost).toBe(true);
        expect(overlap.ghostOverHeader).toBe(0);
        expect(overlap.ghostOverRuler).toBe(0);
        expect(overlap.readoutOverHeader).toBe(0);
        expect(overlap.readoutOverRuler).toBe(0);
    });

    test('X2 — a drag past the right edge auto-scrolls the field', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 5);
        const scrollLeft = () => page.evaluate(() => document.querySelector('.arrangement-scroll')!.scrollLeft);
        const before = await scrollLeft();
        const from = await clipGrabPoint(page, clips(page).first());
        const viewport = page.viewportSize()!;

        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let step = 1; step <= 12; step += 1) {
            await page.mouse.move(Math.min(viewport.width - 5, from.x + step * 40), from.y);
        }
        // The ramp runs only while the pointer MOVES (spec §3, principle 4), so
        // keep jittering at the edge rather than parking there.
        for (let tick = 0; tick < 24; tick += 1) {
            await page.mouse.move(viewport.width - 5 - (tick % 2), from.y);
            await page.waitForTimeout(40);
        }
        const during = await scrollLeft();
        await page.mouse.up();

        expect(during - before, 'the field followed the drag past its right edge').toBeGreaterThan(450);
    });

    test('X3 — lane divider and header-width handles are view state, not history', async ({ page }) => {
        await openPaperSketch(page);
        const laneHeights = () => page.evaluate(() => [...document.querySelectorAll('.arrangement-lane')].map((element) => Math.round(element.getBoundingClientRect().height)));
        const headerWidth = () => page.evaluate(() => Math.round(document.querySelector('.arrangement-track__header')!.getBoundingClientRect().width));
        const cursor = await historyLength(page);
        const original = await laneHeights();

        const grip = (await page.locator('.arrangement-lane__resize').first().boundingBox())!;
        await dragBy(page, { x: grip.x + 600, y: grip.y + 2 }, 0, 60, { steps: 10 });
        const afterOne = await laneHeights();
        expect(afterOne[0]).toBeGreaterThan(original[0]!);
        expect(afterOne.slice(1), 'a plain divider drag resizes ONE lane').toEqual(original.slice(1));

        const gripAgain = (await page.locator('.arrangement-lane__resize').first().boundingBox())!;
        await dragBy(page, { x: gripAgain.x + 600, y: gripAgain.y + 2 }, 0, 40, { steps: 10, modifiers: ['Alt'] });
        const afterAlt = await laneHeights();
        expect(new Set(afterAlt).size, 'Alt resizes EVERY lane to the same height').toBe(1);

        await page.locator('.arrangement-lane__resize').first().dblclick();
        await expect.poll(async () => (await laneHeights())[0]).toBe(72);

        const widthBefore = await headerWidth();
        const handle = (await page.locator('.arrangement-header-resize').boundingBox())!;
        await dragBy(page, { x: handle.x + 3, y: handle.y + 120 }, 80, 0, { steps: 10 });
        await expect.poll(headerWidth).toBeGreaterThan(widthBefore);

        expect(await historyLength(page), 'zoom, lane height and header width are never verbs').toBe(cursor);
    });

    test('X4 — the sky band never occludes the armed edit mode at 1024 or 900', async ({ page }) => {
        await openPaperSketch(page);
        for (const width of [1280, 1024, 900]) {
            await page.setViewportSize({ width, height: 820 });
            await settleField(page);
            const measured = await page.evaluate(() => {
                const box = (element: Element | null) => {
                    if (!element) return null;
                    const rect = element.getBoundingClientRect();
                    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
                };
                const area = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => (a && b
                    ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
                    : 0);
                const pill = box(document.querySelector('.oj-transport'));
                const armed = document.querySelector<HTMLElement>('.arrangement-edit-mode button[aria-pressed="true"]');
                const armedBox = box(armed);
                const topmost = armedBox
                    ? document.elementFromPoint((armedBox.left + armedBox.right) / 2, (armedBox.top + armedBox.bottom) / 2)
                    : null;
                const utility = document.querySelector('.arrangement-sky__utility');
                return {
                    label: armed?.textContent ?? null,
                    overlap: Math.round(area(pill, armedBox)),
                    topmostIsArmed: !!(armed && topmost && (armed === topmost || armed.contains(topmost))),
                    utilityClipped: utility ? utility.scrollWidth > utility.clientWidth + 1 : null,
                };
            });
            expect(measured.label, `an armed edit mode must be readable at ${width}px`).toBeTruthy();
            expect(measured.overlap, `the pill must not overlap the armed mode at ${width}px`).toBe(0);
            expect(measured.topmostIsArmed, `the armed mode must be the topmost element at ${width}px`).toBe(true);
            expect(measured.utilityClipped, `the utility cluster must not be clipped at ${width}px`).toBe(false);
        }
    });

    /**
     * Draw, TRANSPOSE, then move. The order used to be load-bearing: a pointer
     * gesture on a note inside the INLINE roll destroyed the note selection
     * (finding F4, fixed by W6-T and asserted by `X5b` below), so only a freshly
     * drawn note was still selected when the transpose arrived. It is kept as
     * written — three edits, three undo steps, byte-identical restore.
     */
    test('X5 — the inline roll draws, transposes and moves, and Ctrl+Z reaches from inside it', async ({ page }) => {
        await openPaperSketch(page);
        await openInlineRoll(page, clips(page).first());
        const roll = page.locator('.piano-roll--inline');
        const cursor = await historyLength(page);
        const before = await notesOfClip(page, 't0.c0');

        // DRAW. The new note is the selection the next step needs.
        const field = roll.locator('.piano-roll__field').first();
        const box = (await field.boundingBox())!;
        await field.dispatchEvent('dblclick', { bubbles: true, clientX: box.x + 137, clientY: box.y + 9 });
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).length).toBe(before.length + 1);
        const drawn = (await notesOfClip(page, 't0.c0')).find((note) => !before.some((item) => item.id === note.id))!;
        expect((await selectionOf(page)).noteIds, 'drawing a note selects it').toEqual([drawn.id]);

        // TRANSPOSE it with the roll's own binding set.
        await focusRoll(page);
        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).find((item) => item.id === drawn.id)!.pitch).toBe(drawn.pitch + 1);

        // MOVE it with the pointer.
        const note = roll.locator(`.piano-roll-note[data-note-id="${drawn.id}"]`);
        const noteBox = (await note.boundingBox())!;
        await dragBy(page, { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 }, 60, 0, { steps: 10 });
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).find((item) => item.id === drawn.id)!.tick).not.toBe(drawn.tick);

        // UNDO, three times, without ever leaving the roll.
        expect(await historyLength(page), 'draw, transpose and move are three steps').toBe(cursor + 3);
        await focusRoll(page);
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        await expect.poll(async () => JSON.stringify(await notesOfClip(page, 't0.c0'))).toBe(JSON.stringify(before));
    });

    /**
     * Inside the INLINE roll, a pointer on a note leaves it selected — and with
     * it every keyboard note action alive.
     *
     * The roll renders inside `.arrangement-lane`, and the lane's empty-ground
     * gesture excluded `.arrangement-clip` but not the roll, so every press on a
     * note ALSO started the arrangement's range-select: the roll wrote `noteIds`
     * first and the lane overwrote the surface selection last (finding F4). The
     * FULL roll surface was never affected, which was the tell. W6-T gave the
     * lane's guard the roll as well, per §9's "the inline lane and the surface
     * are the same component … it never gets a second interaction model". Pinned
     * in `src/components/Arrangement/__tests__/inlineRollSelection.test.tsx`.
     */
    test('X5b — a pointer gesture on a note keeps it selected in the inline roll', async ({ page }) => {
        await openPaperSketch(page);
        await openInlineRoll(page, clips(page).first());
        const roll = page.locator('.piano-roll--inline');
        const before = await notesOfClip(page, 't0.c0');
        const field = roll.locator('.piano-roll__field').first();
        const box = (await field.boundingBox())!;
        await field.dispatchEvent('dblclick', { bubbles: true, clientX: box.x + 137, clientY: box.y + 9 });
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).length).toBe(before.length + 1);
        const drawn = (await notesOfClip(page, 't0.c0')).find((note) => !before.some((item) => item.id === note.id))!;

        await roll.locator(`.piano-roll-note[data-note-id="${drawn.id}"]`).click();
        expect((await selectionOf(page)).noteIds, 'clicking a note selects it').toEqual([drawn.id]);
        await focusRoll(page);
        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => (await notesOfClip(page, 't0.c0')).find((item) => item.id === drawn.id)!.pitch).toBe(drawn.pitch + 1);

        const noteBox = (await roll.locator(`.piano-roll-note[data-note-id="${drawn.id}"]`).boundingBox())!;
        await dragBy(page, { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 }, 60, 0, { steps: 10 });
        expect((await selectionOf(page)).noteIds, 'dragging a note leaves it selected').toEqual([drawn.id]);
        expect((await selectionOf(page)).timeRange, 'and does not hand the selection to the lane').toBeNull();
    });

    test('X6 — an agent edit that arrives mid-gesture queues, then lands as its own undo', async ({ page }) => {
        await openPaperSketch(page);
        await zoomIn(page, 4);
        const cursor = await historyLength(page);
        await bridge<void>(page, 'setAgentScript', [
            { kind: 'tool-call', id: 'mid-gesture', call: { name: 'edit_timeline', args: { verbs: [{ kind: 'setTempo', tempoBpm: 111 }] } } },
            { kind: 'result', summary: 'Set the tempo.' },
        ]);

        await dragClip(page, clips(page).first(), 60, 0, { hold: true, dwell: 100 });
        await bridge<void>(page, 'sendAgent', 'Set the tempo to 111 while I am dragging.');
        await page.waitForTimeout(300);
        expect(((await snapshot(page)) as { tempoBpm: number }).tempoBpm, 'the agent edit waits for the hand').not.toBe(111);
        expect(await historyLength(page)).toBe(cursor);

        await releaseDrag(page);

        await expect.poll(async () => ((await snapshot(page)) as { tempoBpm: number }).tempoBpm).toBe(111);
        expect(await historyLength(page), 'the gesture and the queued edit are two undo steps').toBe(cursor + 2);
    });

    test('X7 — the loop brace moves and resizes, and Ctrl+M drops a marker at the playhead', async ({ page }) => {
        await openPaperSketch(page);
        const metrics = await fieldMetrics(page);
        const braces = (await page.locator('.arrangement-braces-row').boundingBox())!;
        const y = braces.y + braces.height / 2;
        await dragBy(page, { x: tickToX(metrics, 2 * metrics.ticksPerBar), y }, 4 * metrics.pxPerBar, 0, { steps: 12 });
        const created = (await locationsOf(page)).find((location) => location.kind === 'loop')!;

        const brace = (await page.locator('.arrangement-loop-brace').boundingBox())!;
        await dragBy(page, { x: brace.x + brace.width / 2, y }, Math.round(3 * metrics.pxPerBar), 0, { steps: 12 });
        const moved = (await locationsOf(page)).find((location) => location.kind === 'loop')!;
        expect(moved.startTick).toBeGreaterThan(created.startTick);
        expect(moved.endTick! - moved.startTick, 'moving a brace keeps its length').toBe(created.endTick! - created.startTick);

        const again = (await page.locator('.arrangement-loop-brace').boundingBox())!;
        await dragBy(page, { x: again.x + again.width - 3, y }, Math.round(metrics.pxPerBar), 0, { steps: 10 });
        const resized = (await locationsOf(page)).find((location) => location.kind === 'loop')!;
        expect(resized.startTick).toBe(moved.startTick);
        expect(resized.endTick!).toBeGreaterThan(moved.endTick!);

        const marksBefore = await page.locator('.arrangement-section-chip--mark').count();
        await focusArrangement(page);
        await page.keyboard.press('Control+m');
        await expect(page.locator('.arrangement-section-chip--mark')).toHaveCount(marksBefore + 1);
    });

    test('X8 — a section chip renames in place, in one undo step', async ({ page }) => {
        await openPaperSketch(page);
        const cursor = await historyLength(page);
        const first = page.locator('.arrangement-section-chip:not(.arrangement-section-chip--mark) .arrangement-section-chip__label').first();
        const originalName = (await first.textContent())!.trim();

        await first.dblclick();
        const input = page.locator('input.arrangement-section-chip');
        await expect(input).toBeVisible();
        await input.fill('Chorus');
        await page.keyboard.press('Enter');

        await expect.poll(async () => (await locationsOf(page)).map((location) => location.name)).toContain('Chorus');
        expect(await historyLength(page)).toBe(cursor + 1);

        await focusArrangement(page);
        await page.keyboard.press('Control+z');
        await expect.poll(async () => (await locationsOf(page)).map((location) => location.name)).toContain(originalName);
    });
});
