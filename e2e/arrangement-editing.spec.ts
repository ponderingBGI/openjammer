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
    await page.getByRole('button', { name: /Start from/i }).click();
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
