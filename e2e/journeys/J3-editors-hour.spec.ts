import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildDenseEdit } from '../../src/song/fixtures';
import { normalizeArrangement } from '../../src/song/normalize';
import { applyVerbs, type Verb } from '../../src/song/verbs';
import type { Arrangement } from '../../src/song/types';
import type { EditVerb } from '../../src/store/historyStore';
import { loadFixture, pointerDrag, snapshot } from './support';

type Bridge = { verbLog(): EditVerb[]; history(): { cursor: number; entries: number; scopes: string[] }; selection(): { clipIds: string[] } };

const bridge = (page: Page) => page.evaluate(() => (window as unknown as { __openjammerE2E: Bridge }).__openjammerE2E.verbLog());
const documentClipCount = async (page: Page) => ((await snapshot(page)) as Arrangement).tracks.reduce((sum, track) => sum + track.clips.length, 0);

async function dragEdge(page: Page, clip: Locator, edge: 'start' | 'end', deltaX: number, modifiers: readonly ('Control' | 'Shift')[] = []) {
    const box = await clip.boundingBox();
    if (!box) throw new Error('Clip edge has no layout box');
    const x = edge === 'start' ? box.x + 2 : box.x + box.width - 2;
    const y = box.y + box.height / 2;
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 12 });
    await page.mouse.up();
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

/**
 * Click a clip somewhere that is actually ON it.
 *
 * A fixed 30px offset assumes every clip is at least 30px wide, and after the
 * range delete the first clip on the lane is the trimmed remainder — a sliver
 * only a few pixels across. Playwright then dispatches the click at a point the
 * lane owns, and the lane "intercepts pointer events". Clamp into the clip.
 */
async function clickClip(clip: Locator, fromLeft = 30) {
    const box = await clip.boundingBox();
    if (!box) throw new Error('Clip has no layout box');
    await clip.click({ position: { x: Math.max(2, Math.min(fromLeft, box.width / 2)), y: Math.min(34, box.height / 2) } });
}

async function selectRange(page: Page, fromX: number, toX: number) {
    const lane = page.locator('.arrangement-lane').first();
    const box = await lane.boundingBox();
    if (!box) throw new Error('Arrangement lane has no layout box');
    // The four-pixel strip above clips is real empty lane space and selects time.
    await page.mouse.move(box.x + fromX, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + toX, box.y + 2, { steps: 10 });
    await page.mouse.up();
}

function canonical(document: Arrangement): Arrangement {
    const normalized = normalizeArrangement(document);
    // The allocator cursor is persistence metadata, not an authored verb. Entity
    // ids themselves remain in the byte comparison and therefore still prove
    // deterministic minting through every split/copy/paste operation.
    return { ...normalized, idCounter: 0 };
}

test('@journey J3 Editor\'s Hour — every edit family converges with verb replay', async ({ page }) => {
    test.setTimeout(180_000);
    await loadFixture(page, 'denseEdit');
    const clips = page.locator('.arrangement-clip');

    // Magnetic absolute and relative snap are distinct real gestures.
    await pointerDrag(page, clips.nth(0), 43);
    await pointerDrag(page, clips.nth(1), 47, 0, ['Alt', 'Shift']);

    // Ripple move pushes the later material on the lane.
    await page.getByRole('button', { name: 'Ripple' }).click();
    await pointerDrag(page, clips.nth(2), 42);
    await page.getByRole('button', { name: 'Slide' }).click();

    // Split at a user-placed playhead, then trim and slip through pointer streams.
    const splitTarget = clips.nth(3);
    await clickClip(splitTarget, 28);
    const beforeSplit = await documentClipCount(page);
    const ruler = page.locator('.arrangement-ruler-viewport');
    const splitBox = await splitTarget.boundingBox();
    const rulerBox = await ruler.boundingBox();
    if (!splitBox || !rulerBox) throw new Error('Split gesture targets have no layout box');
    /*
     * Scrub in the BARS row, not at y=24. The 64px ruler is sections 22 / braces
     * 14 / bars 28 (docs/timeline.md), so y=24 is the brace row — and "a press on
     * an existing brace or end cap owns the pointer outright", which is exactly
     * what happens here: `denseEdit` carries a loop range whose brace covers this
     * x, so the press never reaches the ruler scrub, the playhead stays at tick 0
     * and `s` splits nothing. y=50 is unambiguously the bars row.
     */
    await ruler.click({ position: { x: splitBox.x + splitBox.width / 2 - rulerBox.x, y: 50 } });
    await page.keyboard.press('s');
    await expect.poll(() => documentClipCount(page)).toBe(beforeSplit + 1);
    await dragEdge(page, clips.nth(0), 'end', -18);
    await dragEdge(page, clips.nth(1), 'start', 14);
    await pointerDrag(page, clips.nth(2), 29, 0, ['Control', 'Shift']);

    // Alt-copy, cut/paste, and repeat-paste all mint through production actions.
    const beforeCopy = await documentClipCount(page);
    await pointerDrag(page, clips.nth(4), 85, 0, ['Alt']);
    await expect.poll(() => documentClipCount(page)).toBe(beforeCopy + 1);
    await clickClip(clips.nth(5));
    await page.keyboard.press('Control+x');
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');
    await expect.poll(() => documentClipCount(page)).toBeGreaterThan(beforeCopy + 1);

    // Range selection and destructive range edit use the lane's pointer path.
    await selectRange(page, 24, 58);
    await expect(page.locator('.arrangement-range-selection')).toBeVisible();
    await page.keyboard.press('Delete');

    // Nudge an object, then prove selection undo and object undo are independent.
    // Overlapping clips can make the pointer select the frontmost object rather
    // than the locator's DOM node. Capture the production selection result, not
    // a potentially covered element's attribute; the nudge may also reorder the
    // rendered collection.
    await clickClip(clips.first());
    const nudgeSelection = await page.evaluate(() => (
        window as unknown as { __openjammerE2E: Bridge }
    ).__openjammerE2E.selection());
    expect(nudgeSelection.clipIds).toHaveLength(1);
    const selectedId = nudgeSelection.clipIds[0]!;
    await page.keyboard.press('ArrowRight');
    /*
     * Change the selection WITHOUT a pointer. By this point the copy, the two
     * pastes and the range delete have left clips overlapping on the lane, so a
     * click aimed at `clips.nth(1)` is intercepted by whichever clip is painted
     * over it — the very ambiguity the comment above warns about. All this step
     * needs is "the selection is now something else", so use the surface's own
     * select-all binding: a real production action with no geometry in it.
     */
    await page.keyboard.press('Control+a');
    await expect.poll(async () => {
        const selection = await page.evaluate(() => (window as unknown as { __openjammerE2E: Bridge }).__openjammerE2E.selection());
        return selection.clipIds.length;
    }).toBeGreaterThan(1);
    await page.keyboard.press('Control+Alt+z');
    await expect.poll(async () => {
        const selection = await page.evaluate(() => (window as unknown as { __openjammerE2E: Bridge }).__openjammerE2E.selection());
        return selection.clipIds;
    }).toContain(selectedId);
    const beforeObjectUndo = await snapshot(page);
    await page.keyboard.press('Control+z');
    expect(await snapshot(page)).not.toEqual(beforeObjectUndo);

    const finalDocument = await snapshot(page) as Arrangement;
    const editLog = (await bridge(page)).filter((item): item is Extract<EditVerb, { domain: 'arrangement' }> => item.domain === 'arrangement');
    const replayed = applyVerbs(normalizeArrangement(buildDenseEdit()), editLog.map((item) => item.verb as Verb)).next;
    expect(JSON.stringify(canonical(finalDocument))).toBe(JSON.stringify(canonical(replayed)));

    const history = await page.evaluate(() => (window as unknown as { __openjammerE2E: Bridge }).__openjammerE2E.history());
    expect(history.cursor).toBeGreaterThan(8);
    expect(history.scopes.slice(0, history.cursor).every((scope) => scope === 'arrangement')).toBe(true);
});
