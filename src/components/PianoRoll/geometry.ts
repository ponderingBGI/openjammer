import type { ArrangementNote } from '../../song/types';
import type { PitchRange } from '../../store/trackLaneViewStore';

export const KEY_COLUMN_WIDTH = 44;
export const SCROOMER_WIDTH = 12;
export const VELOCITY_LANE_HEIGHT = 56;
export const DRUM_ROW_HEIGHT = 18;

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlackPitch(pitch: number): boolean {
    return BLACK_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

export function isKeyboardSeam(pitch: number): boolean {
    const pitchClass = ((pitch % 12) + 12) % 12;
    return pitchClass === 0 || pitchClass === 5;
}

export function pitchName(pitch: number): string {
    const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/**
 * Row height: `clamp(6px, fieldHeight / pitchSpan, 22px)` (spec 2.7).
 *
 * The floor of 6px is the smallest row a pointer can hit reliably (D18). The
 * ceiling of 22px is what lets a narrow pitch range FILL the surface instead of
 * leaving a third of it blank under the notes — at the old 16px cap the full
 * piano roll drew a short block of rows floating above dead space, which reads
 * as a rendering failure rather than as a two-octave part.
 */
export function pitchRowHeight(fieldHeight: number, range: PitchRange, drumMode: boolean): number {
    if (drumMode) return DRUM_ROW_HEIGHT;
    return Math.max(6, Math.min(22, fieldHeight / Math.max(12, range.hi - range.lo + 1)));
}

/**
 * Velocity → the alpha the note is painted at.
 *
 * The floor is **0.68**, not 0.45. A note is the primary object of this editor,
 * so WCAG 1.4.11's 3:1 applies to the quietest one, not just the loudest — and
 * at 0.45 the softest note measured **1.65:1** against a white-key row and
 * 1.63:1 against a black-key one (W4-TB-REVIEW M4, canvas-resolved).
 *
 * Raising the floor alone could not close it: `--universal-connection` at FULL
 * opacity is only 3.35:1 on white, so every velocity below maximum would still
 * have failed. The colour had to move too — see `--piano-roll-note-ink` in
 * `PianoRoll.css`. The two are a pair; `contrast.test.ts` measures the
 * composite of both and will fail if either drifts.
 *
 * Monotonic, and still exactly 1 at velocity 127, so the loudest note is the
 * densest ink on the surface.
 */
export function velocityOpacity(velocity = 96): number {
    return 0.68 + 0.32 * Math.max(0, Math.min(127, velocity)) / 127;
}

export function shouldAutoDetectDrums(notes: readonly ArrangementNote[]): boolean {
    const pitches = new Set(notes.map((note) => note.pitch));
    return pitches.size > 0 && pitches.size <= 16 && [...pitches].every((pitch) => pitch >= 35 && pitch <= 81);
}

export function resizeEdge(pointerX: number, width: number): 'start' | 'end' | null {
    if (width <= 10) return null;
    const zone = Math.min(8, width / 2 - 1);
    if (pointerX <= zone) return 'start';
    if (pointerX >= width - zone) return 'end';
    return null;
}

export function clippedNoteGeometry(
    note: ArrangementNote,
    clipStartTick: number,
    sourceStart: number,
    clipLengthTick: number,
    pxPerTick: number,
): { left: number; width: number } | null {
    const visibleStart = Math.max(sourceStart, note.tick);
    const visibleEnd = Math.min(sourceStart + clipLengthTick, note.tick + note.durTick);
    if (visibleEnd <= visibleStart) return null;
    return {
        left: (clipStartTick + visibleStart - sourceStart) * pxPerTick,
        width: Math.max(2, (visibleEnd - visibleStart) * pxPerTick),
    };
}

