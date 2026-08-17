import { expect, test } from '@playwright/test';
import { installWebMidiShim, VirtualMidiInput } from '../helpers/midi';
import { loadFixture, snapshot } from './support';

test('@journey J2 Recording Session — count-in, punch, loop takes, newest take, undo', async ({ page }) => {
    test.setTimeout(120_000);
    await installWebMidiShim(page);
    await loadFixture(page, 'denseEdit');
    const midi = new VirtualMidiInput(page);
    await expect.poll(() => page.getByText('E2E Keys', { exact: false }).count()).toBeGreaterThan(0);

    const arm = page.getByRole('button', { name: /Arm .* for MIDI recording/i }).first();
    await arm.click();
    await page.getByTitle('Count-in: off, 1 bar, or 2 bars').click();
    await page.getByTitle(/Enable click/).click();
    await page.getByTitle(/Enable punch range/).click();

    const originalCount = await page.locator('.arrangement-clip').count();
    await page.getByTitle('Record').click();
    await midi.sustain(true);
    await midi.chord([60, 64, 67], 104, 35, 7_800, 480);
    await midi.sustain(false);
    await page.getByTitle('Stop recording').click();
    await expect(page.locator('.arrangement-clip')).toHaveCount(originalCount + 1);

    await page.getByTitle(/Disable punch range/).click();
    await page.getByTitle(/Enable loop/).click();
    for (let take = 0; take < 3; take++) {
        await page.getByTitle('Record').click();
        await midi.noteStorm({ notes: 4, startNote: 64 + take, tick: 31_000 + take * 960, spacingTick: 180, jitterMs: 2 });
        await page.getByTitle('Stop recording').click();
    }
    const afterTakes = await page.locator('.arrangement-clip').count();
    expect(afterTakes).toBe(originalCount + 4);
    expect(await midi.sentCount()).toBeGreaterThan(20);

    const document = await snapshot(page) as { tracks: Array<{ clips: Array<{ layerIndex?: number; mute?: boolean; name?: string }> }> };
    const takes = document.tracks.flatMap((track) => track.clips).filter((clip) => clip.name?.startsWith('Take '));
    const newest = takes.at(-1)!;
    expect(newest.mute).not.toBe(true);
    expect(newest.layerIndex ?? 0).toBeGreaterThanOrEqual(Math.max(0, ...takes.slice(0, -1).map((take) => take.layerIndex ?? 0)));

    await page.keyboard.press('Control+z');
    await expect(page.locator('.arrangement-clip')).toHaveCount(afterTakes - 1);
});
