/**
 * paletteLearningStore (M2) tests — the local frecency floor.
 *
 * Covers:
 *   - DECAY math: a recorded pick's score halves after one half-life (5 days),
 *     via an INJECTED deterministic clock;
 *   - PREFIX-WIN override: recording a pick with a query sets the prefix winner;
 *   - D2-A3 PER-DAY saturation cap: N same-day picks raise the score by a bounded
 *     amount (so a spree can't pin a command for days);
 *   - D2-A4 persistence: a corrupt persisted blob RESETS to defaults instead of
 *     bricking the store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    usePaletteLearningStore,
    setLearningClock,
    resetLearningClock,
    HALF_LIFE_MS,
    PER_DAY_CAP,
} from '../paletteLearningStore';
import type { ActionCtx } from '../commandRegistry';
import { DESKTOP_CAPABILITIES } from '../../engine/capabilities';

const DAY_MS = 24 * 60 * 60 * 1000;

/** An empty-canvas palette ctx (paletteContextKey → 'canvas:empty'). */
function emptyCtx(): ActionCtx {
    return {
        caps: DESKTOP_CAPABILITIES,
        targetKinds: ['global', 'selection'],
        selectedIds: [],
        point: undefined,
    };
}

/** Reset the store to pristine defaults between tests. */
function resetStore(): void {
    usePaletteLearningStore.setState({
        frecency: {},
        ctxFrecency: {},
        prefixWins: {},
        lastUsed: {},
        seedBoosts: {},
    });
}

describe('paletteLearningStore (M2)', () => {
    beforeEach(() => {
        resetStore();
    });

    afterEach(() => {
        resetLearningClock();
    });

    describe('decay', () => {
        it('halves a recorded score after one half-life (5 days)', () => {
            let t = 1_000_000;
            setLearningClock(() => t);

            const ctx = emptyCtx();
            const store = usePaletteLearningStore.getState();

            store.recordPick('node.add.looper', ctx);
            const initial = usePaletteLearningStore
                .getState()
                .scoreFor('node.add.looper', ctx);
            expect(initial).toBeGreaterThan(0);

            // Advance exactly one half-life and read again.
            t += HALF_LIFE_MS;
            const later = usePaletteLearningStore
                .getState()
                .scoreFor('node.add.looper', ctx);

            expect(later).toBeCloseTo(initial / 2, 5);
        });

        it('decays toward zero over multiple half-lives', () => {
            let t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();

            usePaletteLearningStore.getState().recordPick('a', ctx);
            const initial = usePaletteLearningStore.getState().scoreFor('a', ctx);

            t += HALF_LIFE_MS * 4; // /16
            const later = usePaletteLearningStore.getState().scoreFor('a', ctx);
            expect(later).toBeCloseTo(initial / 16, 5);
        });
    });

    describe('prefix win', () => {
        it('records the prefix winner for the typed query (<=3 chars)', () => {
            const t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();

            usePaletteLearningStore
                .getState()
                .recordPick('node.add.looper', ctx, 'loop');

            expect(usePaletteLearningStore.getState().prefixWins['loo']).toBe(
                'node.add.looper',
            );
        });

        it('overrides the prefix winner when a different pick uses the same prefix', () => {
            const t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();
            const store = () => usePaletteLearningStore.getState();

            store().recordPick('node.add.looper', ctx, 'lo');
            expect(store().prefixWins['lo']).toBe('node.add.looper');

            store().recordPick('node.add.lowpass', ctx, 'lo');
            expect(store().prefixWins['lo']).toBe('node.add.lowpass');
        });
    });

    describe('D2-A3 per-day saturation cap', () => {
        it('bounds same-day gain regardless of pick count', () => {
            const t = 5_000_000;
            setLearningClock(() => t);
            const ctx = emptyCtx();
            const store = () => usePaletteLearningStore.getState();

            // Spam many picks within the SAME day.
            for (let i = 0; i < 50; i++) {
                store().recordPick('spam', ctx);
            }

            const capped = store().scoreFor('spam', ctx);
            // The global frecency component must not exceed the per-day cap.
            // (scoreFor also folds the ctxFrecency boost, so compare against the
            // raw global entry, which the cap bounds directly.)
            expect(capped).toBeGreaterThan(0);

            // Read the underlying global raw via a fresh single pick comparison:
            // a single pick on a NEW key gains exactly 1; 50 same-day picks on
            // 'spam' must gain no more than PER_DAY_CAP total.
            store().recordPick('single', ctx);
            const singleScore = store().scoreFor('single', ctx);

            // 'spam' global frecency is bounded by PER_DAY_CAP; 'single' is ~1.
            // So 'spam' <= PER_DAY_CAP * (per-pick weight) and never unbounded.
            expect(capped).toBeLessThanOrEqual(PER_DAY_CAP * singleScore + 0.001);
        });

        it('allows further gain after the day window rolls', () => {
            let t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();
            const store = () => usePaletteLearningStore.getState();

            // Saturate day 1.
            for (let i = 0; i < PER_DAY_CAP + 5; i++) store().recordPick('k', ctx);
            const day1 = store().frecency['k'].dayGain;
            expect(day1).toBeLessThanOrEqual(PER_DAY_CAP);

            // Roll into the next day and pick again — the window resets.
            t += DAY_MS + 1;
            store().recordPick('k', ctx);
            // dayGain restarts at ~1 for the new window.
            expect(store().frecency['k'].dayGain).toBeLessThanOrEqual(1.0001);
        });
    });

    describe('resetCommand', () => {
        it('clears a key from frecency, ctxFrecency, lastUsed and prefixWins', () => {
            const t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();
            const store = () => usePaletteLearningStore.getState();

            store().recordPick('node.add.looper', ctx, 'loop');
            expect(store().scoreFor('node.add.looper', ctx)).toBeGreaterThan(0);

            store().resetCommand('node.add.looper');

            expect(store().scoreFor('node.add.looper', ctx)).toBe(0);
            expect(store().frecency['node.add.looper']).toBeUndefined();
            expect(store().lastUsed['node.add.looper']).toBeUndefined();
            expect(store().prefixWins['loo']).toBeUndefined();
        });
    });

    describe('applySeedBoosts', () => {
        it('merges seed boosts additively without replacing live scores', () => {
            const t = 0;
            setLearningClock(() => t);
            const ctx = emptyCtx();
            const store = () => usePaletteLearningStore.getState();

            store().recordPick('k', ctx);
            const live = store().scoreFor('k', ctx);

            store().applySeedBoosts({ k: 10 });
            expect(store().scoreFor('k', ctx)).toBeCloseTo(live + 10, 5);

            // A second merge is additive, not a replace.
            store().applySeedBoosts({ k: 5 });
            expect(store().scoreFor('k', ctx)).toBeCloseTo(live + 15, 5);
        });
    });
});

describe('paletteLearningStore persistence (D2-A4)', () => {
    afterEach(() => {
        resetLearningClock();
        localStorage.clear();
    });

    it('resets to defaults when the persisted blob is corrupt', () => {
        // Start from pristine defaults (simulate a fresh app load).
        usePaletteLearningStore.setState({
            frecency: {},
            ctxFrecency: {},
            prefixWins: {},
            lastUsed: {},
            seedBoosts: {},
        });

        // Plant a corrupt (non-JSON) blob under the persist key.
        localStorage.setItem('openjammer-palette-learning', '{not valid json');

        // Rehydrate from storage; createJSONStorage swallows the parse error
        // (getItem returns null), so the store keeps its defaults instead of
        // throwing — a corrupt blob can't brick the palette.
        expect(() => usePaletteLearningStore.persist.rehydrate()).not.toThrow();

        const state = usePaletteLearningStore.getState();
        expect(state.frecency).toEqual({});
        expect(state.prefixWins).toEqual({});
        expect(state.ctxFrecency).toEqual({});
    });
});
