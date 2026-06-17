/**
 * paletteLearningStore (M2) — the LOCAL frecency floor for the Ctrl/Cmd+K palette.
 *
 * On-device, framework-light learning that ranks commands by "frequent + recent"
 * use, plus two lightweight context signals:
 *   - per-context frecency (what you pick WHILE a given thing is selected), and
 *   - prefix wins (the command you usually pick after typing a short prefix).
 *
 * This is the universal FLOOR. The desktop ceiling (`learning: 'pi-memory'`) may
 * later SEED/BOOST it via {@link applySeedBoosts}; that path is plumbed but the
 * seed map starts empty and is merged ADDITIVELY so it never overwrites live
 * on-device scores.
 *
 * Decay model (frecency): a raw count decays by half every {@link HALF_LIFE}.
 * We fold decay LAZILY at read time — each stored raw value carries an `anchor`
 * timestamp; the live score is `raw * 0.5^((now - anchor)/HALF_LIFE)`. On write
 * we first re-anchor (fold the elapsed decay into the stored raw) so increments
 * accrue against the decayed base rather than the stale one.
 *
 * D2-A3 saturation cap: increments are capped PER-DAY-PER-COMMAND so one
 * session's spree can't pin a command at the top for days.
 *
 * D2-A4 persistence: versioned + migrated + try/catch storage so a corrupt blob
 * RESETS to defaults instead of bricking the palette.
 *
 * The runtime clock is the standard epoch-ms timestamp (`Date.now`); tests
 * inject a deterministic clock via {@link setLearningClock} so decay + cap are
 * unit-testable.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ActionCtx } from './commandRegistry';
import { paletteContextKey } from './actionContext';

// ============================================================================
// Constants
// ============================================================================

/** Frecency half-life: a raw count loses half its weight every 5 days. */
export const HALF_LIFE_MS = 5 * 24 * 60 * 60 * 1000;

/** One day in ms — the window for the per-command saturation cap. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * D2-A3: the most a single command's frecency can grow from picks WITHIN one
 * rolling day. After this much same-day gain, further same-day picks add nothing
 * (until the day window rolls / decay erodes the base).
 */
export const PER_DAY_CAP = 4;

/** Per-context frecency contributes at a fraction of the global frecency weight. */
const CTX_WEIGHT = 1.5;

/** Persisted-state schema version (D2-A4 migrate gate). */
const PERSIST_VERSION = 1;

const STORAGE_NAME = 'openjammer-palette-learning';

// ============================================================================
// Injectable clock (for deterministic tests)
// ============================================================================

let clock: () => number = () => Date.now();

/** Test-only: override the epoch-ms clock used for decay + cap math. */
export function setLearningClock(fn: () => number): void {
    clock = fn;
}

/** Test-only: restore the real `Date.now` clock. */
export function resetLearningClock(): void {
    clock = () => Date.now();
}

function now(): number {
    return clock();
}

// ============================================================================
// Types
// ============================================================================

/**
 * One decaying frecency entry: a `raw` weight anchored at `anchor` (epoch ms).
 * The live value is `raw * 0.5^((now - anchor)/HALF_LIFE)`. `dayStart` /
 * `dayGain` track the per-day saturation cap window for this key.
 */
interface FrecencyEntry {
    raw: number;
    anchor: number;
    /** Start (epoch ms) of the current rolling per-day cap window. */
    dayStart: number;
    /** How much raw weight this key has gained within the current day window. */
    dayGain: number;
}

interface PaletteLearningState {
    /** Global frecency per frecencyKey. */
    frecency: Record<string, FrecencyEntry>;
    /** Per-context frecency, keyed `${contextKey} ${frecencyKey}`. */
    ctxFrecency: Record<string, FrecencyEntry>;
    /** Short-prefix (<=3 chars) → the frecencyKey usually chosen after it. */
    prefixWins: Record<string, string>;
    /** Last-used epoch ms per frecencyKey (display / tie-break). */
    lastUsed: Record<string, number>;
    /** Additive seed boosts (from Pi memory later); merged, never replacing live. */
    seedBoosts: Record<string, number>;

    /** Record a pick: fold decay, bump frecency (capped), ctxFrecency, prefix win. */
    recordPick(key: string, ctx: ActionCtx, query?: string): void;
    /** O(1) read: decayed frecency + ctx boost + seed boost. */
    scoreFor(key: string, ctx: ActionCtx): number;
    /** Clear a single key everywhere (per-command reset; used by the M4 menu). */
    resetCommand(key: string): void;
    /** Clear ALL learned ranking — the palette's "Reset Ranking" action. */
    resetAll(): void;
    /** Additively merge seed boosts (Pi memory ceiling), never replacing scores. */
    applySeedBoosts(seeds: Record<string, number>): void;
}

// ============================================================================
// Decay + cap helpers (pure)
// ============================================================================

/** Decayed live value of a frecency entry at `at`. */
function decayed(entry: FrecencyEntry, at: number): number {
    const elapsed = at - entry.anchor;
    if (elapsed <= 0) return entry.raw;
    return entry.raw * Math.pow(0.5, elapsed / HALF_LIFE_MS);
}

/**
 * Fold the elapsed decay into the stored `raw` and re-anchor to `at`, then apply
 * a per-day-capped increment. Returns a NEW entry (immutability for Zustand).
 */
function bump(entry: FrecencyEntry | undefined, at: number): FrecencyEntry {
    // Re-anchor: collapse decay-so-far into the base.
    const base = entry ? decayed(entry, at) : 0;

    // Roll the per-day window if a full day has elapsed since it opened.
    let dayStart = entry?.dayStart ?? at;
    let dayGain = entry?.dayGain ?? 0;
    if (at - dayStart >= DAY_MS) {
        dayStart = at;
        dayGain = 0;
    }

    // D2-A3: cap the increment so this key can't gain more than PER_DAY_CAP/day.
    const allowed = Math.max(0, PER_DAY_CAP - dayGain);
    const increment = Math.min(1, allowed);

    return {
        raw: base + increment,
        anchor: at,
        dayStart,
        dayGain: dayGain + increment,
    };
}

// ============================================================================
// Store
// ============================================================================

export const usePaletteLearningStore = create<PaletteLearningState>()(
    persist(
        (set, get) => ({
            frecency: {},
            ctxFrecency: {},
            prefixWins: {},
            lastUsed: {},
            seedBoosts: {},

            recordPick: (key, ctx, query) => {
                const at = now();
                const ctxKey = `${paletteContextKey(ctx)} ${key}`;

                set((state) => {
                    const frecency = {
                        ...state.frecency,
                        [key]: bump(state.frecency[key], at),
                    };
                    const ctxFrecency = {
                        ...state.ctxFrecency,
                        [ctxKey]: bump(state.ctxFrecency[ctxKey], at),
                    };
                    const lastUsed = { ...state.lastUsed, [key]: at };

                    const prefixWins = { ...state.prefixWins };
                    const trimmed = (query ?? '').trim();
                    if (trimmed !== '') {
                        prefixWins[trimmed.slice(0, 3).toLowerCase()] = key;
                    }

                    return { frecency, ctxFrecency, lastUsed, prefixWins };
                });
            },

            scoreFor: (key, ctx) => {
                const at = now();
                const state = get();

                const base = state.frecency[key]
                    ? decayed(state.frecency[key], at)
                    : 0;

                const ctxKey = `${paletteContextKey(ctx)} ${key}`;
                const ctxBoost = state.ctxFrecency[ctxKey]
                    ? CTX_WEIGHT * decayed(state.ctxFrecency[ctxKey], at)
                    : 0;

                const seed = state.seedBoosts[key] ?? 0;

                return base + ctxBoost + seed;
            },

            resetCommand: (key) => {
                set((state) => {
                    const frecency = { ...state.frecency };
                    delete frecency[key];

                    const lastUsed = { ...state.lastUsed };
                    delete lastUsed[key];

                    const seedBoosts = { ...state.seedBoosts };
                    delete seedBoosts[key];

                    // Drop every per-context entry for this key (suffix match).
                    const ctxFrecency: Record<string, FrecencyEntry> = {};
                    for (const [k, v] of Object.entries(state.ctxFrecency)) {
                        if (!k.endsWith(` ${key}`)) ctxFrecency[k] = v;
                    }

                    // Drop any prefix win that points at this key.
                    const prefixWins: Record<string, string> = {};
                    for (const [k, v] of Object.entries(state.prefixWins)) {
                        if (v !== key) prefixWins[k] = v;
                    }

                    return { frecency, ctxFrecency, lastUsed, seedBoosts, prefixWins };
                });
            },

            resetAll: () => {
                set({
                    frecency: {},
                    ctxFrecency: {},
                    prefixWins: {},
                    lastUsed: {},
                    seedBoosts: {},
                });
            },

            applySeedBoosts: (seeds) => {
                set((state) => {
                    const seedBoosts = { ...state.seedBoosts };
                    for (const [k, v] of Object.entries(seeds)) {
                        seedBoosts[k] = (seedBoosts[k] ?? 0) + v;
                    }
                    return { seedBoosts };
                });
            },
        }),
        {
            name: STORAGE_NAME,
            version: PERSIST_VERSION,
            // D2-A4: localStorage-backed JSON storage. createJSONStorage swallows
            // a getItem/JSON.parse throw by returning null, so a corrupt blob
            // rehydrates as "no persisted state" → the store keeps its defaults
            // instead of bricking the palette.
            storage: createJSONStorage(() => localStorage),
            // Future-proof migration hook: an unknown/older shape resets cleanly.
            migrate: (persisted, version) => {
                if (version !== PERSIST_VERSION) return undefined;
                return persisted as PaletteLearningState;
            },
        },
    ),
);
