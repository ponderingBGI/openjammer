/**
 * authStore (D6, M7) tests.
 *
 * Proves the WHO-PAYS store:
 *   - derives `configured` from the native `auth_status` reply;
 *   - no-ops (configured:false) in the browser / when `caps.auth === 'none'`;
 *   - relays the conflict-by-outcome flag;
 *   - PERSISTS provider + model ONLY, NEVER the key.
 *
 * The Tauri `invoke` + the capability seam are mocked so the store is exercised
 * with no Tauri, no real provider, and a deterministic capability row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, BROWSER_CAPABILITIES } from '../../engine/capabilities';

// --- Mocks -----------------------------------------------------------------

// A swappable capability row + a swappable invoke. Both are read lazily inside
// the store actions, so reassigning these between tests changes behaviour.
let caps = DESKTOP_CAPABILITIES;
const invokeMock = vi.fn();
let invokeAvailable = true;

vi.mock('../../audio/executor', () => ({
    getExecutor: () => ({ getCapabilities: () => caps }),
}));

vi.mock('../../ai/tauri', () => ({
    getInvoke: () => (invokeAvailable ? invokeMock : null),
}));

import { useAuthStore } from '../authStore';

const STORAGE_KEY = 'openjammer-auth';

function resetStore() {
    localStorage.clear();
    useAuthStore.setState({
        activeProvider: undefined,
        modelId: undefined,
        configured: false,
        conflict: false,
    });
}

describe('authStore', () => {
    beforeEach(() => {
        caps = DESKTOP_CAPABILITIES;
        invokeAvailable = true;
        invokeMock.mockReset();
        resetStore();
    });

    it('derives configured=true from a configured auth_status', async () => {
        invokeMock.mockResolvedValue({
            configured: true,
            activeProvider: 'opencode',
            modelId: 'zen-1',
            conflict: false,
        });

        await useAuthStore.getState().refreshStatus();

        expect(invokeMock).toHaveBeenCalledWith('auth_status');
        const s = useAuthStore.getState();
        expect(s.configured).toBe(true);
        expect(s.activeProvider).toBe('opencode');
        expect(s.modelId).toBe('zen-1');
        expect(s.conflict).toBe(false);
    });

    it('relays the conflict-by-outcome flag', async () => {
        invokeMock.mockResolvedValue({
            configured: true,
            activeProvider: 'anthropic',
            conflict: true,
        });
        await useAuthStore.getState().refreshStatus();
        expect(useAuthStore.getState().conflict).toBe(true);
    });

    it('no-ops to configured=false when caps.auth === none (browser)', async () => {
        caps = BROWSER_CAPABILITIES;
        await useAuthStore.getState().refreshStatus();
        expect(invokeMock).not.toHaveBeenCalled();
        expect(useAuthStore.getState().configured).toBe(false);
    });

    it('no-ops when there is no Tauri invoke (plain browser)', async () => {
        invokeAvailable = false;
        await useAuthStore.getState().refreshStatus();
        expect(useAuthStore.getState().configured).toBe(false);
    });

    it('storeKey sets the active provider and refreshes status on success', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'auth_store_key') return Promise.resolve({ ok: true });
            if (cmd === 'auth_status')
                return Promise.resolve({ configured: true, activeProvider: 'opencode', conflict: false });
            return Promise.resolve({});
        });

        const res = await useAuthStore.getState().storeKey('opencode', 'sk-zen-123');
        expect(res.ok).toBe(true);
        const s = useAuthStore.getState();
        expect(s.activeProvider).toBe('opencode');
        expect(s.configured).toBe(true);
    });

    it('validateKey relays the native result without storing', async () => {
        invokeMock.mockResolvedValue({ ok: false, notConfigured: true, message: 'stub' });
        const res = await useAuthStore.getState().validateKey('anthropic', 'sk-ant');
        expect(res.ok).toBe(false);
        expect(res.notConfigured).toBe(true);
        // validateKey alone does not flip configured.
        expect(useAuthStore.getState().configured).toBe(false);
    });

    it('forwards a BYO base URL through validateKey + storeKey (never persisted)', async () => {
        // The BYO OpenAI-compatible base URL must reach the native side, not be
        // dropped at the seam — but it is transient and must never be persisted.
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'auth_validate_key') return Promise.resolve({ ok: true });
            if (cmd === 'auth_store_key') return Promise.resolve({ ok: true });
            if (cmd === 'auth_status')
                return Promise.resolve({ configured: true, activeProvider: 'openai', conflict: false });
            return Promise.resolve({});
        });

        await useAuthStore.getState().validateKey('openai', 'sk-byo', 'https://api.example.com/v1');
        await useAuthStore.getState().storeKey('openai', 'sk-byo', 'https://api.example.com/v1');

        expect(invokeMock).toHaveBeenCalledWith('auth_validate_key', {
            provider: 'openai',
            key: 'sk-byo',
            baseUrl: 'https://api.example.com/v1',
        });
        expect(invokeMock).toHaveBeenCalledWith('auth_store_key', {
            provider: 'openai',
            key: 'sk-byo',
            baseUrl: 'https://api.example.com/v1',
        });

        // The base URL is transient: it must NOT land in the persisted blob.
        await Promise.resolve();
        const raw = localStorage.getItem(STORAGE_KEY);
        expect(raw?.toLowerCase()).not.toContain('example.com');
        expect(raw?.toLowerCase()).not.toContain('baseurl');
    });

    it('omits baseUrl from the invoke payload when none is given', async () => {
        invokeMock.mockResolvedValue({ ok: true });
        await useAuthStore.getState().validateKey('anthropic', 'sk-ant');
        expect(invokeMock).toHaveBeenCalledWith('auth_validate_key', {
            provider: 'anthropic',
            key: 'sk-ant',
        });
    });

    it('clear resets to unconfigured', async () => {
        useAuthStore.setState({ configured: true, conflict: true, activeProvider: 'codex' });
        invokeMock.mockResolvedValue(undefined);
        await useAuthStore.getState().clear();
        const s = useAuthStore.getState();
        expect(s.configured).toBe(false);
        expect(s.conflict).toBe(false);
    });

    it('PERSISTS provider + model ONLY — never a key', async () => {
        useAuthStore.getState().setProvider('opencode', 'zen-1');
        // Even if something set a derived flag, it must not be persisted.
        useAuthStore.setState({ configured: true });

        // Allow the persist middleware to flush.
        await Promise.resolve();

        const raw = localStorage.getItem(STORAGE_KEY);
        expect(raw).toBeTruthy();
        const persisted = JSON.parse(raw!).state as Record<string, unknown>;
        expect(persisted.activeProvider).toBe('opencode');
        expect(persisted.modelId).toBe('zen-1');
        // The blob must contain NO key field of any kind, and NOT the derived flags.
        const blob = raw!.toLowerCase();
        expect(blob).not.toContain('"key"');
        expect(blob).not.toContain('apikey');
        expect(persisted.configured).toBeUndefined();
        expect(persisted.conflict).toBeUndefined();
    });
});
