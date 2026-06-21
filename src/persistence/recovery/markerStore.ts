/**
 * Breaker storage (Track B P0).
 *
 * The breaker is written REDUNDANTLY so eviction or a torn write of one copy
 * cannot disarm the crash-loop guard: a {@link WebMarkerStore} writes two
 * localStorage keys and reads whichever survives. Reads are synchronous because
 * the decision must happen at boot, before any async hydrate. Storage is behind
 * an interface so the decision logic is testable with {@link MemoryMarkerStore}
 * and so a future durable sink (OPFS Worker / native fsync — Track B P1) can be
 * swapped in without touching the breaker.
 */

/** A tiny synchronous string slot, redundant under the hood. */
export interface MarkerStore {
    /** The raw serialized marker, or `null` if no copy is readable. */
    read(): string | null;
    /** Persist the raw serialized marker (best-effort across all copies). */
    write(raw: string): void;
    /** Remove every copy (used only by tests / explicit reset). */
    clear(): void;
}

const PRIMARY_KEY = 'openjammer-recovery-marker';
const SHADOW_KEY = 'openjammer-recovery-marker.bak';

/**
 * Is `raw` a value the breaker can actually parse? A torn write (the tab died
 * mid-`setItem`) leaves a truncated, non-JSON string in one copy; the redundant
 * copy is the whole point. We test PARSEABILITY (not full marker validity — that
 * lives in {@link parseMarker}) so `read` can prefer the copy that survives, not
 * the merely-present one.
 */
function isParseable(raw: string | null): boolean {
    if (raw === null) return false;
    try {
        JSON.parse(raw);
        return true;
    } catch {
        return false;
    }
}

/**
 * localStorage-backed, doubly-written breaker store. Each copy is independent;
 * `read` returns the first PARSEABLE copy, so a torn/invalid primary (the tab
 * died mid-write) falls through to the surviving shadow instead of disarming the
 * crash-loop guard with garbage. Every method swallows storage errors (private
 * mode / quota) because a breaker we cannot persist must degrade gracefully,
 * never throw at boot.
 */
export class WebMarkerStore implements MarkerStore {
    read(): string | null {
        try {
            const primary = localStorage.getItem(PRIMARY_KEY);
            const shadow = localStorage.getItem(SHADOW_KEY);
            // Prefer the first copy we can actually parse: a torn primary must not
            // shadow a readable backup (that would defeat the redundant write).
            if (isParseable(primary)) return primary;
            if (isParseable(shadow)) return shadow;
            // Neither parses — hand back whatever exists so the caller's own
            // fail-safe parse decides (a present-but-garbage marker is treated as
            // unreadable ⇒ fail toward Safe Mode, never a silent count reset).
            return primary ?? shadow;
        } catch {
            return null;
        }
    }

    write(raw: string): void {
        try {
            localStorage.setItem(PRIMARY_KEY, raw);
        } catch {
            /* primary copy unavailable — the shadow below is the fallback */
        }
        try {
            localStorage.setItem(SHADOW_KEY, raw);
        } catch {
            /* both copies unavailable: the breaker can't persist this run */
        }
    }

    clear(): void {
        try {
            localStorage.removeItem(PRIMARY_KEY);
            localStorage.removeItem(SHADOW_KEY);
        } catch {
            /* nothing to do */
        }
    }
}

/** In-memory store for unit tests (and a non-persistent fallback). */
export class MemoryMarkerStore implements MarkerStore {
    private value: string | null;
    constructor(initial: string | null = null) {
        this.value = initial;
    }
    read(): string | null {
        return this.value;
    }
    write(raw: string): void {
        this.value = raw;
    }
    clear(): void {
        this.value = null;
    }
}

/** A best-effort unique id for this tab/instance. */
export function newInstanceId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        /* fall through */
    }
    // Deterministic-enough fallback: high-res time + a counter-ish suffix.
    return `inst-${Math.floor(performance.now?.() ?? 0)}-${(globalThis as { __ojInstN?: number }).__ojInstN = ((globalThis as { __ojInstN?: number }).__ojInstN ?? 0) + 1}`;
}
