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
    await splitTarget.click({ position: { x: 28, y: 34 } });
    const beforeSplit = await documentClipCount(page);
    const ruler = page.locator('.arrangement-ruler-viewport');
    const splitBox = await splitTarget.boundingBox();
    const rulerBox = await ruler.boundingBox();
    if (!splitBox || !rulerBox) throw new Error('Split gesture targets have no layout box');
    await ruler.click({ position: { x: splitBox.x + splitBox.width / 2 - rulerBox.x, y: 24 } });
    await page.keyboard.press('s');
    await expect.poll(() => documentClipCount(page)).toBe(beforeSplit + 1);
    await dragEdge(page, clips.nth(0), 'end', -18);
    await dragEdge(page, clips.nth(1), 'start', 14);
    await pointerDrag(page, clips.nth(2), 29, 0, ['Control', 'Shift']);

    // Alt-copy, cut/paste, and repeat-paste all mint through production actions.
    const beforeCopy = await documentClipCount(page);
    await pointerDrag(page, clips.nth(4), 85, 0, ['Alt']);
    await expect.poll(() => documentClipCount(page)).toBe(beforeCopy + 1);
    await clips.nth(5).click({ position: { x: 30, y: 34 } });
    await page.keyboard.press('Control+x');
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');
    await expect.poll(() => documentClipCount(page)).toBeGreaterThan(beforeCopy + 1);

    // Range selection and destructive range edit use the lane's pointer path.
    await selectRange(page, 24, 58);
    await expect(page.locator('.arrangement-range-selection')).toBeVisible();
    await page.keyboard.press('Delete');

    // Nudge an object, then prove selection undo and object undo are independent.
    await clips.first().click({ position: { x: 30, y: 34 } });
    await page.keyboard.press('ArrowRight');
    const selectedId = await clips.first().getAttribute('data-clip-id');
    await clips.nth(1).click({ position: { x: 30, y: 34 } });
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
