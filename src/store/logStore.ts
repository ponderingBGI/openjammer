/**
 * Log store (L4, Layer 2) — the bounded ring buffer behind the in-app DevLog
 * panel and the {@link import('../utils/log') console facade}.
 *
 * The store ingests from TWO sources, normalized into one {@link LogEntry}
 * shape:
 *   • the TS console facade (`src/utils/log.ts`) — UI-side, source `"Ui"`, and
 *   • the engine `Event` stream (`ingestEngineEvent`) — the L2-decoded ojproto
 *     `Event`/`EventKind`, source `"Engine"`/`"Wasm"`/`"Native"`.
 *
 * It deliberately reuses the ojproto `Severity`/`Source`/`EventKind` taxonomy
 * (imported from `@openjammer/oj-protocol`) rather than inventing a second one —
 * the L4 "no fourth schema" reuse principle.
 *
 * BOUNDED by construction: a fixed-capacity ring ({@link LOG_CAPACITY}). When it
 * is full the OLDEST entry is evicted and {@link LogState.droppedCount} is
 * incremented, so the panel can show a visible "N dropped" badge from day one
 * (without it the panel would silently lie under load).
 *
 * The selection logic ({@link filterEntries}, {@link levelCounts},
 * {@link scopeCounts}) is PURE and exported so it is unit-testable without the
 * store or React.
 */

import { create } from 'zustand';
import type { Event as EngineEvent, EventKind, Severity, Source } from '@openjammer/oj-protocol';

// ============================================================================
// Constants
// ============================================================================

/**
 * Ring-buffer capacity. Bounded memory regardless of event volume; the oldest
 * entry is evicted (and counted) once this is exceeded. 5000 entries is ample
 * for a developer-time tail while staying cheap to filter/window.
 */
export const LOG_CAPACITY = 5000;

// ============================================================================
// Types
// ============================================================================

/** Structured key/values attached to a log entry, shown expanded in the panel. */
export type LogFields = Record<string, unknown>;

/**
 * One normalized DevLog entry. The union of what the UI facade and the engine
 * `Event` stream both reduce to.
 */
export interface LogEntry {
    /** Monotonic per-session id (also the stable React key). */
    id: number;
    /** Wall-clock capture time, ms since epoch. */
    ts: number;
    /** ojproto severity. */
    level: Severity;
    /** Which side emitted it. */
    source: Source;
    /** Short subsystem tag for faceting, e.g. "audio", "engine", "midi". */
    scope: string;
    /** Human-readable message. */
    message: string;
    /** Optional structured fields. */
    fields?: LogFields;
    /** Optional correlation id (click-to-correlate). */
    corr?: number;
}

/** The shape `append` accepts — id/ts are stamped by the store. */
export type LogEntryInput = Omit<LogEntry, 'id' | 'ts'> & { ts?: number };

/** A set of severities to keep; `null`/absent means "all levels". */
export type LevelFilter = ReadonlySet<Severity> | null;

/** Pure, serializable view options consumed by {@link filterEntries}. */
export interface LogView {
    /** Keep only these levels (null = all). */
    levels: LevelFilter;
    /** Keep only this scope (null = all). */
    scope: string | null;
    /** Case-insensitive substring over message + scope (empty = no filter). */
    search: string;
    /** Keep only entries with this corr id (null = all). Click-to-correlate. */
    corr: number | null;
}

interface LogState {
    /** Oldest→newest ring of entries (length ≤ {@link LOG_CAPACITY}). */
    entries: LogEntry[];
    /** Count of entries evicted because the ring was full. */
    droppedCount: number;

    /** Append a normalized entry, stamping id + ts and evicting the oldest on overflow. */
    append: (entry: LogEntryInput) => void;
    /** Map an L2-decoded ojproto `Event` to a `LogEntry` and append it. */
    ingestEngineEvent: (event: EngineEvent) => void;
    /** Empty the ring and reset the dropped counter. */
    clear: () => void;
}

// ============================================================================
// Internals
// ============================================================================

/** Monotonic id source for entries. Module-level so it survives store resets. */
let entryCounter = 0;
function nextEntryId(): number {
    entryCounter += 1;
    return entryCounter;
}

// ============================================================================
// Engine `Event` → `LogEntry` mapping (pure)
// ============================================================================

/** Map a `Source` to the conventional short scope tag used for faceting. */
function sourceScope(source: Source): string {
    switch (source) {
        case 'Engine':
            return 'engine';
        case 'Wasm':
            return 'wasm';
        case 'Native':
            return 'native';
        case 'Ui':
            return 'ui';
    }
}

/**
 * Render an `EventKind` into a `(message, fields)` pair. Externally-tagged
 * variants (single-key objects) carry their payload into `fields`; the bare
 * unit-string variants become a plain message.
 */
export function describeEventKind(kind: EventKind): { message: string; fields?: LogFields } {
    if (typeof kind === 'string') {
        return { message: kind };
    }
    if ('Xrun' in kind) {
        return { message: `Xrun: ${kind.Xrun.dropped} dropped`, fields: { dropped: kind.Xrun.dropped } };
    }
    if ('NodeFault' in kind) {
        const { node, fault } = kind.NodeFault;
        return { message: `NodeFault: ${fault} (node ${node})`, fields: { node, fault } };
    }
    if ('LooperEdge' in kind) {
        const { node, from, to } = kind.LooperEdge;
        return {
            message: `LooperEdge: ${from} -> ${to} (node ${node})`,
            fields: { node, from, to },
        };
    }
    // Message — the only String-carrying variant.
    const { code, text } = kind.Message;
    return { message: text, fields: { code } };
}

/**
 * Convert an L2-decoded ojproto `Event` into a `LogEntry` (sans id/ts, which
 * the store stamps). Pure and exported for direct testing.
 */
export function engineEventToEntry(event: EngineEvent): LogEntryInput {
    const { message, fields } = describeEventKind(event.kind);
    return {
        level: event.severity,
        source: event.source,
        scope: sourceScope(event.source),
        message,
        // ts_us is engine microseconds; convert to ms for the wall-clock column.
        ts: Math.round(event.ts_us / 1000),
        ...(fields !== undefined ? { fields } : {}),
        ...(event.corr_id !== 0 ? { corr: event.corr_id } : {}),
    };
}

// ============================================================================
// Store
// ============================================================================

export const useLogStore = create<LogState>((set) => ({
    entries: [],
    droppedCount: 0,

    append: (entry) =>
        set((state) => {
            const full: LogEntry = {
                id: nextEntryId(),
                ts: entry.ts ?? Date.now(),
                level: entry.level,
                source: entry.source,
                scope: entry.scope,
                message: entry.message,
                ...(entry.fields !== undefined ? { fields: entry.fields } : {}),
                ...(entry.corr !== undefined ? { corr: entry.corr } : {}),
            };

            // Under capacity: just append.
            if (state.entries.length < LOG_CAPACITY) {
                return { entries: [...state.entries, full] };
            }
            // At capacity: drop the oldest, count it, append the new one.
            return {
                entries: [...state.entries.slice(1), full],
                droppedCount: state.droppedCount + 1,
            };
        }),

    ingestEngineEvent: (event) =>
        // Reuse `append` via the store so capacity/drop accounting stays in one place.
        useLogStore.getState().append(engineEventToEntry(event)),

    clear: () => set({ entries: [], droppedCount: 0 }),
}));

// ============================================================================
// Pure selectors (testable without React)
// ============================================================================

/** Case-insensitive substring match over message + scope. */
function matchesSearch(entry: LogEntry, needle: string): boolean {
    if (needle === '') return true;
    const q = needle.toLowerCase();
    return entry.message.toLowerCase().includes(q) || entry.scope.toLowerCase().includes(q);
}

/**
 * Filter `entries` by a {@link LogView}: level set, scope, corr id, and a
 * case-insensitive substring. Pure — returns a new array, input untouched.
 */
export function filterEntries(entries: readonly LogEntry[], view: LogView): LogEntry[] {
    const search = view.search.trim();
    return entries.filter((entry) => {
        if (view.levels !== null && !view.levels.has(entry.level)) return false;
        if (view.scope !== null && entry.scope !== view.scope) return false;
        if (view.corr !== null && entry.corr !== view.corr) return false;
        if (!matchesSearch(entry, search)) return false;
        return true;
    });
}

/** Live count of entries per severity (for the level facet chips). */
export function levelCounts(entries: readonly LogEntry[]): Record<Severity, number> {
    const counts: Record<Severity, number> = { Trace: 0, Debug: 0, Info: 0, Warn: 0, Error: 0 };
    for (const entry of entries) counts[entry.level] += 1;
    return counts;
}

/**
 * Live count of entries per scope (for the scope facet chips), as an
 * insertion-ordered map so the chip order is stable as scopes first appear.
 */
export function scopeCounts(entries: readonly LogEntry[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.scope, (counts.get(entry.scope) ?? 0) + 1);
    return counts;
}

// ============================================================================
// Test helpers
// ============================================================================

/** Test-only: hard reset, including the module-level id counter. */
export function _resetLogStoreForTests(): void {
    entryCounter = 0;
    useLogStore.setState({ entries: [], droppedCount: 0 });
}
