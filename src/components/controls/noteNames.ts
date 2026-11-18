/**
 * MIDI note names — the ONE place a note number becomes a name.
 *
 * Four faceplates had their own copy of this twelve-element array and its
 * octave arithmetic (`MiniLab3Visual`, `MIDIDeviceConfig`, the instrument
 * faceplates, the Sampler). A note name is an exact machine fact rendered in
 * mono; there is no room for two versions of it that disagree at the edges.
 *
 * Convention: MIDI 60 = C4 (the "scientific" octave used everywhere else in
 * this codebase — see `audio/ojgraph/noteRouting.toMidi`).
 */

/** The chromatic scale, sharps — index = semitone within the octave. */
export const NOTE_NAMES = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
] as const;

/** The black keys of an octave, by semitone index. */
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

/** Name only, no octave — `60` → `C`. Wraps, so any integer is safe. */
export function noteName(midiNote: number): string {
    const index = ((Math.round(midiNote) % 12) + 12) % 12;
    return NOTE_NAMES[index];
}

/** Octave number for a MIDI note — `60` → `4`. */
export function noteOctave(midiNote: number): number {
    return Math.floor(Math.round(midiNote) / 12) - 1;
}

/** Full label — `60` → `C4`. */
export function noteLabel(midiNote: number): string {
    return `${noteName(midiNote)}${noteOctave(midiNote)}`;
}

/** Is this MIDI note a black key? */
export function isBlackKey(midiNote: number): boolean {
    return BLACK_SEMITONES.has(((Math.round(midiNote) % 12) + 12) % 12);
}

/** Label from a (semitone-within-octave, octave) pair — `(0, 4)` → `C4`. */
export function noteLabelFromDegree(semitone: number, octave: number): string {
    const rounded = Math.round(semitone);
    const carried = octave + Math.floor(rounded / 12);
    return `${noteName(rounded)}${carried}`;
}
