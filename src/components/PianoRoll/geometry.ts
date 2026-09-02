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

/**
 * The General MIDI percussion map, as this app actually knows it.
 *
 * It lives HERE, beside the predicate that reads it, and `PianoRoll` imports it
 * for the key gutter — one map, one meaning. It used to be declared privately in
 * `PianoRoll.tsx`, which is how the roll came to label a pitch `Ride` while the
 * predicate that put it in drum mode had never looked at this map at all.
 */
export const GM_DRUM_NAMES: Readonly<Record<number, string>> = {
    35: 'Kick', 36: 'Kick', 37: 'Side stick', 38: 'Snare', 39: 'Clap', 40: 'Snare',
    41: 'Low tom', 42: 'Closed HH', 43: 'Low tom', 44: 'Pedal HH', 45: 'Mid tom',
    46: 'Open HH', 47: 'Mid tom', 48: 'High tom', 49: 'Crash', 50: 'High tom',
    51: 'Ride', 52: 'China', 53: 'Ride bell', 54: 'Tambourine', 55: 'Splash',
    56: 'Cowbell', 57: 'Crash', 59: 'Ride', 60: 'High bongo', 61: 'Low bongo',
};

/** Quarter-note ticks, matching `ojproto::PPQ`. Only a default — a caller with a
 *  real arrangement passes its own. */
const DEFAULT_PPQ = 960;

/**
 * The longest a note may be and still read as a HIT rather than a pitch: a
 * sixteenth. A drum is struck, not held, so length carries no musical meaning on
 * a kit and drum mode is free to draw every note as one 10px diamond. That is
 * exactly why guessing wrong is expensive: a melodic part opened as drums loses
 * the difference between a 480-tick note and a 60-tick one, and gets a key gutter
 * full of `Ride` and `Cowbell` for pitches the player hears as chords.
 */
const HIT_TICKS = DEFAULT_PPQ / 4;

/** Words a human or an importer writes when the track IS a kit. */
const KIT_WORDS = /\b(drum|drums|kit|perc|percussion|beat|beats|groove)\b/i;

/**
 * What a caller can tell the predicate about the track, beyond its notes.
 *
 * These are the only kit DECLARATIONS this codebase can actually make. There is
 * no channel on an `ArrangementNote` — `{ id, tick, durTick, pitch, vel }` is the
 * whole shape — so "channel 10" is not a signal we have, and pretending otherwise
 * would be the same guess in a smarter costume.
 */
export interface DrumDetectionContext {
    /** The bound instrument's registry `category` is `percussion`. The one
     *  unambiguous statement in the system: the player picked a kit. */
    instrumentIsPercussion?: boolean;
    /** The track's name, as the player typed it or an importer wrote it. */
    trackName?: string;
    /** The bound instrument's id, e.g. `gm-standard-kit`. */
    instrumentId?: string;
    /** The arrangement's tick resolution, when the caller has one. */
    ppq?: number;
}

/**
 * Does this clip open as a drum grid?
 *
 * The old rule was `pitches.size <= 16 && every pitch in [35, 81]` — which is
 * MOST TONAL MUSIC. The shipped starter's "Nylon Chords" (a four-note karplus
 * arpeggio in A minor) matched it, so the first clip a new player ever opened
 * rendered as duration-less diamonds beside a gutter reading
 * `D5 · C♯5 · … · Low bongo · Ride · Cowbell`. Pre-existing, but the New DNA roll,
 * the new inline roll and the new starter together put it on the first-run path.
 *
 * So the rule now needs a DRUM-KIT SIGNAL, in descending order of how much the
 * system actually knows:
 *
 *  1. **The instrument is a kit.** `instrumentIsPercussion` — a fact, not a guess.
 *  2. **Someone said so in a name.** A track or instrument called `Drums`, `Kit`,
 *     `Perc`, `Groove`. Weak evidence, but it is evidence; a hash of pitches is not.
 *  3. **The material has the shape of a kit and NOTHING else.** Few distinct
 *     pitches, every one of them named in {@link GM_DRUM_NAMES} (not merely inside
 *     a 47-semitone window), and not one sustained note. A single held note is
 *     enough to disqualify: things you hold are pitches.
 *
 * Ties go to melodic on purpose. Opening a kit in melodic mode costs one click of
 * the `Drums` toggle; opening a song in drum mode misnames every row and throws
 * away every duration on screen.
 */
export function shouldAutoDetectDrums(
    notes: readonly ArrangementNote[],
    context: DrumDetectionContext = {},
): boolean {
    if (notes.length === 0) return false;
    if (context.instrumentIsPercussion) return true;
    if (KIT_WORDS.test(context.trackName ?? '') || KIT_WORDS.test(context.instrumentId ?? '')) return true;

    const pitches = new Set(notes.map((note) => note.pitch));
    if (pitches.size > 16) return false;
    if (![...pitches].every((pitch) => pitch in GM_DRUM_NAMES)) return false;
    const hitTicks = context.ppq ? context.ppq / 4 : HIT_TICKS;
    return notes.every((note) => note.durTick <= hitTicks);
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

