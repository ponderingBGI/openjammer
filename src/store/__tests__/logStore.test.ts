import { describe, it, expect, beforeEach } from 'vitest';
import type { Event as EngineEvent } from '@openjammer/oj-protocol';
import {
    useLogStore,
    _resetLogStoreForTests,
    filterEntries,
    levelCounts,
    scopeCounts,
    engineEventToEntry,
    LOG_CAPACITY,
    type LogEntry,
    type LogEntryInput,
    type LogView,
} from '../logStore';

/** Convenience: append a partial entry through the store. */
function append(entry: Partial<LogEntryInput> = {}): void {
    useLogStore.getState().append({
        level: entry.level ?? 'Info',
        source: entry.source ?? 'Ui',
        scope: entry.scope ?? 'test',
        message: entry.message ?? 'hello',
        ...(entry.fields !== undefined ? { fields: entry.fields } : {}),
        ...(entry.corr !== undefined ? { corr: entry.corr } : {}),
    });
}

/** Build a full-options view with sensible "match everything" defaults. */
function makeView(overrides: Partial<LogView> = {}): LogView {
    return {
        levels: overrides.levels ?? null,
        scope: overrides.scope ?? null,
        search: overrides.search ?? '',
        corr: overrides.corr ?? null,
    };
}

describe('logStore', () => {
    beforeEach(() => {
        _resetLogStoreForTests();
    });

    describe('append', () => {
        it('appends entries with monotonic ids and a stamped timestamp', () => {
            append({ message: 'a' });
            append({ message: 'b' });

            const { entries } = useLogStore.getState();
            expect(entries.map((e) => e.message)).toEqual(['a', 'b']);
            expect(entries[0].id).toBeLessThan(entries[1].id);
            expect(typeof entries[0].ts).toBe('number');
        });

        it('respects the capacity and increments droppedCount on eviction', () => {
            // Fill exactly to capacity — no drops yet.
            for (let i = 0; i < LOG_CAPACITY; i++) append({ message: `m${i}` });
            expect(useLogStore.getState().entries).toHaveLength(LOG_CAPACITY);
            expect(useLogStore.getState().droppedCount).toBe(0);

            // Three more — oldest evicted, count bumps by 3, length stays capped.
            append({ message: 'overflow-1' });
            append({ message: 'overflow-2' });
            append({ message: 'overflow-3' });

            const state = useLogStore.getState();
            expect(state.entries).toHaveLength(LOG_CAPACITY);
            expect(state.droppedCount).toBe(3);
            // Oldest three (m0, m1, m2) are gone; newest is overflow-3.
            expect(state.entries[0].message).toBe('m3');
            expect(state.entries[state.entries.length - 1].message).toBe('overflow-3');
        });
    });

    describe('clear', () => {
        it('empties the ring and resets droppedCount', () => {
            for (let i = 0; i < LOG_CAPACITY + 5; i++) append({ message: `m${i}` });
            expect(useLogStore.getState().droppedCount).toBeGreaterThan(0);

            useLogStore.getState().clear();
            expect(useLogStore.getState().entries).toHaveLength(0);
            expect(useLogStore.getState().droppedCount).toBe(0);
        });
    });

    describe('ingestEngineEvent', () => {
        it('maps a unit-variant EventKind to a LogEntry', () => {
            const event: EngineEvent = {
                v: 1,
                seq: 7,
                severity: 'Info',
                kind: 'Lifecycle',
                source: 'Engine',
                ts_us: 5_000_000,
                corr_id: 0,
            };

            useLogStore.getState().ingestEngineEvent(event);
            const [entry] = useLogStore.getState().entries;
            expect(entry.level).toBe('Info');
            expect(entry.source).toBe('Engine');
            expect(entry.scope).toBe('engine');
            expect(entry.message).toBe('Lifecycle');
            // ts_us (microseconds) → ts (milliseconds).
            expect(entry.ts).toBe(5000);
            // corr_id 0 means "no correlation".
            expect(entry.corr).toBeUndefined();
        });

        it('maps a struct-variant EventKind (NodeFault) including corr id', () => {
            const event: EngineEvent = {
                v: 1,
                seq: 8,
                severity: 'Warn',
                kind: { NodeFault: { node: 3, fault: 'OverBudget' } },
                source: 'Wasm',
                ts_us: 1234,
                corr_id: 42,
            };

            useLogStore.getState().ingestEngineEvent(event);
            const [entry] = useLogStore.getState().entries;
            expect(entry.level).toBe('Warn');
            expect(entry.scope).toBe('wasm');
            expect(entry.message).toContain('NodeFault');
            expect(entry.message).toContain('OverBudget');
            expect(entry.fields).toEqual({ node: 3, fault: 'OverBudget' });
            expect(entry.corr).toBe(42);
        });

        it('engineEventToEntry maps an Xrun payload into fields (pure)', () => {
            const event: EngineEvent = {
                v: 1,
                seq: 1,
                severity: 'Error',
                kind: { Xrun: { dropped: 9 } },
                source: 'Engine',
                ts_us: 0,
                corr_id: 0,
            };

            const entry = engineEventToEntry(event);
            expect(entry.level).toBe('Error');
            expect(entry.message).toBe('Xrun: 9 dropped');
            expect(entry.fields).toEqual({ dropped: 9 });
        });
    });

    describe('filterEntries (pure selector)', () => {
        let sample: LogEntry[];

        beforeEach(() => {
            append({ level: 'Info', scope: 'audio', message: 'context resumed' });
            append({ level: 'Warn', scope: 'audio', message: 'high latency detected' });
            append({ level: 'Error', scope: 'midi', message: 'device disconnected', corr: 100 });
            append({ level: 'Debug', scope: 'collab', message: 'peer joined', corr: 100 });
            sample = [...useLogStore.getState().entries];
        });

        it('returns everything for the default (all) view', () => {
            expect(filterEntries(sample, makeView())).toHaveLength(4);
        });

        it('filters by a level set', () => {
            const result = filterEntries(sample, makeView({ levels: new Set(['Warn', 'Error']) }));
            expect(result.map((e) => e.level)).toEqual(['Warn', 'Error']);
        });

        it('filters by scope', () => {
            const result = filterEntries(sample, makeView({ scope: 'audio' }));
            expect(result).toHaveLength(2);
            expect(result.every((e) => e.scope === 'audio')).toBe(true);
        });

        it('filters by case-insensitive substring over message + scope', () => {
            expect(filterEntries(sample, makeView({ search: 'LATENCY' })).map((e) => e.message)).toEqual([
                'high latency detected',
            ]);
            // matches on scope too
            expect(filterEntries(sample, makeView({ search: 'midi' }))).toHaveLength(1);
        });

        it('filters by correlation id (click-to-correlate)', () => {
            const result = filterEntries(sample, makeView({ corr: 100 }));
            expect(result).toHaveLength(2);
            expect(result.map((e) => e.scope)).toEqual(['midi', 'collab']);
        });

        it('combines level + scope + search conjunctively', () => {
            const result = filterEntries(
                sample,
                makeView({ levels: new Set(['Info', 'Warn']), scope: 'audio', search: 'resumed' }),
            );
            expect(result.map((e) => e.message)).toEqual(['context resumed']);
        });
    });

    describe('facet counts (pure selectors)', () => {
        beforeEach(() => {
            append({ level: 'Info', scope: 'audio' });
            append({ level: 'Info', scope: 'audio' });
            append({ level: 'Warn', scope: 'midi' });
            append({ level: 'Error', scope: 'midi' });
        });

        it('levelCounts tallies every severity (zero-filled)', () => {
            const counts = levelCounts(useLogStore.getState().entries);
            expect(counts).toEqual({ Trace: 0, Debug: 0, Info: 2, Warn: 1, Error: 1 });
        });

        it('scopeCounts tallies per scope in insertion order', () => {
            const counts = scopeCounts(useLogStore.getState().entries);
            expect(Array.from(counts.entries())).toEqual([
                ['audio', 2],
                ['midi', 2],
            ]);
        });
    });
});
