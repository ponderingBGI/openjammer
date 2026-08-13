import { describe, expect, it } from 'vitest';
import {
    midiToFreq,
    midiToNote,
    clampMidi,
    transpose,
    degreeToMidi,
    scaleNotes,
    snapToScale,
    diatonicChord,
    triad,
    euclid,
    euclidHits,
    arpeggiate,
} from '../index';

describe('note math', () => {
    it('A4 = MIDI 69 = 440 Hz', () => {
        expect(midiToFreq(69)).toBeCloseTo(440, 5);
        expect(midiToFreq(57)).toBeCloseTo(220, 5); // an octave down
        expect(midiToNote(69)).toBe('A4');
        expect(midiToNote(60)).toBe('C4');
        expect(midiToNote(0)).toBe('C-1');
    });
    it('clamps + transposes within [0,127]', () => {
        expect(clampMidi(-5)).toBe(0);
        expect(clampMidi(200)).toBe(127);
        expect(transpose(60, 12)).toBe(72);
        expect(transpose(2, -12)).toBe(0); // clamped
    });
});

describe('scale', () => {
    it('A minor (root 57) is all-white-note diatonic', () => {
        // A natural minor: A B C D E F G -> 57 59 60 62 64 65 67
        expect(scaleNotes(57, 'minor', 7)).toEqual([57, 59, 60, 62, 64, 65, 67]);
        // degree 7 wraps an octave up to the root.
        expect(degreeToMidi(57, 'minor', 7)).toBe(69);
    });
    it('snaps an out-of-scale pitch to the nearest scale tone', () => {
        // C#5 (61) in A minor snaps to C (60) or D (62); nearest is C (60).
        expect(snapToScale(61, 57, 'minor')).toBe(60);
    });
});

describe('chord', () => {
    it('diatonic triads stay in key (A minor: i = Am, v = Em)', () => {
        expect(diatonicChord(57, 'minor', 0)).toEqual([57, 60, 64]); // A C E = Am
        expect(diatonicChord(57, 'minor', 4)).toEqual([64, 67, 71]); // E G B = Em
    });
    it('absolute triad qualities', () => {
        expect(triad(60, 'major')).toEqual([60, 64, 67]);
        expect(triad(60, 'minor')).toEqual([60, 63, 67]);
    });
});

describe('euclid + arp', () => {
    it('spreads pulses evenly and exposes hit indices', () => {
        const p = euclid(4, 16);
        expect(p.filter(Boolean).length).toBe(4);
        // 4-in-16 lands a hit every 4 steps.
        expect(euclidHits(4, 16)).toEqual([3, 7, 11, 15]);
    });
    it('arpeggiates a chord', () => {
        expect(arpeggiate([60, 64, 67], 4, 'up')).toEqual([60, 64, 67, 60]);
        expect(arpeggiate([60, 64, 67], 3, 'down')).toEqual([67, 64, 60]);
    });
});
