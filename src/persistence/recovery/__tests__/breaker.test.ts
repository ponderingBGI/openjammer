/**
 * Pure breaker-logic tests (Track B P0). No DOM, no clock — just the decision.
 */

import { describe, it, expect } from 'vitest';
import {
    decideRecovery,
    parseMarker,
    serializeMarker,
    snapshotCrashCount,
    streakCount,
    pruneCrashes,
    freshMarker,
} from '../breaker';
import { DEFAULT_BREAKER_CONFIG, type CrashRecord, type RecoveryInput } from '../types';

const base: RecoveryInput = {
    markerReadable: true,
    dirty: true,
    payloadPresent: true,
    snapshotCrashCount: 0,
    streakCount: 0,
};

describe('decideRecovery', () => {
    it('opens clean when the prior session closed cleanly', () => {
        expect(decideRecovery({ ...base, dirty: false })).toBe('clean');
    });

    it('opens clean on a dirty boot with nothing to restore', () => {
        expect(decideRecovery({ ...base, payloadPresent: false })).toBe('clean');
    });

    it('restores a fresh payload on a dirty boot', () => {
        expect(decideRecovery(base)).toBe('restore');
    });

    it('quarantines and falls back when the candidate already crashed', () => {
        expect(decideRecovery({ ...base, snapshotCrashCount: 1 })).toBe('quarantine-and-fallback');
    });

    it('enters Safe Mode once the streak hits the threshold', () => {
        const cfg = DEFAULT_BREAKER_CONFIG;
        expect(decideRecovery({ ...base, streakCount: cfg.safeModeThreshold })).toBe('safe-mode');
    });

    it('FAILS TOWARD Safe Mode when the breaker is unreadable but a payload exists', () => {
        // The founder's fear: an evicted/torn breaker must not blindly restore a
        // possibly-poison payload — it must escalate to Safe Mode.
        expect(decideRecovery({ ...base, markerReadable: false })).toBe('safe-mode');
    });

    it('opens clean when the breaker is unreadable and there is nothing to lose', () => {
        expect(decideRecovery({ ...base, markerReadable: false, payloadPresent: false })).toBe('clean');
    });
});

describe('streakCount (clock-skew-proof, by boot sequence)', () => {
    const crashes: CrashRecord[] = [
        { bootSeq: 10, at: 0, snapshotId: 'a' },
        { bootSeq: 11, at: 0, snapshotId: 'b' },
        { bootSeq: 12, at: 0, snapshotId: 'c' },
        { bootSeq: 3, at: 0, snapshotId: 'old' },
    ];
    it('counts only crashes inside the boot window', () => {
        // window = 6 boots; current boot 13 ⇒ counts bootSeq > 7 (10,11,12) = 3.
        expect(streakCount(crashes, 13)).toBe(3);
    });
    it('a backward wall-clock jump cannot change the count (it is boot-based)', () => {
        // Same crashes, same current boot — timestamps are irrelevant to gating.
        const skewed = crashes.map((c) => ({ ...c, at: -999999 }));
        expect(streakCount(skewed, 13)).toBe(streakCount(crashes, 13));
    });
    it('ages crashes out as boots advance', () => {
        expect(streakCount(crashes, 20)).toBe(0);
    });
});

describe('snapshotCrashCount', () => {
    const crashes: CrashRecord[] = [
        { bootSeq: 1, at: 0, snapshotId: 'x' },
        { bootSeq: 2, at: 0, snapshotId: 'x' },
        { bootSeq: 3, at: 0, snapshotId: 'y' },
    ];
    it('counts per snapshot', () => {
        expect(snapshotCrashCount(crashes, 'x')).toBe(2);
        expect(snapshotCrashCount(crashes, 'y')).toBe(1);
        expect(snapshotCrashCount(crashes, 'z')).toBe(0);
    });
    it('a null snapshot id never matches', () => {
        expect(snapshotCrashCount(crashes, null)).toBe(0);
    });
});

describe('marker (de)serialization is fail-safe', () => {
    it('round-trips a marker', () => {
        const m = { ...freshMarker('inst-1'), open: true, bootSeq: 5 };
        expect(parseMarker(serializeMarker(m))).toEqual(m);
    });
    it('returns null for null / garbage / wrong-version input', () => {
        expect(parseMarker(null)).toBeNull();
        expect(parseMarker('not json {')).toBeNull();
        expect(parseMarker('123')).toBeNull();
        expect(parseMarker(JSON.stringify({ v: 2, open: true }))).toBeNull();
        expect(parseMarker(JSON.stringify({ v: 1, open: 'yes' }))).toBeNull();
    });
    it('drops malformed crash records but keeps the valid ones', () => {
        const raw = JSON.stringify({
            v: 1,
            open: true,
            bootSeq: 7,
            instanceId: 'i',
            loadedSnapshotId: null,
            crashes: [{ bootSeq: 6, at: 1, snapshotId: 's' }, { junk: true }, 42],
        });
        const m = parseMarker(raw);
        expect(m?.crashes).toEqual([{ bootSeq: 6, at: 1, snapshotId: 's', stage: undefined }]);
    });
});

describe('pruneCrashes keeps the marker bounded', () => {
    it('drops records well outside the window but keeps recent history', () => {
        const crashes: CrashRecord[] = Array.from({ length: 50 }, (_, i) => ({
            bootSeq: i,
            at: 0,
            snapshotId: `s${i}`,
        }));
        const pruned = pruneCrashes(crashes, 49);
        expect(pruned.length).toBeLessThanOrEqual(DEFAULT_BREAKER_CONFIG.streakWindowBoots * 2);
        expect(pruned.every((c) => 49 - c.bootSeq < DEFAULT_BREAKER_CONFIG.streakWindowBoots * 2)).toBe(true);
    });
});
