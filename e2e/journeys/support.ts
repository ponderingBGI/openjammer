import { expect, type Download, type Locator, type Page } from '@playwright/test';

/** The onboarding overlay, addressed by the question it is asking. */
const ONBOARDING = /made music with a computer before/i;

export interface BootOptions {
    /**
     * Leave the first-run overlay up and answer it yourself. Default `true`
     * (skip it) — most specs are about a surface, not about the first run.
     */
    skipOnboarding?: boolean;
    /**
     * Boot as a genuinely NEW user: no stored answers, so the overlay appears
     * and finishing it installs a preset rig. Default `false`, which pre-answers
     * the run so the canvas starts empty and a spec's own fixture is the only
     * thing on it.
     */
    firstRun?: boolean;
}

/**
 * Boot the app and leave audio unlocked.
 *
 * The browser tier has an autoplay gate, and exactly one thing satisfies it: a
 * real click. Which click depends on how the app opened —
 *   • first run → "Skip, take me in" finishes with defaults AND unlocks audio in
 *     the same gesture (that is the whole point of the button);
 *   • returning user → the transport pill's play button, which unlocks audio for
 *     the same reason.
 *
 * By default this pre-answers the first run (as the "years of it" persona, so the
 * shortcut card starts collapsed and nothing floats over the stage) and no preset
 * rig is installed. Pass `{ firstRun: true }` to exercise the real first run.
 */
export async function bootApp(page: Page, options: BootOptions = {}): Promise<void> {
    const { skipOnboarding = true, firstRun = false } = options;

    if (!firstRun) {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('oj-onboarding-v1', JSON.stringify({ exp: 'pro', goal: 'jam', theme: 'light' }));
            } catch {
                /* private mode — the overlay simply appears and gets skipped below */
            }
        });
    }

    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    if (!skipOnboarding) return;

    const overlay = page.getByRole('dialog', { name: ONBOARDING });
    if (await overlay.count()) {
        await page.getByRole('button', { name: /skip, take me in/i }).first().click();
        await expect(overlay).toHaveCount(0);
        return;
    }

    // No overlay: unlock audio with the transport's own gesture.
    await page.getByRole('button', { name: /^(Play|Start sound|Hold all sound)$/ }).first().click();
}

/** The journeys' name for the same boot. Kept so their prose still reads right. */
export async function activateBrowser(page: Page): Promise<void> {
    await bootApp(page);
}

export async function openStarter(page: Page, starter: 'Paper Sketch' | 'First Light' = 'Paper Sketch'): Promise<void> {
    await bootApp(page);
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: new RegExp(`start from '${starter}'`, 'i') }).click();
    await expect(page.locator('.arrangement-track')).not.toHaveCount(0);
}

export async function loadFixture(page: Page, name: 'denseEdit' | 'firstLight' | 'hundredTracks' | 'pathological'): Promise<void> {
    await bootApp(page);
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
    // `page.reload()` resolves at the document load event, which may precede
    // evaluation of a production ESM graph containing async WASM chunks. Wait
    // for the automation boundary itself instead of racing module startup.
    await page.waitForFunction(() => (
        typeof (window as unknown as { __openjammerE2E?: { snapshot?: unknown } })
            .__openjammerE2E?.snapshot === 'function'
    ));
    return page.evaluate(() => (window as unknown as { __openjammerE2E: { snapshot(): unknown } }).__openjammerE2E.snapshot());
}
