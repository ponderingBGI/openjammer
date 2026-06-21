/**
 * Loro ↔ durable journal integration (Track B P1).
 *
 * Wires the live {@link CrdtGraphProjection} to the {@link Journal}: every local
 * CRDT update is appended to the durable, CRC-framed log, periodic compaction
 * folds the whole document into a fresh snapshot, and recovery rebuilds a
 * projection from the snapshot + the valid update tail. This is the crash-durable
 * persistence the project lacked (today the Loro doc is session-only) — the doc's
 * own bytes become the source of truth, so a crash loses at most the last
 * unflushed update, and a torn tail is dropped (the journal's longest-valid-prefix
 * recovery), never imported as a corrupt blob (the import firewall catches that too).
 *
 * The storage backend is injected as a {@link JournalStore}; this module is the
 * substrate-agnostic glue. The OPFS-Worker (browser) and fsync'd-Rust (native)
 * stores are the thin remaining adapters; the logic + Loro round-trip are here and
 * verified.
 */

import { CrdtGraphProjection } from '../../collab/CrdtGraphProjection';
import { Journal } from './journal';

export class LoroPersistence {
    private readonly journal: Journal;
    private unsub: (() => void) | null = null;

    constructor(journal: Journal) {
        this.journal = journal;
    }

    /**
     * Start journaling `proj`: append every LOCAL update to the durable log. (Remote
     * updates arrive already journaled at their origin peer; we persist our own.)
     */
    attach(proj: CrdtGraphProjection): void {
        this.detach();
        this.unsub = proj.subscribeLocalUpdates((bytes) => this.journal.appendUpdate(bytes));
    }

    /** Stop journaling. */
    detach(): void {
        this.unsub?.();
        this.unsub = null;
    }

    /**
     * Compaction: fold the full current document into a fresh snapshot and truncate
     * the log, keeping recovery fast and the log bounded. Call on idle / when the
     * log outgrows the snapshot.
     */
    compact(proj: CrdtGraphProjection): void {
        this.journal.compact(proj.exportSnapshot());
    }

    /**
     * Rebuild `proj` from the journal: import the snapshot baseline (if any) then
     * replay the valid update tail. A torn/corrupt log record was already dropped by
     * the journal's recovery; each import is additionally firewalled, so recovery
     * can never throw — a hopeless blob yields an empty doc, never a crash loop.
     * Returns whether the log tail had to be truncated.
     */
    static recoverInto(journal: Journal, proj: CrdtGraphProjection): { truncated: boolean } {
        const { snapshot, updates, truncated } = journal.recover();
        if (snapshot) proj.import(snapshot);
        for (const update of updates) proj.import(update);
        return { truncated };
    }
}
