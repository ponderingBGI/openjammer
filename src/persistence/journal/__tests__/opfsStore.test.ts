/**
 * OPFS JournalStore adapter tests (Track B P1) — verified against an in-memory
 * fake of the SyncAccessHandle API, so the store logic is covered without a real
 * OPFS Worker runtime (the production opener is the only un-tested glue line).
 */

import { describe, it, expect } from 'vitest';
import { OpfsJournalStore, type SyncAccessHandle } from '../opfsStore';
import { Journal } from '../journal';

/** In-memory fake of the OPFS sync-access handle. */
class FakeHandle implements SyncAccessHandle {
    private buf: Uint8Array;
    flushes = 0;
    closed = false;
    constructor(initial: Uint8Array = new Uint8Array(0)) {
        this.buf = initial;
    }
    getSize(): number {
        return this.buf.length;
    }
    read(out: Uint8Array, options?: { at?: number }): number {
        const at = options?.at ?? 0;
        const n = Math.min(out.length, Math.max(0, this.buf.length - at));
        out.set(this.buf.subarray(at, at + n), 0);
        return n;
    }
    write(data: Uint8Array, options?: { at?: number }): number {
        const at = options?.at ?? 0;
        if (at + data.length > this.buf.length) {
            const grown = new Uint8Array(at + data.length);
            grown.set(this.buf, 0);
            this.buf = grown;
        }
        this.buf.set(data, at);
        return data.length;
    }
    truncate(newSize: number): void {
        this.buf = this.buf.subarray(0, newSize).slice();
    }
    flush(): void {
        this.flushes += 1;
    }
    close(): void {
        this.closed = true;
    }
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('OpfsJournalStore', () => {
    it('appends framed records to the log handle and flushes each time', () => {
        const snap = new FakeHandle();
        const log = new FakeHandle();
        const journal = new Journal(new OpfsJournalStore(snap, log));

        journal.appendUpdate(enc('one'));
        journal.appendUpdate(enc('two'));

        expect(log.flushes).toBe(2); // durably flushed per append
        const got = journal.recover();
        expect(got.snapshot).toBeNull();
        expect(got.updates.map(dec)).toEqual(['one', 'two']);
    });

    it('checkpoint writes+flushes the snapshot then truncates the log', () => {
        const snap = new FakeHandle();
        const log = new FakeHandle();
        const journal = new Journal(new OpfsJournalStore(snap, log));

        journal.appendUpdate(enc('delta'));
        journal.compact(enc('SNAPSHOT'));

        expect(snap.getSize()).toBeGreaterThan(0);
        expect(log.getSize()).toBe(0); // log cleared after the snapshot is durable
        const got = journal.recover();
        expect(got.snapshot && dec(got.snapshot)).toBe('SNAPSHOT');
        expect(got.updates).toEqual([]);
    });

    it('survives a re-open: a new store over the SAME handles recovers the data', () => {
        const snap = new FakeHandle();
        const log = new FakeHandle();
        new Journal(new OpfsJournalStore(snap, log)).appendUpdate(enc('persisted'));

        // Simulate relaunch: a fresh store over the same (durable) handles.
        const recovered = new Journal(new OpfsJournalStore(snap, log)).recover();
        expect(recovered.updates.map(dec)).toEqual(['persisted']);
    });

    it('drops a torn log tail on recovery (crash mid-append)', () => {
        const snap = new FakeHandle();
        const log = new FakeHandle();
        const store = new OpfsJournalStore(snap, log);
        const journal = new Journal(store);
        journal.appendUpdate(enc('committed'));
        // Simulate a partial next-record write directly at the end of the log.
        store.appendBytes(new Uint8Array([0xde, 0xad])); // unframed partial tail

        const got = journal.recover();
        expect(got.truncated).toBe(true);
        expect(got.updates.map(dec)).toEqual(['committed']);
    });
});
