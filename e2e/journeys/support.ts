import { expect, type Download, type Locator, type Page } from '@playwright/test';

export async function activateBrowser(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.getByRole('button', { name: /play here in your browser/i }).click();
    const dismiss = page.getByRole('button', { name: /^Dismiss$/i });
    if (await dismiss.count()) await dismiss.first().click({ timeout: 2_000 }).catch(() => undefined);
}

export async function openStarter(page: Page, starter: 'Paper Sketch' | 'First Light' = 'Paper Sketch'): Promise<void> {
    await activateBrowser(page);
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: new RegExp(`start from '${starter}'`, 'i') }).click();
    await expect(page.locator('.arrangement-track')).not.toHaveCount(0);
    const dismiss = page.getByRole('button', { name: /^Dismiss$/i }).first();
    await dismiss.waitFor({ state: 'visible', timeout: 3_000 }).then(() => dismiss.click()).catch(() => undefined);
}

export async function loadFixture(page: Page, name: 'denseEdit' | 'firstLight' | 'pathological'): Promise<void> {
    await activateBrowser(page);
    await page.evaluate((fixture) => (window as unknown as { __openjammerE2E: { setFixture(name: string): void } }).__openjammerE2E.setFixture(fixture), name);
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-surface-root="arrangement"]')).toBeVisible();
}

export async function pointerDrag(page: Page, locator: Locator, deltaX: number, deltaY = 0, modifiers: readonly ('Alt' | 'Control' | 'Shift')[] = []): Promise<void> {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Gesture target has no layout box');
    const x = box.x + Math.min(Math.max(8, box.width * 0.4), Math.max(8, box.width - 8));
    const y = box.y + box.height / 2;
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 12 });
    await page.mouse.up();
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
}

export async function downloadBytes(download: Download): Promise<ArrayBuffer> {
    const stream = await download.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(Uint8Array.from(chunk));
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes.buffer;
}

export async function exportSong(page: Page, timeout = 150_000): Promise<ArrayBuffer> {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export song' });
    const pending = page.waitForEvent('download', { timeout });
    await dialog.getByRole('button', { name: 'Export song' }).click();
    return downloadBytes(await pending);
}

export async function snapshot(page: Page): Promise<unknown> {
    return page.evaluate(() => (window as unknown as { __openjammerE2E: { snapshot(): unknown } }).__openjammerE2E.snapshot());
}
