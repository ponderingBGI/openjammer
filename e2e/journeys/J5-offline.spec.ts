import { expect, test } from '@playwright/test';
import { assertAudiblePeak, assertMusicalDuration, decodeWav } from '../helpers/audio';
import type { Arrangement } from '../../src/song/types';
import { exportSong, snapshot } from './support';

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

    await context.setOffline(true);
    await page.reload();
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
    await page.keyboard.down('Control');
    await page.mouse.move(fieldBox.x + 42, fieldBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(fieldBox.x + 72, fieldBox.y + 24, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(notes).toHaveCount(beforeNotes + 1);

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

    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /play here in your browser/i })).toBeVisible();
});
