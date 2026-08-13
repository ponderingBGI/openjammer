// src/music/note.ts — shared pitch math (SSOT). MIDI-integer first: the agent and
// the human's future music nodes call THESE helpers so neither hand-rolls pitch
// arithmetic (the wrong-note failure mode an AudioReport cannot catch). Pure.
//
// Note-NAME parsing already lives once in `src/midi/MIDIMessageParser.ts`
// (`noteNameToMidi`); this module deliberately does NOT duplicate it — music is
// authored here in MIDI integers (via `./scale` + `./chord`), not name strings.

/** A4 = MIDI 69 = 440 Hz (the equal-temperament anchor). */
export const A4_MIDI = 69;
export const A4_HZ = 440;

/** MIDI note number (may be fractional for microtuning) -> frequency in Hz. */
export function midiToFreq(midi: number): number {
    return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** MIDI note -> a display name like "A4" (C-1 = 0, A4 = 69; sharp spelling). */
export function midiToNote(midi: number): string {
    const m = Math.round(midi);
    const name = SHARP_NAMES[((m % 12) + 12) % 12];
    const octave = Math.floor(m / 12) - 1;
    return `${name}${octave}`;
}

/** Clamp + round to the valid MIDI pitch range [0, 127]. */
export function clampMidi(midi: number): number {
    return Math.max(0, Math.min(127, Math.round(midi)));
}

/** Transpose a pitch by `semitones`, clamped to the MIDI range. */
export function transpose(midi: number, semitones: number): number {
    return clampMidi(midi + semitones);
}
