/**
 * Palette ranking (W4-P5 / UI-028).
 *
 * The exactness boost is the reason "type the name, press Enter" is
 * deterministic. Its two tiers are load-bearing: the exact tier must sit above
 * the palette's learned prefix-win boost (100_000), and the word-prefix tier
 * must sit below it, so a learned preference still wins a partial query.
 */

import { describe, it, expect } from 'vitest';
import { exactnessBoost } from '../ranking';

/** The learned prefix-win boost the palette adds (CommandBar.tsx). */
const PREFIX_WIN = 100_000;

describe('exactnessBoost', () => {
    it('gives nothing for an empty query', () => {
        expect(exactnessBoost('', 'Add Speaker')).toBe(0);
        expect(exactnessBoost('   ', 'Add Speaker')).toBe(0);
    });

    it('matches the full title exactly, case- and space-insensitively', () => {
        expect(exactnessBoost('add speaker', 'Add Speaker')).toBe(1_000_000);
        expect(exactnessBoost('  Add Speaker ', 'Add Speaker')).toBe(1_000_000);
    });

    it('matches the title WITHOUT the "Add" verb the node rows carry', () => {
        expect(exactnessBoost('speaker', 'Add Speaker')).toBe(1_000_000);
    });

    it('nudges a word-prefix match, below the learned prefix win', () => {
        const boost = exactnessBoost('speak', 'Add Speaker');
        expect(boost).toBeGreaterThan(0);
        expect(boost).toBeLessThan(PREFIX_WIN);
    });

    it('puts an exact match ABOVE the learned prefix win', () => {
        expect(exactnessBoost('speaker', 'Add Speaker')).toBeGreaterThan(PREFIX_WIN);
    });

    it('gives nothing to a mid-word or unrelated query', () => {
        expect(exactnessBoost('eaker', 'Add Speaker')).toBe(0);
        expect(exactnessBoost('looper', 'Add Speaker')).toBe(0);
    });
});
