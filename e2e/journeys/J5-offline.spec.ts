import { expect, test, type Page } from '@playwright/test';
import { assertAudiblePeak, assertMusicalDuration, decodeWav } from '../helpers/audio';
import type { Arrangement } from '../../src/song/types';
import { exportSong, snapshot } from './support';

async function reloadFromInstalledPwa(page: Page): Promise<void> {
    const previousTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-openjammer-e2e-origin-outage']).toBeUndefined();
    await expect.poll(() => page.evaluate(() => performance.timeOrigin)).not.toBe(previousTimeOrigin);
}

test('@journey J5 Offline — installed PWA composes, edits, exports, and reloads without network', async ({ page, context, browserName }) => {
    test.setTimeout(180_000);
    const failedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect.poll(() => page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false;
        await navigator.serviceWorker.ready;
        return true;
    }), { timeout: 30_000 }).toBe(true);
    // The first navigation installs; the second is controlled by that worker.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Do not use BrowserContext.setOffline() here: WebKit fails a controlled
    // service-worker navigation internally before the installed PWA can answer.
    // Instead, make this context's preview origin return 503 for every request.
    // A successful reload can therefore only come from the installed worker's
    // precache, while other parallel contexts keep their live origin.
    await context.addCookies([{
        name: 'oj_e2e_origin_outage',
        value: '1',
        url: page.url(),
        httpOnly: true,
        sameSite: 'Strict',
    }]);
    const outageProbe = await context.request.get(page.url(), { failOnStatusCode: false });
    expect(outageProbe.status()).toBe(503);
    expect(outageProbe.headers()['x-openjammer-e2e-origin-outage']).toBe('1');
    await reloadFromInstalledPwa(page);
    await expect(page.getByRole('button', { name: /play here in your browser/i }), `offline startup errors:\n${[...pageErrors, ...failedRequests].join('\n')}`).toBeVisible();
    const hasWebAudio = await page.evaluate(() => typeof AudioContext !== 'undefined');
    test.skip(!hasWebAudio, `${browserName} build has no Web Audio API for offline export`);

    await page.getByRole('button', { name: /play here in your browser/i }).click();
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: /start from 'paper sketch'/i }).click();
    await expect(page.locator('.arrangement-clip')).toHaveCount(3);

    // Compose through the repaired inline-roll pointer stream.
    await page.locator('.arrangement-clip').first().dblclick({ position: { x: 28, y: 34 } });
    const roll = page.locator('.piano-roll--inline');
    await expect(roll).toBeVisible();
    const notes = roll.locator('.piano-roll-note:not(.piano-roll-note--draw):not(.piano-roll-note--elsewhere)');
    const beforeNotes = await notes.count();
    const field = roll.locator('.piano-roll__field');
    const fieldBox = await field.boundingBox();
    if (!fieldBox) throw new Error('Offline piano roll has no layout box');
    const renderedNoteBoxes = await roll
        .locator('.piano-roll-note:not(.piano-roll-note--draw)')
        .evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
        }));
    const emptyRow = (await roll.locator('.piano-roll__row').evaluateAll((elements) => (
        elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
        })
    ))).find((row) => !renderedNoteBoxes.some((note) => note.top < row.bottom && note.bottom > row.top));
    if (!emptyRow) throw new Error('Offline piano roll has no empty pitch row for a deterministic draw gesture');
    const drawY = (emptyRow.top + emptyRow.bottom) / 2;
    const drawStartX = fieldBox.x + Math.min(42, fieldBox.width / 4);
    expect(drawY).toBeGreaterThan(fieldBox.y);
    expect(drawY).toBeLessThan(fieldBox.y + fieldBox.height);
    await field.evaluate((element) => {
        const target = window as unknown as {
            __openjammerPointerTrace: Array<{ type: string; ctrlKey: boolean; target: string }>;
        };
        target.__openjammerPointerTrace = [];
        const record = (event: Event) => {
            const pointer = event as PointerEvent;
            target.__openjammerPointerTrace.push({
                type: pointer.type,
                ctrlKey: pointer.ctrlKey,
                target: (pointer.target as HTMLElement | null)?.className ?? '',
            });
        };
        element.addEventListener('pointerdown', record, { capture: true, once: true });
        window.addEventListener('pointerup', record, { capture: true, once: true });
    });
    await page.keyboard.down('Control');
    await page.mouse.move(drawStartX, drawY);
    await page.mouse.down();
    await page.mouse.move(drawStartX + 30, drawY, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const pointerTrace = await page.evaluate(() => (
        window as unknown as {
            __openjammerPointerTrace: Array<{ type: string; ctrlKey: boolean; target: string }>;
        }
    ).__openjammerPointerTrace);
    expect(pointerTrace).toEqual([
        expect.objectContaining({ type: 'pointerdown', ctrlKey: true }),
        expect.objectContaining({ type: 'pointerup', ctrlKey: true }),
    ]);
    await expect(notes, `draw pointer trace: ${JSON.stringify(pointerTrace)}`).toHaveCount(beforeNotes + 1);

    // Edit the arrangement and prove the offline bounce is actual sound.
    await page.keyboard.press('Escape');
    const firstClip = page.locator('.arrangement-clip').first();
    await firstClip.click({ position: { x: 30, y: 34 } });
    await page.keyboard.press('ArrowRight');
    const arrangement = await snapshot(page) as Arrangement;
    const endTick = Math.max(...arrangement.tracks.flatMap((track) => track.clips.map((clip) => clip.startTick + clip.lengthTick)));
    const expectedSeconds = endTick * 60 / ((arrangement.ppq ?? 960) * arrangement.tempoBpm) + 4 * 60 / arrangement.tempoBpm;
    const wav = decodeWav(await exportSong(page));
    assertMusicalDuration(wav, expectedSeconds, 1.2);
    assertAudiblePeak(wav, -48, 0.1);

    await reloadFromInstalledPwa(page);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /play here in your browser/i })).toBeVisible();
});
