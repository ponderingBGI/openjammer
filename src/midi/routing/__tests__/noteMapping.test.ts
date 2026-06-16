/**
 * Tests for the pure MIDI note -> (row, keyIndex) mapping (U13).
 */

import { describe, it, expect } from 'vitest';
import {
    midiNoteToRowKey,
    midiNoteToOctave,
    midiNotePitchClass,
    isRowKeyInRange,
    DEFAULT_ROW_OCTAVES
} from '../noteMapping';

describe('noteMapping', () => {
    describe('midiNoteToOctave', () => {
        it('treats MIDI 60 as C4 (octave 4)', () => {
            expect(midiNoteToOctave(60)).toBe(4);
            expect(midiNoteToOctave(48)).toBe(3);
            expect(midiNoteToOctave(36)).toBe(2);
            expect(midiNoteToOctave(0)).toBe(-1);
        });
    });

    describe('midiNotePitchClass', () => {
        it('returns the chromatic pitch class 0-11', () => {
            expect(midiNotePitchClass(60)).toBe(0); // C
            expect(midiNotePitchClass(61)).toBe(1); // C#
            expect(midiNotePitchClass(71)).toBe(11); // B
            expect(midiNotePitchClass(72)).toBe(0); // C (next octave)
        });
    });

    describe('midiNoteToRowKey (default octaves [4,3,2])', () => {
        it('maps octave-4 notes to row 1', () => {
            expect(midiNoteToRowKey(60)).toEqual({ row: 1, keyIndex: 0 }); // C4
            expect(midiNoteToRowKey(62)).toEqual({ row: 1, keyIndex: 2 }); // D4
            expect(midiNoteToRowKey(71)).toEqual({ row: 1, keyIndex: 11 }); // B4
        });

        it('maps octave-3 notes to row 2', () => {
            expect(midiNoteToRowKey(48)).toEqual({ row: 2, keyIndex: 0 }); // C3
            expect(midiNoteToRowKey(59)).toEqual({ row: 2, keyIndex: 11 }); // B3
        });

        it('maps octave-2 notes to row 3', () => {
            expect(midiNoteToRowKey(36)).toEqual({ row: 3, keyIndex: 0 }); // C2
        });

        it('falls back to the nearest row, preserving pitch class, when no octave matches', () => {
            // Note 84 = C6 (octave 6). Nearest configured octave is 4 (row 1).
            const result = midiNoteToRowKey(84);
            expect(result.row).toBe(1);
            expect(result.keyIndex).toBe(0); // C

            // Note 24 = C1 (octave 1). Nearest configured octave is 2 (row 3).
            const low = midiNoteToRowKey(24);
            expect(low.row).toBe(3);
            expect(low.keyIndex).toBe(0);
        });
    });

    describe('midiNoteToRowKey (custom octaves)', () => {
        it('uses the provided per-row octaves', () => {
            // [5,4,3]: note 60 = C4 (octave 4) -> row 2.
            expect(midiNoteToRowKey(60, [5, 4, 3])).toEqual({ row: 2, keyIndex: 0 });
            // octave 5 -> row 1.
            expect(midiNoteToRowKey(72, [5, 4, 3])).toEqual({ row: 1, keyIndex: 0 });
        });
    });

    describe('isRowKeyInRange', () => {
        it('accepts in-range values and rejects out-of-range', () => {
            expect(isRowKeyInRange({ row: 1, keyIndex: 0 })).toBe(true);
            expect(isRowKeyInRange({ row: 3, keyIndex: 11 })).toBe(true);
            expect(isRowKeyInRange({ row: 0, keyIndex: 0 })).toBe(false);
            expect(isRowKeyInRange({ row: 4, keyIndex: 0 })).toBe(false);
            expect(isRowKeyInRange({ row: 1, keyIndex: 12 })).toBe(false);
            expect(isRowKeyInRange({ row: 1, keyIndex: -1 })).toBe(false);
        });
    });

    describe('DEFAULT_ROW_OCTAVES', () => {
        it('matches the audio backend default', () => {
            expect(DEFAULT_ROW_OCTAVES).toEqual([4, 3, 2]);
        });
    });
});
