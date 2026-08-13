// src/music/scale.ts — diatonic scale math (MIDI-integer, pure). One SSOT the agent
// and the human's future scale/arpeggiator nodes both call.

import { clampMidi } from './note';

export type Mode =
    | 'major'
    | 'minor' // natural minor (aeolian)
    | 'harmonicMinor'
    | 'dorian'
    | 'phrygian'
    | 'lydian'
    | 'mixolydian'
    | 'locrian'
    | 'majorPentatonic'
    | 'minorPentatonic';

/** Semitone offsets from the root, one octave, per mode. */
const INTERVALS: Record<Mode, readonly number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    majorPentatonic: [0, 2, 4, 7, 9],
    minorPentatonic: [0, 3, 5, 7, 10],
};

export function scaleIntervals(mode: Mode): readonly number[] {
    return INTERVALS[mode];
}

/**
 * The MIDI pitch of scale `degree` (0-based). Degrees outside [0, n) wrap into
 * higher/lower octaves (degree n is the root one octave up). Clamped to [0,127].
 */
export function degreeToMidi(rootMidi: number, mode: Mode, degree: number): number {
    const iv = INTERVALS[mode];
    const n = iv.length;
    const octave = Math.floor(degree / n);
    const within = ((degree % n) + n) % n;
    return clampMidi(rootMidi + octave * 12 + iv[within]!);
}

/** `count` ascending scale pitches starting at `rootMidi` (degree 0..count-1). */
export function scaleNotes(rootMidi: number, mode: Mode, count: number): number[] {
    return Array.from({ length: count }, (_, i) => degreeToMidi(rootMidi, mode, i));
}

/** Snap an arbitrary MIDI pitch to the nearest pitch in the scale. */
export function snapToScale(midi: number, rootMidi: number, mode: Mode): number {
    const pc = ((Math.round(midi) - rootMidi) % 12 + 12) % 12;
    const iv = INTERVALS[mode];
    let best = iv[0]!;
    let bestDist = 12;
    for (const i of iv) {
        const d = Math.min(Math.abs(pc - i), 12 - Math.abs(pc - i));
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return clampMidi(Math.round(midi) - pc + best);
}
