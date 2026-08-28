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

export function pitchRowHeight(fieldHeight: number, range: PitchRange, drumMode: boolean): number {
    if (drumMode) return DRUM_ROW_HEIGHT;
    return Math.max(3, Math.min(16, fieldHeight / Math.max(12, range.hi - range.lo + 1)));
}

export function velocityOpacity(velocity = 96): number {
    return 0.45 + 0.55 * Math.max(0, Math.min(127, velocity)) / 127;
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

