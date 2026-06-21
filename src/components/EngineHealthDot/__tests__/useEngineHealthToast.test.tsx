/**
 * useEngineHealthToast (Phase 2) — the engine-dead toast policy.
 *
 * The covenant: a fault storm must yield ONE calm signal, never a storm, never a
 * per-fault toast, and DEGRADED must stay ambient (the dot only). We assert:
 *   • DEGRADED raises NO toast.
 *   • The first transition into DEAD raises exactly one.
 *   • Re-entering DEAD within the cooldown is deduped to zero extra toasts.
 *   • Leaving DEAD (recovery) DISMISSES the dead toast — no stale line lingers.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { act } from 'react';

const errorSpy = vi.fn();
const dismissSpy = vi.fn();
vi.mock('sonner', () => ({
    toast: {
        error: (...args: unknown[]) => errorSpy(...args),
        dismiss: (...args: unknown[]) => dismissSpy(...args),
    },
}));

import { useEngineHealthToast } from '../useEngineHealthToast';
import { useEngineHealthStore } from '../../../store/engineHealthStore';

afterEach(() => {
    cleanup();
    useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
});

beforeEach(() => {
    errorSpy.mockClear();
    dismissSpy.mockClear();
    useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
});

describe('useEngineHealthToast', () => {
    it('stays silent for DEGRADED (a held note beats a glitch)', () => {
        renderHook(() => useEngineHealthToast());
        act(() => useEngineHealthStore.getState().setHealth('DEGRADED', 'compile rejected'));
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('fires exactly once on the transition into DEAD', () => {
        renderHook(() => useEngineHealthToast());
        act(() => useEngineHealthStore.getState().setHealth('DEAD', 'stream down'));
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('dedupes a fault storm into one toast (re-entering DEAD is silent)', () => {
        renderHook(() => useEngineHealthToast());
        act(() => useEngineHealthStore.getState().setHealth('DEAD', 'fault 1'));
        // A burst: degrade then dead again, all within the cooldown window.
        act(() => useEngineHealthStore.getState().setHealth('DEGRADED', 'recovering'));
        act(() => useEngineHealthStore.getState().setHealth('DEAD', 'fault 2'));
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('dismisses the dead toast on recovery (no stale "Sound stopped" lingers)', () => {
        renderHook(() => useEngineHealthToast());
        act(() => useEngineHealthStore.getState().setHealth('DEAD', 'stream down'));
        act(() => useEngineHealthStore.getState().setHealth('DEGRADED', 'recovered'));
        // Recovery is silent (no new error toast) but the stale dead toast is cleared.
        expect(dismissSpy).toHaveBeenCalledWith('engine-health-dead');
    });
});
