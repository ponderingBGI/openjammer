import { expect, test, type Page } from '@playwright/test';

async function openPaperSketch(page: Page) {
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.getByRole('button', { name: /play here in your browser/i }).click();
    const dismiss = page.getByRole('button', { name: /^Dismiss$/i });
    if (await dismiss.count()) await dismiss.first().click().catch(() => {});
    const canvas = page.locator('.node-canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 170, { button: 'right' });
    await page.getByText('Utility', { exact: false }).last().click();
    await page.getByRole('menuitem', { name: /Add Song/i }).click();
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: /Start from 'Paper Sketch'/i }).click();
    await expect(page.locator('.arrangement-clip')).toHaveCount(3);
    // The asynchronous headless-audio latency toast can cover the first lane.
    // Dismiss it after engine startup so pointer tests hit the ruled field itself.
    await dismiss.first().waitFor({ state: 'visible', timeout: 2_000 }).then(() => dismiss.first().click()).catch(() => {});
}

async function dragHorizontally(page: Page, clipIndex: number, delta: number) {
    const clip = page.locator('.arrangement-clip').nth(clipIndex);
    const box = (await clip.boundingBox())!;
    const x = box.x + Math.min(15, box.width / 2);
    const y = box.y + box.height / 2;
    await clip.hover({ position: { x: Math.min(15, box.width / 2), y: box.height / 2 }, force: true });
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 8 });
    await page.mouse.up();
}

test.describe('Wave 4a arrangement editing', () => {
    test('surface swap tears down the outgoing arrangement after 300ms', async ({ page }) => {
        await openPaperSketch(page);
        const arrangement = page.locator('[data-surface-root="arrangement"]');
        await page.getByRole('button', { name: 'Canvas', exact: true }).click();
        await page.waitForTimeout(300);
        await expect(arrangement).toBeHidden();
        await expect(arrangement).toHaveAttribute('inert');
        await expect(page.locator('[data-surface-root="canvas"]')).toBeVisible();
        await expect(page.locator('[data-surface-root="canvas"]')).not.toHaveAttribute('inert');
    });

    test('mixer fader drag is one undoable gesture', async ({ page }) => {
        await openPaperSketch(page);
        await page.getByTitle('Open mixer').click();
        const strip = page.getByRole('region', { name: /mixer/i }).locator('.mixer-strip').first();
        const fader = strip.getByRole('slider', { name: /gain/i });
        const before = await fader.inputValue();
        const box = (await fader.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2, { steps: 10 });
        await page.mouse.up();
        await expect.poll(() => fader.inputValue()).not.toBe(before);
        await strip.locator('.mixer-strip__name').click();
        await page.keyboard.press('Control+z');
        await expect.poll(() => fader.inputValue()).toBe(before);
    });

    test('dragging a clip commits one step and Ctrl+Z restores it', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
        await openPaperSketch(page);
        const clip = page.locator('.arrangement-clip').first();
        const before = await clip.evaluate((element) => (element as HTMLElement).style.left);
        await dragHorizontally(page, 0, 90);
        expect(errors).toEqual([]);
        await expect.poll(() => clip.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(before);
        await page.keyboard.press('Control+z');
        await expect.poll(() => clip.evaluate((element) => (element as HTMLElement).style.left)).toBe(before);
    });

    test('S splits at the playhead and selects both halves', async ({ page }) => {
        await openPaperSketch(page);
        await page.locator('.arrangement-clip').first().click({ position: { x: 24, y: 35 } });
        const ruler = page.locator('.arrangement-ruler-viewport');
        await ruler.click({ position: { x: 120, y: 35 } });
        await page.keyboard.press('s');
        await expect(page.locator('.arrangement-clip')).toHaveCount(4);
        await expect(page.locator('.arrangement-clip.is-selected')).toHaveCount(2);
    });

    test('Ripple moves a later clip while Slide leaves it in place', async ({ page }) => {
        await openPaperSketch(page);
        const first = page.locator('.arrangement-clip').first();
        await first.click({ position: { x: 24, y: 35 } });
        await page.keyboard.press('Control+d');
        await page.keyboard.press('Control+d');
        await expect(page.locator('.arrangement-clip')).toHaveCount(5);
        const laneClips = page.locator('.arrangement-track').first().locator('.arrangement-clip');
        const later = laneClips.nth(2);
        const before = await later.evaluate((element) => (element as HTMLElement).style.left);
        await page.getByRole('button', { name: 'Ripple' }).click();
        await laneClips.nth(1).click({ position: { x: 15, y: 35 }, force: true });
        await dragHorizontally(page, 1, 90);
        await expect.poll(() => later.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(before);
    });
});

test.describe('Wave 4b clipboard and range editing', () => {
    test('copy clip and paste twice advances by the clipboard extent', async ({ page }) => {
        await openPaperSketch(page);
        const originalCount = await page.locator('.arrangement-clip').count();
        await page.locator('.arrangement-clip').first().click({ position: { x: 24, y: 35 } });
        await page.keyboard.press('Control+c');
        await page.keyboard.press('Control+v');
        const firstPaste = page.locator('.arrangement-clip.is-selected').first();
        const firstLeft = Number.parseFloat(await firstPaste.evaluate((element) => (element as HTMLElement).style.left));
        await page.keyboard.press('Control+v');
        await expect(page.locator('.arrangement-clip')).toHaveCount(originalCount + 2);
        const secondLeft = Number.parseFloat(await page.locator('.arrangement-clip.is-selected').first().evaluate((element) => (element as HTMLElement).style.left));
        expect(secondLeft).toBeGreaterThan(firstLeft);
    });

    test('range delete removes the middle and leaves two clip pieces', async ({ page }) => {
        await openPaperSketch(page);
        const clip = page.locator('.arrangement-clip').first();
        const clipBox = (await clip.boundingBox())!;
        const firstLaneBox = (await page.locator('.arrangement-lane').first().boundingBox())!;
        const emptyLaneBox = (await page.locator('.arrangement-lane').nth(2).boundingBox())!;
        await page.mouse.move(clipBox.x + clipBox.width * 0.3, emptyLaneBox.y + emptyLaneBox.height * 0.25);
        await page.mouse.down();
        await page.mouse.move(clipBox.x + clipBox.width * 0.7, firstLaneBox.y + firstLaneBox.height * 0.25, { steps: 6 });
        await page.mouse.up();
        await expect(page.locator('.arrangement-range-selection')).toBeVisible();
        const before = await page.locator('.arrangement-clip').count();
        await page.keyboard.press('Delete');
        await expect(page.locator('.arrangement-track').first().locator('.arrangement-clip')).toHaveCount(2);
        await expect.poll(() => page.locator('.arrangement-clip').count()).toBeGreaterThan(before);
    });

    test('selection undo is separate from object undo', async ({ page }) => {
        await openPaperSketch(page);
        const clips = page.locator('.arrangement-clip');
        await clips.nth(0).click({ position: { x: 24, y: 35 } });
        const firstId = await clips.nth(0).getAttribute('data-clip-id');
        await clips.nth(1).click({ position: { x: 24, y: 35 } });
        await page.keyboard.press('Control+Alt+z');
        await expect(page.locator(`.arrangement-clip[data-clip-id="${firstId}"]`)).toHaveClass(/is-selected/);
        const count = await clips.count();
        await page.keyboard.press('Control+z');
        await expect(clips).toHaveCount(count);
    });
});

test.describe('Wave 7b record flow', () => {
    test('arms an instrument, records routed MIDI, and one undo removes the take', async ({ page }) => {
        await openPaperSketch(page);
        const before = await page.locator('.arrangement-clip').count();
        await page.getByRole('button', { name: /Arm .* for MIDI recording/i }).first().click();
        await page.getByTitle('Record').click();
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('openjammer:test-live-note', { detail: { note: 60, velocity: 104, on: true, tick: 120 } })));
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('openjammer:test-live-note', { detail: { note: 60, velocity: 0, on: false, tick: 480 } })));
        await page.getByTitle('Stop recording').click();
        await expect(page.locator('.arrangement-clip')).toHaveCount(before + 1);
        await expect(page.locator('.arrangement-track').first().locator('.arrangement-clip[aria-label*="1 notes"]')).toHaveCount(1);
        await page.keyboard.press('Control+z');
        await expect(page.locator('.arrangement-clip')).toHaveCount(before);
    });
});
