/**
 * U3 — the song survives a clean close.
 *
 * The canvas was durable and the song was not. `zustand/persist` brought the
 * graph back on every reopen; the arrangement lived only in the emergency
 * backup, and the only reader of that backup was gated on the previous session
 * having CRASHED. So a clean goodbye deleted the half a player calls "my song",
 * with the whole thing still on disk (UX-INV Q3 — S1 data loss, FH-1 F13).
 *
 * These pin the four things that make reading it back SAFE:
 *   1. a clean reopen restores tracks, clips and notes,
 *   2. it costs no history — the first Ctrl+Z must not delete the song,
 *   3. a quarantined snapshot is still never auto-loaded,
 *   4. the crash path is untouched (its toast, its graph load, its breaker).
 * Plus the ordering that makes the backup worth reading at all: the flush runs
 * BEFORE the clean-exit marker, in one handler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        pauseContinuousSources: vi.fn(),
        resumeContinuousSources: vi.fn(),
        setArrangementLoop: vi.fn(),
        setArrangementPunch: vi.fn(),
        setArrangementClick: vi.fn(),
        setArrangementCountIn: vi.fn(),
        subscribeSignalLevels: () => () => {},
        subscribeTransport: () => () => {},
        getTimelineBackend: () => 'wasm',
    }),
    isTauri: () => false,
}));

const { useCrashRecovery } = await import('../useCrashRecovery');
const { EMERGENCY_KEY, clearEmergencyBackup, writeEmergencyBackup } = await import('../webPayloads');
const { registerEmergencyFlush } = await import('../emergencyFlush');
const { serializeMarker, freshMarker, parseMarker } = await import('../breaker');
const { WebMarkerStore } = await import('../markerStore');
const { useArrangementStore } = await import('../../../store/arrangementStore');
const { useGraphStore } = await import('../../../store/graphStore');
const { useHistoryStore } = await import('../../../store/historyStore');

const QUARANTINE_INDEX_KEY = 'openjammer-recovery-quarantine';

/** A three-note song on one bound track — the thing FH-1 lost. */
function song() {
    return {
        name: 'Untitled song',
        schemaVersion: 2,
        tempoBpm: 120,
        ppq: 960,
        timeSignature: [4, 4] as [number, number],
        graph: { nodes: [{ ref: 'voice', type: 'instrument' }] },
        sources: {
            'src:midi:m0': {
                id: 'src:midi:m0',
                kind: 'midi' as const,
                name: 'Take',
                lengthTick: 3840,
                notes: [
                    { tick: 0, durTick: 480, pitch: 60, vel: 100 },
                    { tick: 960, durTick: 480, pitch: 64, vel: 100 },
                    { tick: 1920, durTick: 480, pitch: 67, vel: 100 },
                ],
            },
        },
        tracks: [{ id: 'track-1', name: 'Track 1', ref: 'voice', clips: [{ sourceId: 'src:midi:m0', startTick: 0, lengthTick: 3840 }] }],
    };
}

function seedBackup(now = 1_000) {
    writeEmergencyBackup({ nodes: [{ id: 'n1' }], edges: [], arrangement: song() as never, now });
}

/** The previous session closed cleanly — the ordinary reopen. */
function seedCleanMarker() {
    new WebMarkerStore().write(serializeMarker({ ...freshMarker('inst-1'), open: false, bootSeq: 3 }));
}

/** The previous session never closed — the crash path. */
function seedDirtyMarker() {
    new WebMarkerStore().write(serializeMarker({ ...freshMarker('inst-1'), open: true, bootSeq: 3 }));
}

function restoredNoteCount(): number {
    const arr = useArrangementStore.getState().arrangement;
    if (!arr) return 0;
    return Object.values(arr.sources ?? {}).reduce(
        (total, source) => total + (source.kind === 'midi' ? source.notes.length : 0),
        0,
    );
}

beforeEach(() => {
    localStorage.clear();
    toastSuccess.mockClear();
    useArrangementStore.getState().setArrangement(null);
    useGraphStore.getState().clearGraph();
    useHistoryStore.getState().clear();
});

afterEach(cleanup);

describe('U3 — a clean close keeps the song', () => {
    it('brings tracks, clips and notes back on an ordinary reopen', () => {
        seedBackup();
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        const arr = useArrangementStore.getState().arrangement;
        expect(arr?.tracks).toHaveLength(1);
        expect(arr?.tracks[0]!.clips).toHaveLength(1);
        expect(restoredNoteCount()).toBe(3);
    });

    it('says nothing — an ordinary reopen is not an incident', () => {
        seedBackup();
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        expect(toastSuccess).not.toHaveBeenCalled();
    });

    /*
     * The whole point of not routing this through `apply()`. A restore that
     * lands in the command log means the first thing a player presses after
     * reopening — Ctrl+Z, the most reflexive key in the app — deletes the song
     * they just got back.
     */
    it('costs no undo step, so the first Ctrl+Z cannot delete the song', () => {
        seedBackup();
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        expect(useHistoryStore.getState().canUndo()).toBe(false);
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });

    it('leaves the backup on disk — it is the document, not a report', () => {
        seedBackup();
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        expect(localStorage.getItem(EMERGENCY_KEY)).not.toBeNull();
    });

    it('pins the snapshot it loaded, so a crash on it is still attributable', () => {
        seedBackup(1_000);
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        expect(parseMarker(new WebMarkerStore().read())?.loadedSnapshotId).toBe('emergency:1000');
    });

    it('never auto-loads a quarantined snapshot', () => {
        seedBackup(1_000);
        localStorage.setItem(QUARANTINE_INDEX_KEY, JSON.stringify([{ id: 'emergency:1000', bootSeq: 2, reason: 'corrupt-or-invalid' }]));
        seedCleanMarker();

        renderHook(() => useCrashRecovery());

        expect(useArrangementStore.getState().arrangement).toBeNull();
    });

    it('opens empty rather than throwing when the backup is torn', () => {
        localStorage.setItem('openjammer-emergency-backup', '{"nodes":[],"edges":[],"timestamp":1,"arrangement":{"tracks":"not a list"}}');
        seedCleanMarker();

        expect(() => renderHook(() => useCrashRecovery())).not.toThrow();
        expect(useArrangementStore.getState().arrangement).toBeNull();
    });

    /* The crash path is not what changed, and must not have. */
    it('still restores the graph AND announces itself after an unclean shutdown', () => {
        seedBackup();
        seedDirtyMarker();

        renderHook(() => useCrashRecovery());

        expect(useGraphStore.getState().nodes.size).toBe(1);
        expect(useArrangementStore.getState().arrangement?.tracks).toHaveLength(1);
        expect(toastSuccess).toHaveBeenCalledWith('Recovered your work', expect.anything());
    });
});

/*
 * G-13. The flush used to return early on an empty document — "don't clobber a
 * good backup with empty" — which only ever affected the canvas, and
 * `zustand/persist` owned that anyway. Now that a clean boot RESTORES from this
 * blob, keeping the old one hands a deliberately deleted song straight back.
 */
describe('U3 — an emptied document does not resurrect itself', () => {
    it('is not restored on the next clean boot', () => {
        seedBackup();
        seedCleanMarker();
        // The player cleared everything; App's flush ran on an empty document.
        clearEmergencyBackup();

        renderHook(() => useCrashRecovery());

        expect(useArrangementStore.getState().arrangement).toBeNull();
        expect(useGraphStore.getState().nodes.size).toBe(0);
    });
});

describe('U3 — the flush runs before the goodbye', () => {
    it('writes the pending backup, THEN marks the clean exit, from one handler', () => {
        seedCleanMarker();
        const order: string[] = [];
        const unregister = registerEmergencyFlush(() => {
            order.push('flush');
            // The marker must still be open at this instant: the document has to
            // reach disk before anything claims the session ended cleanly.
            expect(parseMarker(new WebMarkerStore().read())?.open).toBe(true);
        });

        renderHook(() => useCrashRecovery());
        window.dispatchEvent(new Event('pagehide'));
        order.push('marked');

        expect(order).toEqual(['flush', 'marked']);
        expect(parseMarker(new WebMarkerStore().read())?.open).toBe(false);
        unregister();
    });
});
