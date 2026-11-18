import { expect, test } from '@playwright/test';
import { assertAudiblePeak, assertMusicalDuration, assertSectionsDiffer, decodeWav, energyFingerprint } from '../helpers/audio';
import { exportSong, installEngineProbe, openStarter, pointerDrag } from './support';

test('@journey J1 First Song — start, play, mix, export, and hear the result', async ({ page }) => {
    test.setTimeout(180_000);
    /*
     * The pill tells the truth about the transport, which is why it needs the
     * engine mirror here. Its glyph, `aria-label` and `title` all read `Play`
     * until the engine CONFIRMS motion (`TransportPillHost`: "a Stop glyph over
     * a frozen playhead is the worst lie this component can tell"), and headless
     * Chromium never returns a `TransportFrame`. Without this the assertion below
     * is waiting for a state the product is right to refuse.
     */
    await installEngineProbe(page);
    await openStarter(page, 'First Light');

    /*
     * By ACCESSIBLE NAME, not by title: the title now carries the shortcut hint
     * (`Play (Space)`), while `aria-label` stays the bare verb — so the name is
     * both the stabler handle and the thing a screen reader actually announces.
     */
    const transport = page.getByRole('group', { name: 'Transport' });
    await transport.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(transport.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await transport.getByRole('button', { name: 'Stop', exact: true }).click();

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
