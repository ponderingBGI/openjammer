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

    it('shows an empty-state hint when no plugins are found', async () => {
        tauriPresent = true;
        invokeMock.mockResolvedValue([]);
        render(<PluginsPanel />);
        open();
        await waitFor(() => expect(screen.getByText(/No plugins found/i)).toBeTruthy());
    });
});
