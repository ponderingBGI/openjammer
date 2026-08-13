/**
 * Crash-loop-safety types (Track B P0).
 *
 * These describe the BREAKER — the small, payload-separate record that lets the
 * app decide, at boot, whether the last session crashed and whether restoring
 * the surviving work is safe or would reopen into a "deadly crash cycle". The
 * breaker is deliberately tiny and stored SEPARATELY from the work it guards, so
 * a corrupt payload can never stop us from reading the breaker, and an evicted
 * breaker fails toward Safe Mode rather than silently re-arming a crash loop.
 *
 * Everything here is pure data + pure functions (see {@link ./breaker}); the
 * storage and React wiring live in sibling modules so the decision logic is
 * unit-testable without a DOM.
 */

/** One recorded crash, keyed by the monotonic boot sequence (clock-skew-proof). */
export interface CrashRecord {
    /** The `bootSeq` of the boot during which this crash was detected. */
    bootSeq: number;
    /** Wall-clock ms when recorded — for display ONLY, never for gating. */
    at: number;
    /** Identity of the snapshot that was loaded when the crash happened, if any. */
    snapshotId: string | null;
    /** A short, human-readable failing stage (for the Send-Report bundle). */
    stage?: string;
}

/**
 * The persisted breaker. Written redundantly and parsed fail-safe: a missing or
 * unparseable breaker is treated as a dirty boot (see {@link readMarker}).
 */
export interface Marker {
    /** Schema tag so a future format change is detectable, not a silent reset. */
    v: 1;
    /**
     * `true` between {@link openSession} (synchronous, at boot, before hydrate)
     * and the settle clear. Its presence at the NEXT boot means the last session
     * did not close cleanly — i.e. it crashed.
     */
    open: boolean;
    /** Monotonic counter, incremented once per boot. Never derived from a clock. */
    bootSeq: number;
    /** Per-tab id so one tab's clean exit can't clear a sibling's marker. */
    instanceId: string;
    /** Identity of the snapshot loaded this session (stamped after a restore). */
    loadedSnapshotId: string | null;
    /** Recent crashes, pruned to the streak window on write. */
    crashes: CrashRecord[];
}

/** What the boot-time recovery decision resolves to. */
export type RecoveryMode =
    /** Last session closed cleanly (or nothing to restore) — open normally. */
    | 'clean'
    /** Dirty boot, a fresh payload — restore it and show a calm "Recovered" pill. */
    | 'restore'
    /** This snapshot already crashed once — quarantine it, fall back to an older one. */
    | 'quarantine-and-fallback'
    /** Repeated crashes — boot to a valid empty canvas + the one Safe-Mode chooser. */
    | 'safe-mode';

/** The inputs the pure decision function needs (all derivable from the marker). */
export interface RecoveryInput {
    /** Could the breaker be read+parsed at all? A torn/evicted marker ⇒ false. */
    markerReadable: boolean;
    /** Did the last session fail to close cleanly (marker still `open`)? */
    dirty: boolean;
    /** Is there a non-quarantined, restorable payload to consider? */
    payloadPresent: boolean;
    /** How many times the candidate snapshot has already crashed on load. */
    snapshotCrashCount: number;
    /** Crashes within the recent boot-seq window (the streak). */
    streakCount: number;
}

/** Tunables for the breaker. Centralized so the property tests pin them. */
export interface BreakerConfig {
    /** Crashes-in-window that trip Safe Mode. Bounds restore attempts to ~this. */
    safeModeThreshold: number;
    /** Width of the streak window, measured in boots (monotonic, not seconds). */
    streakWindowBoots: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
    safeModeThreshold: 3,
    streakWindowBoots: 6,
};
