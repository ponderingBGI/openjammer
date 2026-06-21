/**
 * Durable journal substrate tests (Track B P1) — framing, crash-safe recovery
 * (longest valid prefix), and compaction. Pure logic; no OPFS/Loro needed.
 */

import { describe, it, expect } from 'vitest';
import { crc32, frameRecord, parseLog, Journal, MemoryJournalStore } from '../index';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
    it('matches the standard check value for "123456789"', () => {
        expect(crc32(enc('123456789')) >>> 0).toBe(0xcbf43926);
    });
    it('is empty-safe and order-sensitive', () => {
        expect(crc32(new Uint8Array(0))).toBe(0);
        expect(crc32(enc('ab'))).not.toBe(crc32(enc('ba')));
    });
});

describe('frame round-trip', () => {
    it('frames and parses a single record', () => {
        const log = frameRecord(enc('hello'));
        const { records, truncated } = parseLog(log);
        expect(records).toHaveLength(1);
        expect(new TextDecoder().decode(records[0])).toBe('hello');
        expect(truncated).toBe(false);
    });

    it('parses multiple records in order', () => {
        const store = new MemoryJournalStore();
        const j = new Journal(store);
        j.appendUpdate(enc('one'));
        j.appendUpdate(enc('two'));
        j.appendUpdate(enc('three'));
        const got = parseLog(store.readLog()).records.map((r) => new TextDecoder().decode(r));
        expect(got).toEqual(['one', 'two', 'three']);
    });

    it('handles empty-payload records', () => {
        const { records } = parseLog(frameRecord(new Uint8Array(0)));
        expect(records).toHaveLength(1);
        expect(records[0]).toHaveLength(0);
    });
});

describe('crash-safe recovery (longest valid prefix)', () => {
    it('drops a torn tail (a crash mid-append) and keeps the prior records', () => {
        const store = new MemoryJournalStore();
        const j = new Journal(store);
        j.appendUpdate(enc('committed-1'));
        j.appendUpdate(enc('committed-2'));
        j.appendUpdate(enc('half-written')); // the record the "crash" interrupted
        // Simulate the crash: lop bytes off the end of the last record.
        store._truncateTail(5);

        const { updates, truncated } = j.recover();
        expect(updates.map((u) => new TextDecoder().decode(u))).toEqual(['committed-1', 'committed-2']);
        expect(truncated).toBe(true);
    });

    it('truncates at the FIRST corrupt record (a flipped byte), dropping it and all after', () => {
        const store = new MemoryJournalStore();
        const j = new Journal(store);
        j.appendUpdate(enc('good-1'));
        j.appendUpdate(enc('good-2'));
        j.appendUpdate(enc('good-3'));
        // Flip a byte inside the SECOND record's payload (record 1 = 12B header +
        // 6B "good-1" = 18B; record 2 payload starts at 18 + 12 = 30).
        store._flipByte(31);

        const { updates } = j.recover();
        // Only the first record survives; the corrupt one and everything after are
        // dropped (we never replay past a break).
        expect(updates.map((u) => new TextDecoder().decode(u))).toEqual(['good-1']);
    });

    it('returns the snapshot plus the valid log tail', () => {
        const store = new MemoryJournalStore({ snapshot: enc('SNAP') });
        const j = new Journal(store);
        j.appendUpdate(enc('delta-1'));
        const rec = j.recover();
        expect(rec.snapshot && new TextDecoder().decode(rec.snapshot)).toBe('SNAP');
        expect(rec.updates.map((u) => new TextDecoder().decode(u))).toEqual(['delta-1']);
    });

    it('an empty journal recovers to nothing (a clean cold start, not a crash)', () => {
        const rec = new Journal(new MemoryJournalStore()).recover();
        expect(rec.snapshot).toBeNull();
        expect(rec.updates).toEqual([]);
        expect(rec.truncated).toBe(false);
    });
});

describe('compaction', () => {
    it('folds state into a fresh snapshot and truncates the log', () => {
        const store = new MemoryJournalStore();
        const j = new Journal(store);
        j.appendUpdate(enc('a'));
        j.appendUpdate(enc('b'));
        expect(store.readLog().length).toBeGreaterThan(0);

        j.compact(enc('SNAPSHOT@2'));

        expect(store.readLog().length).toBe(0); // log truncated
        const rec = j.recover();
        expect(rec.snapshot && new TextDecoder().decode(rec.snapshot)).toBe('SNAPSHOT@2');
        expect(rec.updates).toEqual([]); // all prior deltas folded into the snapshot
    });

    it('keeps working after compaction (new deltas append to the cleared log)', () => {
        const store = new MemoryJournalStore();
        const j = new Journal(store);
        j.appendUpdate(enc('old'));
        j.compact(enc('S'));
        j.appendUpdate(enc('new'));
        const rec = j.recover();
        expect(rec.snapshot && new TextDecoder().decode(rec.snapshot)).toBe('S');
        expect(rec.updates.map((u) => new TextDecoder().decode(u))).toEqual(['new']);
    });
});
