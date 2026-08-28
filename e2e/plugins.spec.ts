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
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('openjammer:open-browser', { detail: { context: 'insert' } })));

    const browser = page.getByRole('dialog', { name: 'Browser' });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole('option', { name: /Velvet.*Acme Audio.*Synth.*CLAP/i })).toBeVisible();
    await expect(browser.getByRole('button', { name: 'Insert', exact: true }).first()).toBeVisible();
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
