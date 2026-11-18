/**
 * W6-E2E — the visual regression skeleton for the New DNA.
 *
 * Every test here is `test.skip`: enable after W6-UI lands; capture baselines
 * then. Committing screenshots against a surface whose tokens, transport pill
 * and Tab semantics are being rewritten in a parallel lane would only pin the
 * half-finished frame, and every later diff would be noise. The SHAPE is what
 * this file contributes now — six surfaces × three appearances, named, routed
 * and already agreeing with the rest of the suite about how to reach each one —
 * so turning it on is deleting `.skip` and running with `--update-snapshots`.
 *
 * WHEN YOU ENABLE IT
 *   1. drop `.skip` (keep `describe.configure({ mode: 'serial' })` off — these
 *      are independent);
 *   2. `node node_modules/@playwright/test/cli.js test e2e/visual-baselines.spec.ts --update-snapshots`;
 *   3. review every PNG by eye before committing — a baseline nobody looked at
 *      is a rubber stamp, not a gate;
 *   4. keep `animations: 'disabled'` and the `settleField` wait below. The
 *      surface entry animation scales the whole surface from 1.015
 *      (`ArrangementSurface.css`), so a shot taken mid-transition is 1.5% off
 *      and will flap forever.
 *
 * WHY THESE SIX. They are the surfaces the redesign actually changed: the
 * canvas that a rig lands on, the arrangement in its seeded state, the inline
 * roll (the one nested surface with its own grid), the command palette and the
 * settings panel (the two overlays that sit on top of everything), and the
 * first thing a new player ever sees. Light, dark and reduced-motion each,
 * because the retheme owns all three and the contrast gates only measure the
 * numbers, never the composition.
 */

import { expect, test, type Page } from '@playwright/test';
import { bootApp, completeOnboarding, openPaperSketch, settleField } from './journeys/support';

type Appearance = 'light' | 'dark' | 'reduced-motion';

const APPEARANCES: Appearance[] = ['light', 'dark', 'reduced-motion'];

/** Put the page in one of the three appearances before anything is drawn. */
async function wear(page: Page, appearance: Appearance): Promise<void> {
    if (appearance === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    // `openjammer-theme` is the key `oj-tokens` itself reads (packages/oj-tokens/src/index.ts).
    await page.addInitScript((theme: string) => {
        try { localStorage.setItem('openjammer-theme', theme); } catch { /* private mode */ }
    }, appearance === 'dark' ? 'dark' : 'light');
}

const shoot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.002,
});

test.describe('W6 visual baselines', () => {
    for (const appearance of APPEARANCES) {
        test.skip(`canvas with three nodes — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await bootApp(page, { firstRun: true, skipOnboarding: false });
            await completeOnboarding(page, { goal: 'Build a beat' });
            await expect(page.locator('.schematic-node').first()).toBeVisible();
            await shoot(page, `canvas-${appearance}`);
        });

        test.skip(`arrangement — Paper Sketch — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await openPaperSketch(page);
            await shoot(page, `arrangement-paper-sketch-${appearance}`);
        });

        test.skip(`inline piano roll — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await openPaperSketch(page);
            await page.locator('.arrangement-clip').first().dblclick({ position: { x: 40, y: 34 } });
            await expect(page.locator('.piano-roll--inline .piano-roll-note').first()).toBeVisible();
            await settleField(page);
            await shoot(page, `inline-roll-${appearance}`);
        });

        test.skip(`command palette — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await openPaperSketch(page);
            await page.keyboard.press('Control+k');
            await expect(page.getByRole('dialog')).toBeVisible();
            await shoot(page, `command-palette-${appearance}`);
        });

        test.skip(`settings — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await openPaperSketch(page);
            await page.getByRole('button', { name: /settings/i }).first().click();
            await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();
            await shoot(page, `settings-${appearance}`);
        });

        test.skip(`onboarding step 1 — ${appearance}`, async ({ page }) => {
            // enable after W6-UI lands; capture baselines then
            await wear(page, appearance);
            await bootApp(page, { firstRun: true, skipOnboarding: false });
            await expect(page.locator('.ob-card')).toBeVisible();
            await shoot(page, `onboarding-step1-${appearance}`);
        });
    }
});
