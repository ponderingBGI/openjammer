import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatesPanel } from '../UpdatesPanel';
import type { UpdateStatus } from '../../../hooks/useNativeUpdater';
import { useNativeUpdater } from '../../../hooks/useNativeUpdater';
import { useUpdatePreferences } from '../../../store/updatePreferencesStore';

vi.mock('../../../hooks/useNativeUpdater', () => ({
    useNativeUpdater: vi.fn(),
}));

const mockedUseNativeUpdater = vi.mocked(useNativeUpdater);

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
    return {
        current_version: '0.0.2',
        pending: false,
        pending_version: null,
        last_good_version: null,
        supported: true,
        platform: 'windows',
        arch: 'x86_64',
        install_kind: 'nsis',
        can_auto_update: true,
        manual_reason: null,
        ...overrides,
    };
}

function mockUpdater(overrides: Partial<ReturnType<typeof useNativeUpdater>> = {}) {
    const value: ReturnType<typeof useNativeUpdater> = {
        supported: true,
        status: status(),
        checking: false,
        error: null,
        checkNow: vi.fn(async () => null),
        installNow: vi.fn(async () => false),
        rollback: vi.fn(async () => false),
        refreshStatus: vi.fn(async () => undefined),
        ...overrides,
    };
    mockedUseNativeUpdater.mockReturnValue(value);
    return value;
}

describe('UpdatesPanel', () => {
    beforeEach(() => {
        localStorage.clear();
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
        useUpdatePreferences.setState({
            autoUpdateEnabled: true,
            updateChannel: 'stable',
            pinnedVersion: null,
        });
        mockedUseNativeUpdater.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('keeps channel and manual download controls visible in the browser', () => {
        mockUpdater({ supported: false, status: null });

        render(<UpdatesPanel />);

        expect(screen.getByRole('tablist', { name: /release channel/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Stable' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Canari' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download Stable/i })).toBeInTheDocument();
        // The hero carries the headline; the sentence that explains the tier sits
        // on the row it belongs to, so neither one has to be both.
        expect(screen.getByText('Updates apply on reload')).toBeInTheDocument();
        expect(
            screen.getByText(/browser version updates on reload; desktop channels are manual downloads/i),
        ).toBeInTheDocument();
    });

    it('keeps channel and manual download controls visible on unsupported native installs', () => {
        (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
        mockUpdater({
            status: status({
                supported: false,
                platform: 'macos',
                arch: 'aarch64',
                install_kind: 'dmg',
                can_auto_update: false,
                manual_reason: 'Manual .dmg updates until OpenJammer has Apple Developer ID notarization.',
            }),
        });

        render(<UpdatesPanel />);

        expect(screen.getByRole('tablist', { name: /release channel/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Canari' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download Stable/i })).toBeInTheDocument();
        expect(screen.getAllByText(/Manual \.dmg updates/i).length).toBeGreaterThan(0);
    });

    /*
     * HA-23 / U14 — Escape cancels the confirm and stops there. It used to fall
     * through to the Settings modal underneath, so declining a destructive
     * question closed the whole panel.
     */
    it('Escape cancels the rollback confirm without reaching Settings behind it', () => {
        (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
        mockUpdater({ status: status({ last_good_version: '0.0.1' }) });

        render(<UpdatesPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Roll back/i }));
        const confirm = screen.getByRole('alertdialog', { name: /Confirm rollback/i });

        const reachedTheDocument = vi.fn();
        document.addEventListener('keydown', reachedTheDocument);
        fireEvent.keyDown(confirm, { key: 'Escape' });
        document.removeEventListener('keydown', reachedTheDocument);

        expect(screen.queryByRole('alertdialog', { name: /Confirm rollback/i })).toBeNull();
        expect(reachedTheDocument).not.toHaveBeenCalled();
        // The panel it lives in is still there — only the question went away.
        expect(screen.getByRole('button', { name: /Roll back/i })).toBeInTheDocument();
    });

    it('checks the newly selected channel, not the previous render state', async () => {
        (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
        const updater = mockUpdater({ status: status({ can_auto_update: true }) });

        render(<UpdatesPanel />);
        fireEvent.click(screen.getByRole('tab', { name: 'Canari' }));

        await waitFor(() => expect(updater.checkNow).toHaveBeenCalledWith('canary'));
    });
});
