/**
 * Boot-recovery settle-timer tests (Track B P0).
 *
 * The settle effect forgives a crash streak ONLY when the engine reaches a
 * SUSTAINED known-good LIVE state (or the uptime backstop fires). The bug this
 * guards: a brief LIVE blip armed a timer that still fired after health fell back
 * to DEAD/DEGRADED, prematurely forgiving a real crash loop. We assert:
 *   • a LIVE blip that drops to DEAD before the window does NOT settle, and
 *   • a sustained LIVE for the full window DOES settle (clears the streak).
 *
 * We observe `settle` via the persisted marker: settling rewrites it with an
 * empty `crashes` array (it keeps the session `open` — only a clean exit clears
 * that). Drives the real hook + the real engine-health store with fake timers.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { act } from 'react';

// The hook pulls in `sonner` for the "Recovered" pill; stub it (no DOM toast).
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

import { useCrashRecovery } from '../useCrashRecovery';
import { WebMarkerStore } from '../markerStore';
import { parseMarker, serializeMarker } from '../breaker';
import type { Marker } from '../types';
import { useEngineHealthStore } from '../../../store/engineHealthStore';

const SETTLE_AFTER_LIVE_MS = 8_000;

/** Seed a clean-prior-exit marker carrying recent crashes (inside the window). */
function seedMarkerWithCrashes(): void {
    const m: Marker = {
        v: 1,
        open: false, // a clean prior exit ⇒ the boot effect won't add a crash
        bootSeq: 5,
        instanceId: 'i',
        loadedSnapshotId: null,
        crashes: [{ bootSeq: 5, at: 0, snapshotId: 's', stage: undefined }],
    };
    new WebMarkerStore().write(serializeMarker(m));
}

function currentCrashCount(): number {
    return parseMarker(new WebMarkerStore().read())?.crashes.length ?? 0;
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useCrashRecovery settle timer', () => {
    it('does NOT forgive the streak on a brief LIVE blip that falls back to DEAD', () => {
        seedMarkerWithCrashes();
        renderHook(() => useCrashRecovery());
        // After boot, the streak is still recorded (the session is open again).
        expect(currentCrashCount()).toBeGreaterThan(0);

        // A brief LIVE, then a fall to DEAD well before the settle window.
        act(() => useEngineHealthStore.getState().setHealth('LIVE', 'up'));
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS / 2));
        act(() => useEngineHealthStore.getState().setHealth('DEAD', 'stream down'));
        // Advance past where the (now-disarmed) blip timer WOULD have fired.
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS));

        // The crash streak must still be intact — a blip never forgives it.
        expect(currentCrashCount()).toBeGreaterThan(0);
    });

    it('forgives the streak after a SUSTAINED LIVE for the full window', () => {
        seedMarkerWithCrashes();
        renderHook(() => useCrashRecovery());
        expect(currentCrashCount()).toBeGreaterThan(0);

        act(() => useEngineHealthStore.getState().setHealth('LIVE', 'up'));
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS));

        // A sustained LIVE reached the window ⇒ the streak is forgiven.
        expect(currentCrashCount()).toBe(0);
    });

    it('re-arms after a DEAD dip: a later sustained LIVE still settles', () => {
        seedMarkerWithCrashes();
        renderHook(() => useCrashRecovery());

        act(() => useEngineHealthStore.getState().setHealth('LIVE', 'up'));
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS / 2));
        act(() => useEngineHealthStore.getState().setHealth('DEGRADED', 'wobble'));
        // The blip timer was disarmed; nothing settles yet.
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS));
        expect(currentCrashCount()).toBeGreaterThan(0);

        // It comes back and stays live for the full window ⇒ now it settles.
        act(() => useEngineHealthStore.getState().setHealth('LIVE', 'recovered'));
        act(() => vi.advanceTimersByTime(SETTLE_AFTER_LIVE_MS));
        expect(currentCrashCount()).toBe(0);
    });
});
