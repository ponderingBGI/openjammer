import { expect, test } from '@playwright/test';
import { assertAudiblePeak, assertMusicalDuration, assertSectionsDiffer, decodeWav, energyFingerprint } from '../helpers/audio';
import { exportSong, openStarter, pointerDrag } from './support';

test('@journey J1 First Song — start, play, mix, export, and hear the result', async ({ page }) => {
    test.setTimeout(180_000);
    await openStarter(page, 'First Light');

    await page.getByTitle('Play').click();
    await expect(page.getByTitle('Stop')).toBeVisible();
    await page.waitForTimeout(250);
    await page.getByTitle('Stop').click();

    await page.getByTitle('Open mixer').click();
    const fader = page.getByRole('region', { name: /mixer/i }).getByRole('slider', { name: /gain/i }).first();
    const gainBefore = await fader.inputValue();
    await pointerDrag(page, fader, 0, -36);
    await expect.poll(() => fader.inputValue()).not.toBe(gainBefore);
    await page.getByTitle('Close mixer').click();

    const wav = decodeWav(await exportSong(page));
    assertMusicalDuration(wav, 71.43, 1.2); // 24 bars at 84 BPM plus one four-beat release tail.
    assertAudiblePeak(wav, -48, 0.1);
    const fingerprint = energyFingerprint(wav, 16);
    const sections = Array.from({ length: 4 }, (_, index) => fingerprint.slice(index * 4, index * 4 + 4));
    assertSectionsDiffer(sections, 0.005);
    expect(wav.bitsPerSample).toBe(24);
    expect(wav.channels).toBe(2);
});
