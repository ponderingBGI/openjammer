/**
 * paletteScore (M2) tests — the fzf-style subsequence scorer.
 *
 * Asserts the ORDERING guarantees the palette relies on:
 *   - a subsequence match scores > 0; a non-subsequence scores 0;
 *   - a prefix match beats a mid-word match of the same query;
 *   - a word-boundary match beats a non-boundary (mid-word) match;
 *   - the scorer is case-insensitive.
 */

import { describe, it, expect } from 'vitest';
import { score } from '../paletteScore';

describe('paletteScore', () => {
    it('matches a subsequence (not just contiguous substrings)', () => {
        // "adlp" is a subsequence of "Add Looper" (A-d ... L-p).
        expect(score('adlp', 'Add Looper')).toBeGreaterThan(0);
    });

    it('returns 0 when the query is not a subsequence', () => {
        expect(score('xyz', 'Add Looper')).toBe(0);
        expect(score('zoo', 'Add Looper')).toBe(0);
    });

    it('returns 0 for a blank query', () => {
        expect(score('', 'Add Looper')).toBe(0);
        expect(score('   ', 'Add Looper')).toBe(0);
    });

    it('is case-insensitive', () => {
        expect(score('LOOPER', 'add looper')).toBeGreaterThan(0);
        expect(score('looper', 'ADD LOOPER')).toBeGreaterThan(0);
        expect(score('LoOpEr', 'Add Looper')).toEqual(score('looper', 'Add Looper'));
    });

    it('prefix beats mid-word for the same query', () => {
        const prefix = score('loop', 'Looper');
        const midword = score('loop', 'Add Looper'); // "loop" sits mid-string
        expect(prefix).toBeGreaterThan(midword);
        expect(midword).toBeGreaterThan(0);
    });

    it('gives a word-boundary match more weight than a mid-word match', () => {
        // 'p' at a word boundary ("Phase Looper" → leading P) vs mid-word ("Looper").
        const boundary = score('p', 'Phaser');
        const midword = score('p', 'Looper'); // 'p' is mid-word in "Looper"
        expect(boundary).toBeGreaterThan(midword);
        expect(midword).toBeGreaterThan(0);
    });

    it('ranks a contiguous run above a scattered one of equal length', () => {
        const contiguous = score('add', 'Add Looper'); // "add" contiguous at start
        const scattered = score('adl', 'Add Looper'); // a-d ... l scattered
        expect(contiguous).toBeGreaterThan(scattered);
    });

    it('returns 0 against empty text', () => {
        expect(score('x', '')).toBe(0);
    });
});
