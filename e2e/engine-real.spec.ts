/**
 * The suite's one REAL-ENGINE anchor.
 *
 * Every other transport spec boots through `installEngineProbe` (support.ts),
 * which wraps the worklet port and *synthesises* `{type:'transport', frame}`
 * messages on a timer. That probe is legitimate and stays: the T-list is about
 * timeline editing, and it needs deterministic ticks it can reason about rather
 * than whatever a real audio clock happens to do on a loaded CI box.
 *
 * But it meant nothing in the suite ever exercised the engine's own return path.
 * So every `isPlaying()` assertion passed against frames the TEST had produced,
 * while the shipped wasm tier posted none at all — `drain_transport` did not
 * exist, `arrangementStore`'s 1500 ms timeout fired on every Play, and the app
 * told first-time players "the audio engine did not acknowledge the transport
 * command". Green suite, broken instrument.
 *
 * This file therefore installs NO probe. Everything it asserts has to come from
 * the real `ojcore-wasm` build in `src/audio/wasm/pkg/`:
 *
 *  1. Play on a bound song really rolls — the pill flips and the playhead moves.
 *  2. One held key on the starter rig does not fault the engine for 40 seconds.
 *
 * Both were RED against the artefact committed before UX-1A.
 */

import { expect, test } from '@playwright/test';
import {
    completeOnboarding,
    bootApp,
    focusArrangement,
    isPlaying,
    openPaperSketch,
    playButton,
    playheadDisplay,
} from './journeys/support';

// The shared config does NOT pass an autoplay flag (it relies on each journey's
// real click gesture). These two tests need audio genuinely running for the
// whole of a 40 s observation, so they take the flag explicitly rather than
// depending on a gesture staying "recent enough".
test.use({
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
});

/**
 * The playhead reading once it stops changing — two agreeing samples in a row.
 * Local to this spec on purpose: it is only needed because this is the one file
 * driving a REAL transport, where "stopped" arrives a fade after the click.
 */
async function settledPlayhead(page: import('@playwright/test').Page): Promise<string> {
    let last = await playheadDisplay(page);
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await page.waitForTimeout(50);
        const now = await playheadDisplay(page);
        if (now === last) return now;
        last = now;
    }
    throw new Error(`the transport never came to rest (last read ${last})`);
}

test.describe('the real engine, with no probe standing in for it', () => {
    test('Play on a bound song rolls the transport and moves the playhead', async ({ page }) => {
        test.setTimeout(120_000);

        await openPaperSketch(page);

        await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
        const parked = await playheadDisplay(page);

        await playButton(page).click();

        // The engine must ACKNOWLEDGE within the same 1500 ms window
        // `arrangementStore.armPendingTransportTimeout` gives it. Anything slower
        // and the player is told the engine did not answer.
        await expect(playButton(page)).toHaveAttribute('aria-label', 'Stop', { timeout: 1500 });
        expect(await isPlaying(page)).toBe(true);

        // ...and it must actually be MOVING, not merely claiming to be.
        const first = await playheadDisplay(page);
        await page.waitForTimeout(500);
        const second = await playheadDisplay(page);
        expect(second, `playhead did not advance in 500 ms (${first} -> ${second})`).not.toBe(first);

        // Nothing anywhere may accuse the engine of not answering.
        await expect(page.locator('body')).not.toContainText(/did not acknowledge/i);

        // Stop freezes the playhead where it stands. Sample only once the
        // transport has actually come to rest: Stop runs a short declick
        // (`Motion::DeclickToStop`) before it parks, so the very first reading
        // after the click is still legitimately in motion.
        await playButton(page).click();
        await expect(playButton(page)).not.toHaveAttribute('aria-label', 'Stop');
        const stoppedAt = await settledPlayhead(page);
        await page.waitForTimeout(600);
        expect(await playheadDisplay(page)).toBe(stoppedAt);
        expect(stoppedAt).not.toBe(parked);

        // The second Stop is the return: back to where playback started. The
        // glyph flips as soon as the intent is registered; the position follows
        // when the engine's next frame confirms the seek, so poll for it.
        await playButton(page).click();
        await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
        await expect
            .poll(() => playheadDisplay(page), { timeout: 5_000 })
            .toBe(parked);
    });

    test('a transport command that changes nothing is still acknowledged', async ({ page }) => {
        test.setTimeout(120_000);

        // The gate's case, and the reason the engine counts commands as well as
        // describing state. `Home` (`arrangement.home`) seeks to 0. Do that while
        // already parked at bar 1 and NOTHING about the transport changes — same
        // sample, same motion, same everything. An engine that reports state only
        // stays silent, `armPendingTransportTimeout` fires 1500 ms later, and the
        // player is told "The audio engine did not acknowledge the transport
        // command": the exact sentence this whole return path exists to delete.
        await openPaperSketch(page);
        await focusArrangement(page);

        await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
        expect(await playheadDisplay(page)).toBe('1.1');

        // Press it twice: the first is arguably a real move, the second cannot be.
        await page.keyboard.press('Home');
        await page.waitForTimeout(300);
        await page.keyboard.press('Home');

        // Well past the 1500 ms acknowledgement budget.
        await page.waitForTimeout(2_000);

        await expect(page.locator('body')).not.toContainText(/did not acknowledge/i);
        await expect(page.locator('body')).not.toContainText(/last confirmed position/i);
        expect(await playheadDisplay(page)).toBe('1.1');
        expect(await isPlaying(page)).toBe(false);
    });

    test('one key on the starter rig does not fault the engine for 40 seconds', async ({ page }) => {
        test.setTimeout(150_000);

        // The real first run, answering "Jam some keys" — the rig UX-INV Q1
        // reproduced on: Sampler (electric piano) -> Delay(feedback 0.34) -> Speaker.
        await bootApp(page, { firstRun: true, skipOnboarding: false });
        await completeOnboarding(page, { goal: 'Jam some keys' });

        // Make the keyboard node the active input, then play ONE note.
        // (One key was always enough; the chord in the original report was a
        // red herring.)
        const keys = page.locator('.keyboard-visual-node');
        await expect(keys).toHaveCount(1);
        await keys.click();
        await expect(page.locator('.keyboard-visual-node.is-mode-active')).toHaveCount(1);

        await page.keyboard.down('a');
        await page.waitForTimeout(200);
        await page.keyboard.up('a');

        // The delay's feedback tail used to decay into the subnormal band at
        // roughly t+18 s, and the master guard reported every flushed denormal as
        // `NonFinite` — a permanent fault card, ~10x/s, forever. So watch well
        // past that.
        await page.waitForTimeout(40_000);

        await expect(
            page.locator('.node-plugin-error-badge'),
            'a decaying tail is healthy audio and must not badge any node',
        ).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/sending noise we can't play/i);
        await expect(page.locator('body')).not.toContainText(/Sound degraded/i);
    });
});
