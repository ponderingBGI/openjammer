/**
 * J-ONBOARDING — the first thirty seconds.
 *
 * Three taps over the real studio, blurred behind the card, and then a rig that
 * is already making sound. This journey holds the whole promise of that flow to
 * account, because it only ever happens once per player and there is no second
 * take: the overlay must appear exactly when there is no stored answer set, take
 * three answers by pointer OR by keyboard alone, honour a skip WITHOUT throwing
 * away an answer already given, persist to `oj-onboarding-v1`, install the rig
 * through the same reversible verbs a hand drives, and never come back.
 *
 * Two things it asserts that are easy to lose in a refactor:
 *   • the studio behind the card is blurred and inert — it is a peek at what you
 *     are about to get, not a control surface (`Onboarding.tsx`);
 *   • under `prefers-reduced-motion` the blur and the card animation are BOTH
 *     off. A full-screen composited blur is exactly what that setting exists to
 *     switch off, and the overlay has to read perfectly without it.
 *
 * It does NOT assert that the beat rig starts rolling. `OnboardingHost` waits
 * for `engineHealth === 'LIVE'`, and headless Chromium never sends the
 * `TransportFrame` that would produce it (see `installEngineProbe`). Claiming
 * "it plays" here would be claiming something this environment cannot see.
 */

import { expect, test, type Page } from '@playwright/test';
import { bootApp, completeOnboarding, onboardingOverlay } from './support';

const STORAGE_KEY = 'oj-onboarding-v1';

const stored = (page: Page) => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as { exp: string; goal: string; theme: string } : null;
}, STORAGE_KEY);

/** Land on a genuinely first-run boot: no stored answers, overlay up. */
async function firstRun(page: Page): Promise<void> {
    await bootApp(page, { firstRun: true, skipOnboarding: false });
    await expect(onboardingOverlay(page)).toHaveCount(1);
}

/** What the studio behind the card is wearing. */
const backdrop = (page: Page) => page.evaluate(() => {
    const filter = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).filter : null;
    };
    const card = document.querySelector('.ob-card');
    const option = document.querySelector('.ob-opt');
    return {
        surfaceLayer: filter('.surface-layer'),
        topbar: filter('.oj-topbar'),
        bodyClass: document.body.className,
        cardAnimation: card ? getComputedStyle(card).animationName : null,
        optionAnimation: option ? getComputedStyle(option).animationName : null,
    };
});

test.describe('J-onboarding — the first run', () => {
    test('three steps over the blurred studio, and the studio is only a peek', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await firstRun(page);

        // STEP 1 of 3 — the card says so twice: to the eye and to a screen reader.
        await expect(page.locator('.ob-count')).toHaveText('01 / 03');
        await expect(page.getByText('Step 1 of 3')).toBeAttached();
        await expect(page.getByRole('heading', { name: 'Made music with a computer before?' })).toBeVisible();
        for (const option of ['First time', "I've dabbled", 'Years of it']) {
            await expect(page.getByRole('button', { name: new RegExp(option) })).toBeVisible();
        }
        await expect(page.getByRole('button', { name: /Skip, take me in/i })).toBeVisible();

        // The studio behind it is blurred, and it is not a control surface.
        const behind = await backdrop(page);
        expect(behind.bodyClass, 'the body carries the flag the blur hangs off').toContain('oj-onboarding-open');
        expect(behind.surfaceLayer, 'the studio behind the card is blurred').toContain('blur');
        expect(behind.topbar).toContain('blur');
        await expect(page.locator('.surface-layer')).toHaveCSS('pointer-events', 'none');

        // STEP 2.
        await page.getByRole('button', { name: /Years of it/ }).click();
        await expect(page.locator('.ob-count')).toHaveText('02 / 03');
        await expect(page.getByRole('heading', { name: 'What do you want to make right now?' })).toBeVisible();
        await expect(page.getByText('Step 2 of 3')).toBeAttached();

        // Back goes back, and keeps the answer it is going back to.
        await page.getByRole('button', { name: /Back/ }).click();
        await expect(page.locator('.ob-count')).toHaveText('01 / 03');
        await page.getByRole('button', { name: /Years of it/ }).click();

        // STEP 3 — the theme, which is a real preview rather than a swatch.
        await page.getByRole('button', { name: /Build a beat/ }).click();
        await expect(page.locator('.ob-count')).toHaveText('03 / 03');
        await expect(page.getByRole('heading', { name: 'Where do you like to work?' })).toBeVisible();
        await expect(page.locator('.ob-swatch--light')).toBeVisible();
        await expect(page.locator('.ob-swatch--dark')).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('completing it stores the answers, installs a rig, and lifts the overlay', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await firstRun(page);
        expect(await stored(page), 'nothing is written before the last tap').toBeNull();

        await completeOnboarding(page, { exp: 'Years of it', goal: 'Build a beat', theme: 'light' });

        expect(await stored(page)).toEqual({ exp: 'pro', goal: 'beat', theme: 'light' });
        await expect(onboardingOverlay(page)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/oj-onboarding-open/);
        // The studio is a control surface again.
        await expect(page.locator('.surface-layer')).toHaveCSS('filter', 'none');

        // The rig landed — including the Song the 'beat' preset carries.
        await expect(page.locator('.song-node')).toHaveCount(1);
        await expect(page.locator('.schematic-node')).not.toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('a skip keeps the answers already given and still takes you in', async ({ page }) => {
        await firstRun(page);

        // Answer only the first question, then skip the rest.
        await page.getByRole('button', { name: /Years of it/ }).click();
        await page.getByRole('button', { name: /Skip, take me in/i }).click();

        await expect(onboardingOverlay(page)).toHaveCount(0);
        expect(await stored(page), 'a skip must never throw away a choice already made')
            .toEqual({ exp: 'pro', goal: 'jam', theme: 'light' });
        await expect(page.locator('.schematic-node')).not.toHaveCount(0);
    });

    test('Escape is a skip too', async ({ page }) => {
        await firstRun(page);
        await page.getByRole('button', { name: /I've dabbled/ }).click();
        await page.keyboard.press('Escape');

        await expect(onboardingOverlay(page)).toHaveCount(0);
        expect((await stored(page))!.exp).toBe('some');
    });

    test('the whole run is reachable from the keyboard alone', async ({ page }) => {
        await firstRun(page);

        // Focus lands on the first option of the step without anyone asking.
        await expect(page.getByRole('button', { name: /First time/ })).toBeFocused();

        // Tab is trapped inside the card: it never reaches the studio behind.
        for (let press = 0; press < 6; press += 1) await page.keyboard.press('Tab');
        const trapped = await page.evaluate(() => !!document.activeElement?.closest('.ob-card'));
        expect(trapped, 'Tab cycles the card, it does not escape into the blurred studio').toBe(true);

        // 1–3 answer each step; the third is also the audio gesture.
        await page.keyboard.press('3');
        await expect(page.getByRole('heading', { name: 'What do you want to make right now?' })).toBeVisible();
        await page.keyboard.press('2');
        await expect(page.getByRole('heading', { name: 'Where do you like to work?' })).toBeVisible();
        await page.keyboard.press('1');

        await expect(onboardingOverlay(page)).toHaveCount(0);
        expect(await stored(page)).toEqual({ exp: 'pro', goal: 'beat', theme: 'light' });
        await expect(page.locator('.song-node')).toHaveCount(1);
    });

    test('under reduced motion nothing blurs and nothing animates', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await firstRun(page);

        const behind = await backdrop(page);
        expect(behind.bodyClass, 'the overlay is still open').toContain('oj-onboarding-open');
        expect(behind.surfaceLayer, 'a full-screen composited blur is what this setting switches off').toBe('none');
        expect(behind.topbar).toBe('none');
        expect(behind.cardAnimation).toBe('none');
        expect(behind.optionAnimation).toBe('none');
        await expect(page.locator('.ob')).toHaveCSS('backdrop-filter', 'none');

        // And it still works: the run completes exactly as it does with motion.
        await completeOnboarding(page, { goal: 'Build a beat' });
        expect((await stored(page))!.goal).toBe('beat');
    });

    test('it runs once — a reload comes back straight into the studio', async ({ page }) => {
        await firstRun(page);
        await completeOnboarding(page, { goal: 'Build a beat' });
        const answers = await stored(page);

        await page.reload();
        await expect(page.locator('#root')).not.toBeEmpty();
        await expect(page.locator('.schematic-node').first()).toBeVisible();

        await expect(onboardingOverlay(page), 'the absence of stored answers is the ONLY thing that opens it').toHaveCount(0);
        await expect(page.locator('.ob-card')).toHaveCount(0);
        expect(await stored(page)).toEqual(answers);
    });
});
