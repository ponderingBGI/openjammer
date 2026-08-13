// src/music/chord.ts — chord construction (MIDI-integer, pure).

import { degreeToMidi, type Mode } from './scale';
import { clampMidi } from './note';

/** A chord is an ordered set of MIDI pitches (low -> high). */
export type Chord = number[];

/**
 * The diatonic triad rooted on scale `degree`: stacked thirds within the mode
 * (root, +2 scale steps, +4 scale steps), so it stays in key (e.g. in A minor,
 * degree 0 = Am, degree 4 = Em). Add `extensions` (further stacked thirds) for
 * 7ths/9ths.
 */
export function diatonicChord(
    rootMidi: number,
    mode: Mode,
    degree: number,
    extensions = 0,
): Chord {
    const steps = 3 + extensions;
    return Array.from({ length: steps }, (_, i) => degreeToMidi(rootMidi, mode, degree + i * 2));
}

/** Triad qualities as absolute semitone offsets from the chord root. */
const QUALITIES = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    diminished: [0, 3, 6],
    augmented: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
} as const;

export type ChordQuality = keyof typeof QUALITIES;

/** An absolute triad on `rootMidi` of the given quality. */
export function triad(rootMidi: number, quality: ChordQuality = 'major'): Chord {
    return QUALITIES[quality].map((i) => clampMidi(rootMidi + i));
}

/** Drop a chord by an octave (e.g. for a bass voicing). */
export function octaveDown(chord: Chord): Chord {
    return chord.map((m) => clampMidi(m - 12));
}
