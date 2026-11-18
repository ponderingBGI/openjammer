import { expect, test, type Page } from '@playwright/test';
import { activateBrowser } from './journeys/support';

async function installPluginInvokeMock(page: Page) {
    await page.addInitScript(() => {
        const invoke = async (command: string) => {
            if (command === 'scan_plugins') return [{
                path: '/mock/Velvet.clap', format: 'CLAP', name: 'Velvet', vendor: 'Acme Audio',
                id: 'com.acme.velvet', version: '1.0', is_instrument: true,
                ports: { audio_in: 0, audio_out: 2, note_in: true, note_out: false },
                param_count: 12, features: ['instrument', 'synthesizer'], has_gui: false,
            }];
            if (command === 'plugin_dirs') return [{ path: '/mock', scope: 'user', format: 'CLAP' }];
            if (command === 'hosting_backend') return { backend: 'clap', formats: ['CLAP'] };
            if (command === 'plugin_quarantine_list') return [{ path: '/mock/OldVerb.clap', reason: 'crashed while being read', crash_count: 1, benched: false }];
            return null;
        };
        Object.assign(window, { __TAURI__: { core: { invoke } } });
    });
}

test('Browser interleaves built-ins and mocked hosted plugins in insert context', async ({ page }) => {
    await installPluginInvokeMock(page);
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();

    const browser = page.getByRole('dialog', { name: 'Browser' });
    /*
     * `openjammer:open-browser` is only heard once `PluginsPanelHost`'s effect has
     * attached its listener (App.tsx), and `#root` having content only proves the
     * first COMMIT — React's passive effects can still be a paint behind. Firing
     * the event once, immediately, is a race the spec has always had; the app
     * shell's real mount work (topbar, transport pill, meter subscription) widened
     * the window enough to lose it about one run in three.
     *
     * So ask until it is heard. The handler is idempotent — `setRequested(true)`
     * then `setOpen(true)`, never a toggle — and this waits on the listener itself
     * rather than on a guessed delay.
     */
    await expect(async () => {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('openjammer:open-browser', { detail: { context: 'insert' } })));
        await expect(browser).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    /*
     * The row carries an explicit `aria-label` — `[name, vendor, format,
     * benched]` (`PluginsPanel.tsx:224`) — and an explicit label IS the
     * accessible name, so the family ("Synth") never appears in it however the
     * row is laid out. Match the name the app actually publishes, then assert
     * the family where it really lives: the row's visible text. Scoping Insert
     * to the row is also what the assertion always meant, and it retires a
     * `.first()` that silently accepted any row's button.
     */
    const velvet = browser.getByRole('option', { name: 'Velvet, Acme Audio, CLAP', exact: true });
    await expect(velvet).toBeVisible();
    await expect(velvet).toContainText('Synth');
    await expect(velvet.getByRole('button', { name: 'Insert', exact: true })).toBeVisible();
    await expect(browser.getByText('1 sat out', { exact: false })).toBeVisible();
    await expect(browser.getByText('Spinner', { exact: true })).toHaveCount(0);
});

test('belief-1 failure card stays polite and opens correlated Details', async ({ page }) => {
    await activateBrowser(page);
    await page.evaluate(() => {
        const bridge = (window as unknown as { __openjammerE2E: { pluginFault(name: string, kind: 'AutoBypassed'): void } }).__openjammerE2E;
        bridge.pluginFault('Surge XT', 'AutoBypassed');
    });

    const report = page.getByRole('status').filter({ hasText: 'Surge XT stopped answering.' });
    await expect(report).toBeVisible();
    await expect(report).toContainText('Everything else is still playing.');
    await report.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('dialog', { name: 'Developer Log' })).toBeVisible();
    await expect(page.getByText('Showing correlation #4242')).toBeVisible();
});
