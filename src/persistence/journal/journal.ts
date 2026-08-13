/**
 * The durable journal (Track B P1) — a snapshot baseline + an append-only,
 * CRC-framed update log, with crash-safe recovery and compaction.
 *
 * This is the substrate-agnostic LOGIC of the Loro-on-disk store. The byte
 * payloads are opaque (a Loro snapshot / incremental update); the storage is
 * behind {@link JournalStore} so the logic is unit-testable with an in-memory
 * store and the real backends (OPFS `FileSystemSyncAccessHandle` in a Worker on
 * browser; an fsync'd Rust writer on native) are thin adapters that implement the
 * same four operations. Recovery returns the snapshot + the valid log tail for the
 * caller to replay into Loro; a torn/corrupt record (a crash mid-append) is
 * dropped, never imported.
 */

import { frameRecord, parseLog } from './frame';

/** Low-level durable byte storage. The real adapters fsync; the in-memory one
 *  does not (it models a renderer/tab crash, where buffered bytes are present). */
export interface JournalStore {
    /** The current snapshot baseline, or `null` if none has been written. */
    readSnapshot(): Uint8Array | null;
    /** The raw append-only log bytes (possibly with a torn tail). */
    readLog(): Uint8Array;
    /** Append already-framed bytes to the log (durably, in the real adapters). */
    appendBytes(framed: Uint8Array): void;
    /** Atomically replace the snapshot AND clear the log (compaction checkpoint). */
    checkpoint(snapshot: Uint8Array): void;
}

/** What recovery hands back: replay `snapshot` (if any) then each `update`. */
export interface Recovered {
    snapshot: Uint8Array | null;
    updates: Uint8Array[];
    /** True if a torn/corrupt log tail was detected and dropped on recovery. */
    truncated: boolean;
}

/**
 * A journal over a {@link JournalStore}. Edits are appended as framed updates;
 * recovery loads the snapshot + the valid log tail; compaction folds the current
 * state into a fresh snapshot and truncates the log.
 */
export class Journal {
    private readonly store: JournalStore;
    constructor(store: JournalStore) {
        this.store = store;
    }

    /** Append one incremental update (frames + checksums it). */
    appendUpdate(update: Uint8Array): void {
        this.store.appendBytes(frameRecord(update));
    }

    /** Recover the replay sequence after a (re)start. */
    recover(): Recovered {
        const snapshot = this.store.readSnapshot();
        const { records, truncated } = parseLog(this.store.readLog());
        return { snapshot, updates: records, truncated };
    }

    /**
     * Compaction: write a fresh full snapshot and truncate the log. The store's
     * `checkpoint` must make the new snapshot durable BEFORE clearing the log
     * (the fsync-order rule), so a crash in the window keeps the old snapshot +
     * log rather than losing committed edits — the real adapters enforce that
     * ordering; this method just expresses the intent.
     */
    compact(snapshot: Uint8Array): void {
        this.store.checkpoint(snapshot);
    }
}

/**
 * In-memory {@link JournalStore} for tests and as a non-durable fallback. Models a
 * renderer/tab crash: appended bytes are retained (as a real buffer would be), and
 * a "torn" tail can be simulated by appending raw partial bytes.
 */
export class MemoryJournalStore implements JournalStore {
    private snapshot: Uint8Array | null = null;
    private log: Uint8Array = new Uint8Array(0);

    constructor(initial?: { snapshot?: Uint8Array | null; log?: Uint8Array }) {
        // Defensive-copy at the boundary: a real durable store owns its bytes, so
        // the in-memory model must too — a caller mutating its passed-in buffer
        // later must never reach back in and corrupt our snapshot/log.
        this.snapshot = initial?.snapshot ? new Uint8Array(initial.snapshot) : null;
        if (initial?.log) this.log = new Uint8Array(initial.log);
    }

    readSnapshot(): Uint8Array | null {
        // Hand back a copy: the snapshot bytes are ours; a reader mutating the
        // result must not bit-rot the stored baseline.
        return this.snapshot ? new Uint8Array(this.snapshot) : null;
    }
    readLog(): Uint8Array {
        // Copy out so a caller cannot mutate the live log in place.
        return new Uint8Array(this.log);
    }
    appendBytes(framed: Uint8Array): void {
        const next = new Uint8Array(this.log.length + framed.length);
        next.set(this.log, 0);
        next.set(framed, this.log.length);
        this.log = next;
    }
    checkpoint(snapshot: Uint8Array): void {
        // Snapshot first, THEN clear the log (mirrors the durable fsync ordering).
        // Copy in so a later mutation of the caller's buffer can't alter ours.
        this.snapshot = new Uint8Array(snapshot);
        this.log = new Uint8Array(0);
    }

    /** TEST HELPER: corrupt the log's last `n` bytes to a torn tail. */
    _truncateTail(n: number): void {
        this.log = this.log.subarray(0, Math.max(0, this.log.length - n));
    }
    /** TEST HELPER: flip a byte in the raw log (simulate bit-rot / a torn write). */
    _flipByte(index: number): void {
        if (index >= 0 && index < this.log.length) {
            const copy = new Uint8Array(this.log);
            copy[index] ^= 0xff;
            this.log = copy;
        }
    }
}
