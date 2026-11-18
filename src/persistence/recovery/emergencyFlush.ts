/**
 * The seam that makes "flush, THEN say goodbye" an order instead of a coincidence.
 *
 * Two owners used to register their own `pagehide` handler: App's debounced
 * emergency backup (`flush()`) and the recovery hook's `markCleanExit`. Which
 * one ran first was decided by hook-call order — i.e. by nothing — and getting
 * it backwards is a whole song: the marker says "closed cleanly" while the
 * backup on disk is up to two seconds stale (UX-INV Q3, risk 1).
 *
 * So App REGISTERS its flush here and the recovery hook's ONE `pagehide`
 * handler calls it immediately before it writes the clean-exit marker. The
 * ordering is now a call sequence in a single function, which is the only kind
 * of ordering that cannot drift.
 */

let flushFn: (() => void) | null = null;

/** App registers its debounced-backup flush. Returns the deregister. */
export function registerEmergencyFlush(fn: () => void): () => void {
    flushFn = fn;
    return () => {
        if (flushFn === fn) flushFn = null;
    };
}

/**
 * Force the pending emergency backup to disk NOW. Called immediately before the
 * clean-exit marker is written, and safe to call when nothing is registered.
 */
export function flushEmergencyBackup(): void {
    flushFn?.();
}
