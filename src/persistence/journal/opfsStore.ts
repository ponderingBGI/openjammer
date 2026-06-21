/**
 * OPFS-backed {@link JournalStore} (Track B P1 — the browser durability adapter).
 *
 * OPFS `FileSystemSyncAccessHandle` is the ONLY web primitive with real append +
 * flush, so the durable journal lives there (two handles: a snapshot file + an
 * append log). The handle API is small and synchronous — but it is only available
 * inside a Worker. This module is the storage glue over that API; the journal
 * LOGIC (framing, recovery, compaction) is shared and already tested. The handle
 * surface is expressed as an interface so the adapter is unit-tested against an
 * in-memory fake — the production binding (`navigator.storage.getDirectory()` →
 * `getFileHandle` → `createSyncAccessHandle`) is the only un-unit-testable line.
 */

import type { JournalStore } from './journal';

/** The slice of the OPFS `FileSystemSyncAccessHandle` API the store uses. */
export interface SyncAccessHandle {
    read(buffer: Uint8Array, options?: { at?: number }): number;
    write(buffer: Uint8Array, options?: { at?: number }): number;
    truncate(newSize: number): void;
    getSize(): number;
    flush(): void;
    close(): void;
}

function readAll(handle: SyncAccessHandle): Uint8Array {
    const size = handle.getSize();
    const buf = new Uint8Array(size);
    if (size > 0) handle.read(buf, { at: 0 });
    return buf;
}

/**
 * A {@link JournalStore} over two OPFS sync-access handles. Appends go to the end
 * of the log handle and are flushed; a checkpoint rewrites the snapshot handle
 * (flushed) THEN truncates the log (the durable fsync ordering: snapshot durable
 * before the log is cleared, so a crash in the window keeps the old snapshot+log).
 */
export class OpfsJournalStore implements JournalStore {
    private readonly snapshotHandle: SyncAccessHandle;
    private readonly logHandle: SyncAccessHandle;

    constructor(snapshotHandle: SyncAccessHandle, logHandle: SyncAccessHandle) {
        this.snapshotHandle = snapshotHandle;
        this.logHandle = logHandle;
    }

    readSnapshot(): Uint8Array | null {
        const bytes = readAll(this.snapshotHandle);
        return bytes.length > 0 ? bytes : null;
    }

    readLog(): Uint8Array {
        return readAll(this.logHandle);
    }

    appendBytes(framed: Uint8Array): void {
        this.logHandle.write(framed, { at: this.logHandle.getSize() });
        this.logHandle.flush();
    }

    checkpoint(snapshot: Uint8Array): void {
        // Snapshot durable FIRST...
        this.snapshotHandle.truncate(0);
        this.snapshotHandle.write(snapshot, { at: 0 });
        this.snapshotHandle.flush();
        // ...THEN clear the log (never the reverse — that could lose committed edits
        // if a crash landed between).
        this.logHandle.truncate(0);
        this.logHandle.flush();
    }

    /** Release the OPFS handles (call on teardown). */
    close(): void {
        this.snapshotHandle.close();
        this.logHandle.close();
    }
}

/**
 * Open the journal's two OPFS handles for `projectId`, inside a Worker. PRODUCTION
 * GLUE (not unit-tested — needs a real OPFS Worker runtime): the store logic above
 * is what carries the durability contract and is covered against a fake handle.
 */
export async function openOpfsJournalStore(projectId: string): Promise<OpfsJournalStore> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(`journal-${projectId}`, { create: true });
    const snapFile = await dir.getFileHandle('snapshot.bin', { create: true });
    const logFile = await dir.getFileHandle('log.bin', { create: true });
    // `createSyncAccessHandle` exists only on OPFS file handles in a Worker.
    const snap = await (snapFile as unknown as {
        createSyncAccessHandle(): Promise<SyncAccessHandle>;
    }).createSyncAccessHandle();
    const log = await (logFile as unknown as {
        createSyncAccessHandle(): Promise<SyncAccessHandle>;
    }).createSyncAccessHandle();
    return new OpfsJournalStore(snap, log);
}
