/**
 * The crash-loop breaker — PURE decision logic (Track B P0).
 *
 * This is the heart of "never reopen into a deadly crash cycle." Given only the
 * breaker state (never the payload), it decides whether a dirty boot should
 * restore the surviving work, quarantine a snapshot that already crashed and
 * fall back to an older one, or — after repeated crashes — drop to a valid empty
 * canvas in Safe Mode. Every branch is deterministic and unit-tested; there is
 * no I/O and no clock here (see {@link ./markerStore} and {@link ./recover}).
 *
 * Why boot-sequence, not wall-clock: a backward clock jump (NTP correction, a
 * VM resume, a dual-boot) must neither hide a real crash loop nor falsely trip
 * the breaker. The streak window is therefore measured in monotonic boots.
 */

import {
    DEFAULT_BREAKER_CONFIG,
    type BreakerConfig,
    type CrashRecord,
    type Marker,
    type RecoveryInput,
    type RecoveryMode,
} from './types';

/**
 * Count crashes inside the streak window, measured in BOOTS from `currentBootSeq`
 * (monotonic ⇒ clock-skew-proof). A crash recorded at boot `b` counts while
 * `currentBootSeq - b < streakWindowBoots`.
 */
export function streakCount(
    crashes: readonly CrashRecord[],
    currentBootSeq: number,
    cfg: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): number {
    let n = 0;
    for (const c of crashes) {
        if (currentBootSeq - c.bootSeq < cfg.streakWindowBoots) n += 1;
    }
    return n;
}

/** How many times the given snapshot id has crashed across the recorded window. */
export function snapshotCrashCount(
    crashes: readonly CrashRecord[],
    snapshotId: string | null,
): number {
    if (snapshotId === null) return 0;
    let n = 0;
    for (const c of crashes) if (c.snapshotId === snapshotId) n += 1;
    return n;
}

/**
 * THE decision. Order matters and encodes the safety priorities:
 *
 *  1. An unreadable breaker (evicted / torn) is the dangerous case the founder
 *     flagged: we've lost the count, so if restorable (possibly-poison) data
 *     exists we must NOT blindly restore — fail toward Safe Mode. With nothing
 *     to restore there is no loop to fear, so open clean.
 *  2. A clean prior shutdown ⇒ open normally.
 *  3. Dirty but nothing to restore ⇒ open clean (a fresh empty canvas).
 *  4. Too many recent crashes ⇒ Safe Mode (the bounded backstop).
 *  5. This exact snapshot already crashed ⇒ quarantine it and try an older one.
 *  6. Otherwise ⇒ restore the surviving work.
 */
export function decideRecovery(i: RecoveryInput, cfg: BreakerConfig = DEFAULT_BREAKER_CONFIG): RecoveryMode {
    if (!i.markerReadable) return i.payloadPresent ? 'safe-mode' : 'clean';
    if (!i.dirty) return 'clean';
    if (!i.payloadPresent) return 'clean';
    if (i.streakCount >= cfg.safeModeThreshold) return 'safe-mode';
    if (i.snapshotCrashCount >= 1) return 'quarantine-and-fallback';
    return 'restore';
}

/** A fresh, clean breaker for a never-seen-before origin. */
export function freshMarker(instanceId: string): Marker {
    return { v: 1, open: false, bootSeq: 0, instanceId, loadedSnapshotId: null, crashes: [] };
}

/**
 * Serialize defensively. The breaker must always round-trip to a parseable
 * string; we never let a serialization throw escape (it would disarm the loop).
 */
export function serializeMarker(m: Marker): string {
    return JSON.stringify(m);
}

/**
 * Parse fail-safe. Anything we cannot confidently read as a v1 marker returns
 * `null`, which the caller treats as an unreadable (⇒ fail-toward-Safe-Mode)
 * boot rather than risking a silent reset of the crash count.
 */
export function parseMarker(raw: string | null): Marker | null {
    if (raw === null) return null;
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof obj !== 'object' || obj === null) return null;
    const m = obj as Record<string, unknown>;
    if (m.v !== 1) return null;
    if (typeof m.open !== 'boolean') return null;
    if (typeof m.bootSeq !== 'number' || !Number.isFinite(m.bootSeq)) return null;
    if (typeof m.instanceId !== 'string') return null;
    const loadedSnapshotId =
        m.loadedSnapshotId === null || typeof m.loadedSnapshotId === 'string'
            ? (m.loadedSnapshotId as string | null)
            : null;
    const crashes: CrashRecord[] = Array.isArray(m.crashes)
        ? m.crashes.flatMap((c) => {
              if (typeof c !== 'object' || c === null) return [];
              const rec = c as Record<string, unknown>;
              if (typeof rec.bootSeq !== 'number' || !Number.isFinite(rec.bootSeq)) return [];
              return [
                  {
                      bootSeq: rec.bootSeq,
                      at: typeof rec.at === 'number' ? rec.at : 0,
                      snapshotId: typeof rec.snapshotId === 'string' ? rec.snapshotId : null,
                      stage: typeof rec.stage === 'string' ? rec.stage : undefined,
                  },
              ];
          })
        : [];
    return { v: 1, open: m.open, bootSeq: m.bootSeq, instanceId: m.instanceId, loadedSnapshotId, crashes };
}

/** Drop crash records older than the streak window so the marker stays bounded. */
export function pruneCrashes(
    crashes: readonly CrashRecord[],
    currentBootSeq: number,
    cfg: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): CrashRecord[] {
    // Keep a little history beyond the gating window for the report bundle, but
    // never let it grow without bound.
    const keepWithin = cfg.streakWindowBoots * 2;
    return crashes.filter((c) => currentBootSeq - c.bootSeq < keepWithin);
}
