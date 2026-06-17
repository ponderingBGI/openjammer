/**
 * PwaUpdatePrompt — apply-on-idle: auto-update only while audio is idle, prompt
 * (never auto-reload) while audio is running.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const updateSW = vi.fn();
let needRefresh = false;
vi.mock('../../hooks/usePWA', () => ({
    useServiceWorker: () => ({
        offlineReady: false,
        needRefresh,
        updateServiceWorker: updateSW,
        dismissUpdate: () => {},
    }),
}));

const toastFn = vi.fn();
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => toastFn(...a) }));

import { PwaUpdatePrompt } from '../PwaUpdatePrompt';
import { useAudioStore } from '../../store/audioStore';

beforeEach(() => {
    vi.useFakeTimers();
    updateSW.mockClear();
    toastFn.mockClear();
    needRefresh = false;
    useAudioStore.getState().setAudioContextReady(false);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('PwaUpdatePrompt', () => {
    it('auto-applies the update when audio is idle', () => {
        needRefresh = true;
        useAudioStore.getState().setAudioContextReady(false);
        render(<PwaUpdatePrompt />);
        expect(updateSW).not.toHaveBeenCalled(); // grace period
        act(() => vi.advanceTimersByTime(1600));
        expect(updateSW).toHaveBeenCalledTimes(1);
        expect(toastFn).not.toHaveBeenCalled();
    });

    it('does NOT auto-reload while audio is running — it prompts instead', () => {
        needRefresh = true;
        useAudioStore.getState().setAudioContextReady(true);
        render(<PwaUpdatePrompt />);
        act(() => vi.advanceTimersByTime(5000));
        expect(updateSW).not.toHaveBeenCalled();
        expect(toastFn).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no update is pending', () => {
        needRefresh = false;
        render(<PwaUpdatePrompt />);
        act(() => vi.advanceTimersByTime(5000));
        expect(updateSW).not.toHaveBeenCalled();
        expect(toastFn).not.toHaveBeenCalled();
    });
});
