import { test, expect } from '@playwright/test';

// Render-smoke for the browser PWA target (plan §4.2). Proves the production
// bundle loads, comes up cross-origin isolated (so the SharedArrayBuffer fast
// path the wasm engine relies on is available), and actually mounts the React
// shell — caught on every PR, against the real built output.
test.describe('PWA shell', () => {
    test('loads cross-origin isolated and mounts the app', async ({ page }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => {
            pageErrors.push(error.stack ?? error.message);
        });
        await page.goto('/');

        // The React app mounts into #root (index.html).
        await expect(page.locator('#root')).toBeAttached();

        // COOP/COEP (served by vite preview) must make the document cross-origin
        // isolated — the precondition for SharedArrayBuffer.
        const isolated = await page.evaluate(() => self.crossOriginIsolated);
        expect(isolated, 'crossOriginIsolated must be true (COOP/COEP served)').toBe(true);

        // And SAB must actually be constructible under that isolation.
        const hasSab = await page.evaluate(() => {
            try {
                void new SharedArrayBuffer(8);
                return true;
            } catch {
                return false;
            }
        });
        expect(hasSab, 'SharedArrayBuffer must be constructible under isolation').toBe(true);

        // Render-smoke: the shell put real content in #root (not a blank page),
        // and the first-run activation CTA is visible. This catches production
        // bundle TDZ/circular-import crashes where #root stays empty white.
        await expect(page.locator('#root')).not.toBeEmpty();
        await expect(page.getByRole('button', { name: /start openjammer/i })).toBeVisible();
        expect(pageErrors, 'no uncaught startup exceptions').toEqual([]);
    });
});
