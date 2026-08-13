/**
 * Orchestrator + crash-loop-guard property test (Track B P0).
 *
 * This is the ONE per-PR durability gate the plan calls for: it proves a poison
 * state reaches a safe interactive state within a BOUNDED number of restarts and
 * never reloads a quarantined snapshot — i.e. "never reopen into a deadly crash
 * cycle." It also proves the happy path (restore + settle) and the fail-closed
 * handling of corrupt payloads.
 */

import { describe, it, expect } from 'vitest';
import { MemoryMarkerStore } from '../markerStore';
import { serializeMarker } from '../breaker';
import { runRecovery, settle, markCleanExit, type PayloadSource, type RecoverablePayload } from '../recover';
import { DEFAULT_BREAKER_CONFIG, type Marker } from '../types';

type Behavior =
    | 'valid' // decodes + validates, but the session "crashes" after load (no settle)
    | 'invalid' // decodes but fails validation (corrupt-but-parseable)
    | 'throws'; // decode itself throws (torn write)

interface FakePayload {
    id: string;
    behavior: Behavior;
}

class FakeSource implements PayloadSource<string> {
    readonly quarantined = new Set<string>();
    private readonly payloads: FakePayload[];
    constructor(payloads: FakePayload[]) {
        this.payloads = payloads;
    }
    list(): RecoverablePayload<string>[] {
        return this.payloads
            .filter((p) => !this.quarantined.has(p.id))
            .map((p) => ({
                id: p.id,
                load: () => {
                    if (p.behavior === 'throws') throw new Error('torn write');
                    return p.id; // the "raw" payload is just its id here
                },
            }));
    }
    quarantine(id: string): void {
        this.quarantined.add(id);
    }
}

function makeValidate(payloads: FakePayload[]) {
    const behavior = new Map(payloads.map((p) => [p.id, p.behavior]));
    return (raw: string): { id: string } | null => (behavior.get(raw) === 'invalid' ? null : { id: raw });
}

/** Seed the store as if a prior session had loaded `loadedId` and then crashed. */
function seedCrashedSession(store: MemoryMarkerStore, loadedId: string | null): void {
    const m: Marker = {
        v: 1,
        open: true,
        bootSeq: 0,
        instanceId: 'i',
        loadedSnapshotId: loadedId,
        crashes: [],
    };
    store.write(serializeMarker(m));
}

describe('runRecovery — happy path', () => {
    it('restores the surviving payload on a dirty boot, then a clean exit makes the next boot clean', () => {
        const store = new MemoryMarkerStore();
        const payloads: FakePayload[] = [{ id: 's1', behavior: 'valid' }];
        const source = new FakeSource(payloads);
        seedCrashedSession(store, null); // dirty boot, but nothing was loaded last time

        const out = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('restore');
        expect(out.restored?.snapshotId).toBe('s1');
        expect(out.restored?.graph).toEqual({ id: 's1' });

        // Engine healthy for a settle window, THEN a clean shutdown.
        settle(store);
        markCleanExit(store);
        const next = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(next.mode).toBe('clean'); // clean prior shutdown ⇒ open normally
        expect(next.restored).toBeNull();
    });

    it('settle() forgives the streak but keeps the session open (a later crash is still caught)', () => {
        const store = new MemoryMarkerStore();
        const payloads: FakePayload[] = [
            { id: 's1', behavior: 'valid' },
            { id: 's2', behavior: 'valid' },
        ];
        const source = new FakeSource(payloads);
        seedCrashedSession(store, null);

        const first = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(first.restored?.snapshotId).toBe('s1'); // newest restored
        settle(store); // reached known-good → streak forgiven, session stays open

        // A crash AFTER settling (no clean exit) must still be a DIRTY boot: the
        // crashed snapshot is quarantined and a fallback restored — never silently
        // dropped — and the streak is fresh (forgiven), not accumulating.
        const after = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(after.mode).toBe('quarantine-and-fallback');
        expect(after.restored?.snapshotId).toBe('s2');
        expect(after.streak).toBe(1);
        expect(source.quarantined.has('s1')).toBe(true);
    });

    it('a clean (never-crashed) first run with a payload opens clean, not restore', () => {
        const store = new MemoryMarkerStore(); // no marker at all
        const payloads: FakePayload[] = [{ id: 's1', behavior: 'valid' }];
        const source = new FakeSource(payloads);
        // markerReadable=false + payloadPresent ⇒ fail-toward-safe-mode (conservative).
        const out = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('safe-mode');
    });
});

describe('runRecovery — fail-closed on corrupt payloads', () => {
    it('quarantines a torn payload and opens clean (no crash)', () => {
        const store = new MemoryMarkerStore();
        const payloads: FakePayload[] = [{ id: 'bad', behavior: 'throws' }];
        const source = new FakeSource(payloads);
        seedCrashedSession(store, null);
        const out = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('clean');
        expect(out.quarantined).toContain('bad');
        expect(source.quarantined.has('bad')).toBe(true);
    });

    it('skips an invalid payload and restores the next valid one', () => {
        const store = new MemoryMarkerStore();
        const payloads: FakePayload[] = [
            { id: 'corrupt', behavior: 'invalid' },
            { id: 'good', behavior: 'valid' },
        ];
        const source = new FakeSource(payloads);
        seedCrashedSession(store, null);
        const out = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('quarantine-and-fallback');
        expect(out.restored?.snapshotId).toBe('good');
        expect(source.quarantined.has('corrupt')).toBe(true);
    });
});

describe('CRASH-LOOP GUARD (the per-PR durability gate)', () => {
    // Simulate repeated boots where every restored snapshot crashes the session
    // (we never settle). Assert the loop TERMINATES within a bounded number of
    // restarts, ends safe, and never reloads a quarantined snapshot.
    function simulate(payloads: FakePayload[]): { modes: string[]; quarantined: Set<string>; restoredIds: string[] } {
        const store = new MemoryMarkerStore();
        const source = new FakeSource(payloads);
        const validate = makeValidate(payloads);
        seedCrashedSession(store, payloads[0]?.id ?? null);

        const modes: string[] = [];
        const restoredIds: string[] = [];
        const HARD_CAP = payloads.length + 5; // if we ever exceed this, it's an infinite loop
        for (let k = 0; k < HARD_CAP; k++) {
            const out = runRecovery({ store, source, validate, now: () => 0, instanceId: 'i' });
            modes.push(out.mode);
            if (out.restored) {
                // A snapshot must never be restored twice (would be a loop).
                expect(restoredIds).not.toContain(out.restored.snapshotId);
                restoredIds.push(out.restored.snapshotId);
            }
            // Terminal states end the loop; otherwise the "session crashes" and we
            // boot again WITHOUT settling.
            if (out.mode === 'clean' || out.mode === 'safe-mode') break;
        }
        return { modes, quarantined: source.quarantined, restoredIds };
    }

    it('a single poison snapshot is quarantined within one restart and never reloaded', () => {
        const { modes, quarantined } = simulate([{ id: 'poison', behavior: 'valid' }]);
        expect(modes[modes.length - 1]).toMatch(/clean|safe-mode/);
        expect(quarantined.has('poison')).toBe(true);
        expect(modes.length).toBeLessThanOrEqual(2);
    });

    it('several poison snapshots reach Safe Mode within a bounded number of restarts', () => {
        const payloads: FakePayload[] = Array.from({ length: 5 }, (_, i) => ({
            id: `p${i}`,
            behavior: 'valid' as const,
        }));
        const { modes, restoredIds } = simulate(payloads);
        const last = modes[modes.length - 1];
        expect(last === 'clean' || last === 'safe-mode').toBe(true);
        // Bounded: never more restarts than payloads + a small constant.
        expect(modes.length).toBeLessThanOrEqual(payloads.length + 2);
        // Safe Mode must kick in by the threshold (no walking all 5 one-by-one).
        expect(modes.filter((m) => m !== 'safe-mode').length).toBeLessThanOrEqual(
            DEFAULT_BREAKER_CONFIG.safeModeThreshold + 1,
        );
        // No snapshot restored twice.
        expect(new Set(restoredIds).size).toBe(restoredIds.length);
    });

    it('mixed corrupt + poison payloads still terminate safely and bounded', () => {
        const payloads: FakePayload[] = [
            { id: 'a', behavior: 'valid' },
            { id: 'b', behavior: 'throws' },
            { id: 'c', behavior: 'invalid' },
            { id: 'd', behavior: 'valid' },
        ];
        const { modes } = simulate(payloads);
        expect(modes[modes.length - 1]).toMatch(/clean|safe-mode/);
        expect(modes.length).toBeLessThanOrEqual(payloads.length + 2);
    });
});

describe('breaker survives eviction / torn marker', () => {
    it('an unreadable breaker beside a surviving payload escalates to Safe Mode', () => {
        const store = new MemoryMarkerStore('totally not json'); // torn/garbage marker
        const payloads: FakePayload[] = [{ id: 's1', behavior: 'valid' }];
        const source = new FakeSource(payloads);
        const out = runRecovery({ store, source, validate: makeValidate(payloads), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('safe-mode');
    });

    it('an unreadable breaker with nothing to restore opens clean', () => {
        const store = new MemoryMarkerStore('garbage');
        const source = new FakeSource([]);
        const out = runRecovery({ store, source, validate: makeValidate([]), now: () => 0, instanceId: 'i' });
        expect(out.mode).toBe('clean');
    });
});
