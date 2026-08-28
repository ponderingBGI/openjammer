import { expect, test, type Page } from '@playwright/test';
import type { Arrangement } from '../../src/song/types';
import { arrangementForExport } from '../../src/song/project';
import { installWebMidiShim, VirtualMidiInput } from '../helpers/midi';
import { loadFixture, openStarter, pointerDrag, snapshot } from './support';

async function armUncleanReload(page: Page) {
    await page.addInitScript(() => {
        if (localStorage.getItem('oj-e2e-crash-once') !== '1') return;
        localStorage.removeItem('oj-e2e-crash-once');
        for (const key of ['openjammer-recovery-marker', 'openjammer-recovery-marker.bak']) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const marker = JSON.parse(raw) as { open?: boolean };
            marker.open = true;
            localStorage.setItem(key, JSON.stringify(marker));
        }
    });
    await page.evaluate(() => localStorage.setItem('oj-e2e-crash-once', '1'));
}

const noteCount = (arrangement: Arrangement) => Object.values(arrangement.sources ?? {})
    .reduce((total, source) => total + (source.kind === 'midi' ? source.notes.length : 0), 0);

test('@journey J4 Crash — an unclean mid-edit reload restores graph and arrangement', async ({ page }) => {
    test.setTimeout(120_000);
    await openStarter(page, 'First Light');
    const clip = page.locator('.arrangement-clip').first();
    await pointerDrag(page, clip, 46);
    const before = await snapshot(page) as Arrangement;
    const graphBefore = await page.evaluate(() => (window as unknown as { __openjammerE2E: { graphSnapshot(): unknown } }).__openjammerE2E.graphSnapshot());
    await page.waitForTimeout(2_200); // production emergency-backup debounce

    await armUncleanReload(page);
    await page.reload();
    await expect(page.getByText('Recovered your work', { exact: false })).toBeVisible({ timeout: 15_000 });
    const after = await snapshot(page) as Arrangement;
    expect(arrangementForExport(after)).toEqual(arrangementForExport(before));
    const graphAfter = await page.evaluate(() => (window as unknown as { __openjammerE2E: { graphSnapshot(): unknown } }).__openjammerE2E.graphSnapshot());
    expect(graphAfter).toEqual(graphBefore);
});

test('@journey J4 Crash — an in-flight MIDI take survives through the record journal', async ({ page }) => {
    test.setTimeout(120_000);
    await installWebMidiShim(page);
    await loadFixture(page, 'denseEdit');
    const midi = new VirtualMidiInput(page);

    // Produce a document revision so the normal debounced recovery snapshot is
    // durable before recording begins.
    await page.locator('.arrangement-clip').first().click({ position: { x: 28, y: 34 } });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2_200);
    const before = await snapshot(page) as Arrangement;
    const beforeNotes = noteCount(before);

    await page.getByRole('button', { name: /Arm .* for MIDI recording/i }).first().click();
    await page.getByTitle('Record').click();
    await midi.noteStorm({ notes: 8, startNote: 60, tick: 480, spacingTick: 180, jitterMs: 1 });
    expect(await midi.sentCount()).toBeGreaterThanOrEqual(16);

    await armUncleanReload(page);
    await page.reload(); // deliberately no Stop: journal recovery closes the take
    await expect.poll(async () => noteCount(await snapshot(page) as Arrangement)).toBeGreaterThanOrEqual(beforeNotes + 8);
    const recovered = await snapshot(page) as Arrangement;
    const takes = recovered.tracks.flatMap((track) => track.clips).filter((clip) => clip.name?.startsWith('Take '));
    expect(takes.length).toBeGreaterThan(0);
    expect(noteCount(recovered)).toBeGreaterThanOrEqual(beforeNotes + 8);
});
