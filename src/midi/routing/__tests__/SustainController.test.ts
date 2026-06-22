/**
 * Tests for the per-note {@link SustainController}.
 *
 * This is the pure decision core shared by hardware CC64 (MIDIVoiceRouter) and
 * the computer-keyboard sustain key (audioStore). It owns NO executor and NO
 * graph — it only decides whether a note-off is held and which voices to flush.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SustainController } from '../SustainController';

describe('SustainController', () => {
    let s: SustainController;
    beforeEach(() => {
        s = new SustainController();
    });

    it('pedal up: note-off is not held (immediate release)', () => {
        expect(s.onNoteOff('n', 1, 0)).toBe(false);
    });

    it('pedal down: note-off is held and flushed once on pedal up', () => {
        s.setPedal('n', true);
        expect(s.onNoteOff('n', 1, 0)).toBe(true); // held
        expect(s.onNoteOff('n', 1, 2)).toBe(true); // held
        const flushed = s.setPedal('n', false);
        expect(flushed).toEqual([
            { row: 1, keyIndex: 0 },
            { row: 1, keyIndex: 2 }
        ]);
        // Set is cleared after flush.
        expect(s.flush('n')).toEqual([]);
    });

    it('a held voice is recorded only once even if note-off repeats', () => {
        s.setPedal('n', true);
        s.onNoteOff('n', 1, 0);
        s.onNoteOff('n', 1, 0); // duplicate note-off (same voice)
        expect(s.setPedal('n', false)).toEqual([{ row: 1, keyIndex: 0 }]);
    });

    it('re-pressing a held note drops its held entry (no double-off)', () => {
        s.setPedal('n', true);
        s.onNoteOff('n', 1, 0); // held
        s.onNoteOn('n', 1, 0); // re-press clears the held entry
        // Nothing left to flush — the re-press owns the live voice.
        expect(s.setPedal('n', false)).toEqual([]);
    });

    it('onNoteOn is harmless when nothing is held', () => {
        expect(() => s.onNoteOn('n', 1, 0)).not.toThrow();
        expect(s.flush('n')).toEqual([]);
    });

    it('pedal up with nothing held returns an empty flush', () => {
        s.setPedal('n', true);
        expect(s.setPedal('n', false)).toEqual([]);
    });

    it('only the down->up edge flushes (down->down and up->up do not)', () => {
        s.setPedal('n', true);
        s.onNoteOff('n', 1, 0);
        expect(s.setPedal('n', true)).toEqual([]); // down -> down: no flush
        expect(s.isPedalDown('n')).toBe(true);
        // Voice is still held; the real release edge flushes it.
        expect(s.setPedal('n', false)).toEqual([{ row: 1, keyIndex: 0 }]);
        expect(s.setPedal('n', false)).toEqual([]); // up -> up: no flush
    });

    it('two nodes hold and flush independently', () => {
        s.setPedal('a', true);
        s.onNoteOff('a', 1, 0);
        // Node b's pedal is up -> its note-off is immediate.
        expect(s.onNoteOff('b', 1, 0)).toBe(false);
        // Flushing a does not touch b (b had nothing held anyway).
        expect(s.setPedal('a', false)).toEqual([{ row: 1, keyIndex: 0 }]);
        expect(s.flush('b')).toEqual([]);
    });

    it('reset clears all pedal + held state', () => {
        s.setPedal('a', true);
        s.onNoteOff('a', 1, 0);
        s.reset();
        expect(s.isPedalDown('a')).toBe(false);
        expect(s.flush('a')).toEqual([]);
    });
});
