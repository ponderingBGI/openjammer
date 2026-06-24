/**
 * PluginsPanel — toggle, the browser "desktop-only" state, and the native
 * scan→list path (mocking the Tauri invoke).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
let tauriPresent = false;
vi.mock('../../../ai/tauri', () => ({
    isTauri: () => tauriPresent,
    getInvoke: () => (tauriPresent ? invokeMock : null),
}));

import { PluginsPanel } from '../PluginsPanel';

beforeEach(() => {
    invokeMock.mockReset();
    tauriPresent = false;
});
afterEach(() => cleanup());

function open(): void {
    act(() => window.dispatchEvent(new CustomEvent('openjammer:toggle-plugins')));
}

/** Mock the three native commands the panel fans out to on scan. `backend:
 *  'reject'` simulates an older binary that lacks the `hosting_backend` command. */
function mockNative(opts: {
    plugins?: unknown[];
    dirs?: unknown[];
    backend?: { backend: string; formats: string[] } | 'reject';
}): void {
    const plugins = opts.plugins ?? [];
    const dirs = opts.dirs ?? [];
    const backend = opts.backend ?? { backend: 'juce', formats: ['vst3', 'clap'] };
    invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'scan_plugins') return Promise.resolve(plugins);
        if (cmd === 'plugin_dirs') return Promise.resolve(dirs);
        if (cmd === 'hosting_backend') {
            return backend === 'reject'
                ? Promise.reject(new Error('unknown command'))
                : Promise.resolve(backend);
        }
        return Promise.resolve(null); // reveal_path etc.
    });
}

describe('PluginsPanel', () => {
    it('is hidden until toggled', () => {
        render(<PluginsPanel />);
        expect(screen.queryByRole('dialog', { name: /plugins/i })).toBeNull();
        open();
        expect(screen.getByRole('dialog', { name: /plugins/i })).toBeTruthy();
    });

    it('shows the desktop-only note in a plain browser', () => {
        tauriPresent = false;
        render(<PluginsPanel />);
        open();
        expect(screen.getByText(/desktop app/i)).toBeTruthy();
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('scans + lists installed plugins under Tauri', async () => {
        tauriPresent = true;
        invokeMock.mockResolvedValue([
            {
                uid: 'com.acme.reverb',
                name: 'Acme Reverb',
                vendor: 'Acme',
                path: '/p/AcmeReverb.clap',
                format: 'Clap',
                is_instrument: false,
                ports: { audio_in: 2, audio_out: 2 },
                param_count: 5,
                latency_samples: 0,
            },
        ]);
        render(<PluginsPanel />);
        open();
        await waitFor(() => expect(screen.getByText('Acme Reverb')).toBeTruthy());
        expect(invokeMock).toHaveBeenCalledWith('scan_plugins', { dirs: [] });
        expect(screen.getByText('Clap')).toBeTruthy();
        expect(screen.getByText('effect')).toBeTruthy();
    });

    it('shows an empty-state hint when hosting is on but nothing is found', async () => {
        tauriPresent = true;
        mockNative({ plugins: [], backend: { backend: 'juce', formats: ['vst3', 'clap'] } });
        render(<PluginsPanel />);
        open();
        await waitFor(() => expect(screen.getByText(/No plugins found/i)).toBeTruthy());
    });

    it('explains hosting is OFF in a scaffold build and points at `bun native --all`', async () => {
        tauriPresent = true;
        // Scaffold (`none`) can never list a plugin — so it must not pretend a
        // folder drop + Re-scan would help, and must not dump the folder list.
        mockNative({
            plugins: [],
            dirs: [{ path: 'C:\\Program Files\\Common Files\\VST3', scope: 'system' }],
            backend: { backend: 'none', formats: [] },
        });
        render(<PluginsPanel />);
        open();
        await waitFor(() => expect(screen.getByText(/hosting is off/i)).toBeTruthy());
        expect(screen.getByText(/bun native --all/i)).toBeTruthy();
        expect(screen.queryByText(/Common Files\\VST3/)).toBeNull();
    });

    it('flags a CLAP-only build so a missing VST3 is explained', async () => {
        tauriPresent = true;
        mockNative({ plugins: [], backend: { backend: 'clap', formats: ['clap'] } });
        render(<PluginsPanel />);
        open();
        await waitFor(() => expect(screen.getByText(/CLAP only/i)).toBeTruthy());
    });

    it('lists the real CLAP folders and opens one on demand when empty', async () => {
        tauriPresent = true;
        const clapDir = 'C:\\Program Files\\Common Files\\CLAP';
        mockNative({
            plugins: [],
            dirs: [{ path: clapDir, scope: 'system' }],
            backend: { backend: 'juce', formats: ['vst3', 'clap'] },
        });
        render(<PluginsPanel />);
        open();

        // The actual on-disk path is shown (not a generic ~/.clap example).
        await waitFor(() => expect(screen.getByText(/Common Files\\CLAP/)).toBeTruthy());

        // "Open folder" reveals exactly that path via the native command.
        act(() => screen.getByRole('button', { name: /open folder/i }).click());
        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('reveal_path', { path: clapDir }),
        );
    });
});
