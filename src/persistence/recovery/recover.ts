/**
 * Boot-time recovery orchestrator (Track B P0).
 *
 * Ties the breaker ({@link ./breaker}) to its storage ({@link ./markerStore})
 * and an app-supplied payload source. It is the durable state machine that runs
 * once at boot to answer: did we crash, and is restoring safe?
 *
 * Lifecycle:
 *   • {@link runRecovery} (at boot, before hydrate) — open the session marker,
 *     detect a dirty boot, record a crash against the previously-loaded snapshot,
 *     then decide: clean / restore / quarantine-and-fallback / safe-mode, walking
 *     candidates newest-first and quarantining any that already crashed or fail
 *     validation (fail-closed).
 *   • {@link settle} (once the engine is confirmed live + a settle window) —
 *     clear the open marker and the crash streak: we reached a known-good state.
 *
 * The source + validate are injected so the whole flow is unit-testable with a
 * fake (see the crash-loop-guard property test), and so the same machine can
 * later read Loro snapshots instead of JSON (Track B P1) without changing here.
 */

import {
    decideRecovery,
    freshMarker,
    parseMarker,
    pruneCrashes,
    serializeMarker,
    snapshotCrashCount,
    streakCount,
} from './breaker';
import { newInstanceId, type MarkerStore } from './markerStore';
import {
    DEFAULT_BREAKER_CONFIG,
    type BreakerConfig,
    type Marker,
    type RecoveryMode,
} from './types';

/** One restorable candidate, newest-first in {@link PayloadSource.list}. */
export interface RecoverablePayload<T> {
    /** A STABLE identity for this snapshot (so a crash can be pinned to it). */
    id: string;
    /** Decode the raw payload. May throw (torn/corrupt) — the walk catches it. */
    load(): T;
}

/** The app's restorable-payload provider (localStorage today; OPFS/folder in P1). */
export interface PayloadSource<T> {
    /** Restorable candidates, NEWEST FIRST. Excludes already-quarantined ones. */
    list(): RecoverablePayload<T>[];
    /** Move a snapshot out of the restore set, preserving it (never delete). */
    quarantine(id: string, info: { bootSeq: number; reason: string }): void;
}

export interface RunRecoveryOpts<T, V> {
    store: MarkerStore;
    source: PayloadSource<T>;
    /** Validate a decoded payload into a live graph, or `null` if unusable. */
    validate: (raw: T) => V | null;
    /** Injectable clock (display only; never gates the breaker). */
    now?: () => number;
    cfg?: BreakerConfig;
    instanceId?: string;
}

export interface RecoveryOutcome<V> {
    mode: RecoveryMode;
    bootSeq: number;
    /** The validated graph to load + its snapshot id, when restoring. */
    restored: { graph: V; snapshotId: string } | null;
    /** Snapshot ids quarantined during this boot. */
    quarantined: string[];
    /** Crashes within the streak window at this boot. */
    streak: number;
    /** The instance id for this session (stamped on the marker). */
    instanceId: string;
}

/**
 * Open the session marker at boot. Increments the monotonic boot sequence, and
 * if the previous session did not close cleanly (its marker was still `open`),
 * records a crash against the snapshot it had loaded. Returns the freshly-written
 * marker plus the dirty/readable signals the decision needs.
 */
function openSession(
    store: MarkerStore,
    now: () => number,
    cfg: BreakerConfig,
    instanceIdArg?: string,
): { marker: Marker; markerReadable: boolean; dirty: boolean } {
    const prev = parseMarker(store.read());
    const markerReadable = prev !== null;
    const instanceId = instanceIdArg ?? prev?.instanceId ?? newInstanceId();
    const bootSeq = (prev?.bootSeq ?? -1) + 1;
    const dirty = prev?.open === true;

    let crashes = prev?.crashes ? [...prev.crashes] : [];
    if (dirty && prev) {
        // The previous session crashed (never settled). Pin it to whatever it
        // had loaded so that snapshot is quarantined before we try it again.
        crashes.push({
            bootSeq: prev.bootSeq,
            at: now(),
            snapshotId: prev.loadedSnapshotId,
            stage: 'session-did-not-close-cleanly',
        });
    }
    crashes = pruneCrashes(crashes, bootSeq, cfg);

    const marker: Marker = {
        v: 1,
        open: true,
        bootSeq,
        instanceId,
        loadedSnapshotId: null,
        crashes,
    };
    store.write(serializeMarker(marker));
    return { marker, markerReadable, dirty };
}

/** Persist a mutation to the live marker (stamp loaded snapshot, etc.). */
function writeMarker(store: MarkerStore, marker: Marker): void {
    store.write(serializeMarker(marker));
}

/**
 * Run the full boot recovery. Pure of React; the caller applies the outcome
 * (load the graph, show the pill, or render Safe Mode).
 */
export function runRecovery<T, V>(opts: RunRecoveryOpts<T, V>): RecoveryOutcome<V> {
    const cfg = opts.cfg ?? DEFAULT_BREAKER_CONFIG;
    const now = opts.now ?? Date.now;
    const { store, source, validate } = opts;

    const { marker, markerReadable, dirty } = openSession(store, now, cfg, opts.instanceId);
    const streak = streakCount(marker.crashes, marker.bootSeq, cfg);
    const candidates = source.list();
    const payloadPresent = candidates.length > 0;

    const mode = decideRecovery(
        {
            markerReadable,
            dirty,
            payloadPresent,
            // Crash count of the newest candidate — the one we'd try first.
            snapshotCrashCount: payloadPresent
                ? snapshotCrashCount(marker.crashes, candidates[0].id)
                : 0,
            streakCount: streak,
        },
        cfg,
    );

    const base: RecoveryOutcome<V> = {
        mode,
        bootSeq: marker.bootSeq,
        restored: null,
        quarantined: [],
        streak,
        instanceId: marker.instanceId,
    };

    if (mode === 'clean' || mode === 'safe-mode') {
        // Safe Mode preserves suspects on disk; it does NOT load anything live.
        return base;
    }

    // restore / quarantine-and-fallback: walk newest-first, skipping anything
    // that already crashed or fails to decode+validate (fail-closed).
    const quarantined: string[] = [];
    for (const p of candidates) {
        if (snapshotCrashCount(marker.crashes, p.id) >= 1) {
            source.quarantine(p.id, { bootSeq: marker.bootSeq, reason: 'snapshot-crashed-on-load' });
            quarantined.push(p.id);
            continue;
        }
        let graph: V | null = null;
        try {
            graph = validate(p.load());
        } catch {
            graph = null;
        }
        if (graph === null) {
            source.quarantine(p.id, { bootSeq: marker.bootSeq, reason: 'corrupt-or-invalid' });
            quarantined.push(p.id);
            continue;
        }
        // A usable candidate — stamp it on the marker so a crash now quarantines
        // exactly this snapshot on the next boot.
        marker.loadedSnapshotId = p.id;
        writeMarker(store, marker);
        return {
            ...base,
            mode: quarantined.length > 0 ? 'quarantine-and-fallback' : 'restore',
            restored: { graph, snapshotId: p.id },
            quarantined,
        };
    }

    // Nothing valid survived: open a clean empty canvas (suspects preserved).
    return { ...base, mode: 'clean', quarantined };
}

/**
 * Forgive the crash streak: we reached a known-good live state and stayed there
 * for a settle window, so past crashes should no longer push us toward Safe Mode.
 *
 * It deliberately KEEPS the session `open` — a crash AFTER settling must still be
 * caught on the next boot and restored. Only {@link markCleanExit} clears `open`.
 * The App gates this on engine-live + a settle window (so a session that crashes
 * within seconds of going live never forgives its streak — the backstop holds).
 */
export function settle(store: MarkerStore): void {
    const m = parseMarker(store.read());
    if (!m) return;
    writeMarker(store, { ...m, crashes: [] });
}

/**
 * Record a clean shutdown: the next boot will see `open: false` and open
 * normally. Called on `pagehide` / window close.
 */
export function markCleanExit(store: MarkerStore): void {
    const m = parseMarker(store.read());
    if (!m) return;
    writeMarker(store, { ...m, open: false });
}

/**
 * Re-open the current session marker WITHOUT bumping the boot sequence. Used when
 * a page returns from the bfcache (`pageshow` with `persisted`): we cleared
 * `open` on `pagehide`, so a crash after resuming would otherwise look like a
 * clean prior shutdown. Re-opening keeps the crash net armed for the resumed
 * session.
 */
export function markSessionOpen(store: MarkerStore): void {
    const m = parseMarker(store.read());
    if (!m) return;
    writeMarker(store, { ...m, open: true });
}

/** Force a clean, empty breaker (e.g. the user chose "Start Fresh" in Safe Mode). */
export function reset(store: MarkerStore): void {
    writeMarker(store, { ...freshMarker(newInstanceId()), open: false });
}
