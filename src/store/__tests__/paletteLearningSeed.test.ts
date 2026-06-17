/**
 * Palette learning SEED (D-LEARN, M7) tests.
 *
 * Proves the Pi-memory seed entry point:
 *   - seeds ONLY when `caps.learning === 'pi-memory'`;
 *   - the additive merge NEVER LOWERS a live local score (the local frecency
 *     floor is unconditional) — the core invariant the founder source must honour.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, BROWSER_CAPABILITIES } from '../../engine/capabilities';

// Swappable capability row, read lazily inside seedPaletteLearning.
let caps = DESKTOP_CAPABILITIES;
vi.mock('../../audio/executor', () => ({
    getExecutor: () => ({ getCapabilities: () => caps }),
}));

import {
    usePaletteLearningStore,
    setLearningClock,
    resetLearningClock,
} from '../paletteLearningStore';
import { seedPaletteLearning } from '../paletteLearningSeed';
import type { ActionCtx } from '../commandRegistry';

function emptyCtx(): ActionCtx {
    return { caps, targetKinds: ['global'], selectedIds: [], point: undefined };
}

function resetStore(): void {
    usePaletteLearningStore.setState({
        frecency: {},
        ctxFrecency: {},
        prefixWins: {},
        lastUsed: {},
        seedBoosts: {},
    });
}

describe('palette learning seed (M7)', () => {
    beforeEach(() => {
        caps = DESKTOP_CAPABILITIES;
        // Freeze the frecency clock so a score read before and after an async
        // step is decay-stable — otherwise a millisecond of real wall-time
        // between reads makes an exact-equality assertion flaky (CI vs local).
        setLearningClock(() => 1_000_000);
        resetStore();
    });

    afterEach(() => {
        resetLearningClock();
    });

    it('applySeedBoosts NEVER lowers a live local score (additive floor)', () => {
        const store = usePaletteLearningStore.getState();
        const ctx = emptyCtx();
        // A live, on-device score from a real pick.
        store.recordPick('node.add.looper', ctx);
        const before = usePaletteLearningStore.getState().scoreFor('node.add.looper', ctx);
        expect(before).toBeGreaterThan(0);

        // A seed can only RAISE: even a "negative" seed is additive over the seed
        // map, but the floor (the live frecency) is read independently, so the
        // command's score can never end up BELOW its live local value.
        store.applySeedBoosts({ 'node.add.looper': 5 });
        const boosted = usePaletteLearningStore.getState().scoreFor('node.add.looper', ctx);
        expect(boosted).toBeGreaterThanOrEqual(before);
        expect(boosted).toBeCloseTo(before + 5, 5);
    });

    it('seedPaletteLearning is a no-op on local-only (browser)', async () => {
        caps = BROWSER_CAPABILITIES; // learning: 'local-only'
        await seedPaletteLearning();
        // Nothing seeded.
        expect(usePaletteLearningStore.getState().seedBoosts).toEqual({});
    });

    it('seedPaletteLearning is a safe no-op with the founder-gated empty stub', async () => {
        caps = DESKTOP_CAPABILITIES; // learning: 'pi-memory'
        // The stub fetchSeedBoosts returns {}, so nothing is merged — but it must
        // not throw and must leave a live score untouched.
        const ctx = emptyCtx();
        usePaletteLearningStore.getState().recordPick('node.add.looper', ctx);
        const before = usePaletteLearningStore.getState().scoreFor('node.add.looper', ctx);
        await seedPaletteLearning();
        const after = usePaletteLearningStore.getState().scoreFor('node.add.looper', ctx);
        expect(after).toBe(before);
    });
});
