/**
 * Stale-bundle guard tests.
 *
 * Pin the desktop staleness recovery: it is a no-op in the browser and when the
 * bundle and native versions agree, it cache-busts exactly ONCE on a mismatch,
 * and it never loops (a re-entry with the bust marker already set does nothing).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauriMock, getInvokeMock } = vi.hoisted(() => ({
    isTauriMock: vi.fn(),
    getInvokeMock: vi.fn(),
}));

vi.mock('../../ai/tauri', () => ({
    isTauri: isTauriMock,
    getInvoke: getInvokeMock,
}));

import { recoverFromStaleBundle } from '../staleBundleGuard';

let replaceSpy: ReturnType<typeof vi.fn>;

/** Install a fake `window.location` with a controllable query + a replace spy. */
function setLocation(search: string): void {
    replaceSpy = vi.fn();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { pathname: '/', search, hash: '', replace: replaceSpy },
    });
}

/** A `getInvoke` that returns an invoke resolving `update_status.current_version`. */
function nativeVersion(version: string): void {
    const invoke = vi.fn(async () => ({ current_version: version }));
    getInvokeMock.mockReturnValue(invoke);
}

beforeEach(() => {
    vi.clearAllMocks();
    setLocation('');
    // The bundle's build-time version (normally inlined by vite's define).
    (globalThis as Record<string, unknown>).__APP_VERSION__ = '1.0.0';
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
});

describe('recoverFromStaleBundle', () => {
    it('is a no-op in the browser (not Tauri)', async () => {
        isTauriMock.mockReturnValue(false);
        await recoverFromStaleBundle();
        expect(getInvokeMock).not.toHaveBeenCalled();
        expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('does nothing when the native version matches the bundle', async () => {
        isTauriMock.mockReturnValue(true);
        nativeVersion('1.0.0');
        await recoverFromStaleBundle();
        expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('cache-busts once when the native version is newer (stale bundle)', async () => {
        isTauriMock.mockReturnValue(true);
        nativeVersion('2.0.0');
        await recoverFromStaleBundle();
        expect(replaceSpy).toHaveBeenCalledTimes(1);
        expect(replaceSpy).toHaveBeenCalledWith('/?oj_cb=2.0.0');
    });

    it('does not loop: re-entry with the bust marker already set is a no-op', async () => {
        isTauriMock.mockReturnValue(true);
        nativeVersion('2.0.0');
        setLocation('?oj_cb=2.0.0');
        await recoverFromStaleBundle();
        expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('never throws when the bundle version is unavailable', async () => {
        isTauriMock.mockReturnValue(true);
        nativeVersion('2.0.0');
        delete (globalThis as Record<string, unknown>).__APP_VERSION__;
        await expect(recoverFromStaleBundle()).resolves.toBeUndefined();
        expect(replaceSpy).not.toHaveBeenCalled();
    });
});
