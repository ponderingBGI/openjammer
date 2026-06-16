/**
 * MIDI note <-> (row, keyIndex) mapping (U13, control-side).
 *
 * The {@link Executor} note seam — `noteOn(keyboardId, row, keyIndex, velocity)`
 * — addresses a voice by the input node's *row* (1-3, selecting an output
 * port/octave) and *keyIndex* (0-11, a chromatic offset within that row's
 * octave). The audio backend then resolves the concrete pitch from the input
 * node's per-row octave configuration plus any per-row instrument offsets.
 *
 * To turn an incoming raw MIDI note (0-127) into that address we invert the
 * backend's octave math: a row whose octave is `O` covers the MIDI octave block
 * `[(O + 1) * 12, (O + 1) * 12 + 11]` (MIDI note 60 == C4 == octave 4). We pick
 * the row whose octave block contains the note (preserving pitch exactly); if no
 * row's block contains it, we fall back to the row with the nearest octave and
 * keep the pitch class (`note % 12`), accepting an octave shift rather than
 * dropping the note.
 *
 * These helpers are pure so they can be unit-tested without a graph or audio
 * backend.
 */

/** Keyboard rows are 1-indexed (rows 1-3). */
export const MIN_ROW = 1;
export const MAX_ROW = 3;

/** Key index is 0-indexed within a row's chromatic octave (0-11). */
export const MIN_KEY_INDEX = 0;
export const MAX_KEY_INDEX = 11;

/** Notes per octave. */
const NOTES_PER_OCTAVE = 12;

/**
 * Default per-row octaves, mirroring the audio backend's keyboard default
 * (`rowOctaves ?? [4, 3, 2]`). Row 1 -> octave 4, row 2 -> octave 3, row 3 ->
 * octave 2.
 */
export const DEFAULT_ROW_OCTAVES: readonly [number, number, number] = [4, 3, 2];

/** A resolved voice address for the {@link Executor} note seam. */
export interface RowKey {
    /** 1-indexed row (selects the input node's output port / octave). */
    row: number;
    /** 0-indexed chromatic key within the row (0-11). */
    keyIndex: number;
}

/** The MIDI octave a note belongs to (MIDI 60 == C4 == octave 4). */
export function midiNoteToOctave(note: number): number {
    return Math.floor(note / NOTES_PER_OCTAVE) - 1;
}

/** The pitch class of a note (0 == C, 11 == B). */
export function midiNotePitchClass(note: number): number {
    return ((note % NOTES_PER_OCTAVE) + NOTES_PER_OCTAVE) % NOTES_PER_OCTAVE;
}

/**
 * Resolve a raw MIDI note to a `(row, keyIndex)` address for an input node with
 * the given per-row octaves.
 *
 * Prefers the row whose octave block contains the note exactly (so the resolved
 * pitch matches the played note). When the note falls outside every row's
 * octave, falls back to the row whose octave is numerically nearest and keeps
 * the pitch class — never returning out-of-range values.
 *
 * @param note      Raw MIDI note number (0-127).
 * @param rowOctaves Per-row octave config; defaults to {@link DEFAULT_ROW_OCTAVES}.
 */
export function midiNoteToRowKey(
    note: number,
    rowOctaves: readonly number[] = DEFAULT_ROW_OCTAVES
): RowKey {
    const noteOctave = midiNoteToOctave(note);
    const keyIndex = midiNotePitchClass(note);

    // Prefer an exact octave match so the resolved pitch equals the played note.
    for (let i = 0; i < rowOctaves.length && i < MAX_ROW; i++) {
        if (rowOctaves[i] === noteOctave) {
            return { row: i + 1, keyIndex };
        }
    }

    // Fallback: nearest row by octave distance, preserving the pitch class.
    let bestRow = MIN_ROW;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rowOctaves.length && i < MAX_ROW; i++) {
        const distance = Math.abs(rowOctaves[i] - noteOctave);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestRow = i + 1;
        }
    }

    return { row: bestRow, keyIndex };
}

/** True if a resolved `(row, keyIndex)` is within the executor's valid bounds. */
export function isRowKeyInRange(rowKey: RowKey): boolean {
    return (
        rowKey.row >= MIN_ROW &&
        rowKey.row <= MAX_ROW &&
        rowKey.keyIndex >= MIN_KEY_INDEX &&
        rowKey.keyIndex <= MAX_KEY_INDEX
    );
}
