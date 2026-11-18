/**
 * The beat rig's Song — one real, looping 8-step bar.
 *
 * The prototype's groove was a `setInterval`. This is not: it is an
 * {@link Arrangement} on the shared timeline, played by the same transport that
 * plays a whole album, so pressing Stop stops it, the pill's bar.beat readout is
 * the truth, the piano roll can open it, and `Ctrl+Z` inside the arrangement
 * edits it like any other song. A groove that is not the real timeline is a lie
 * the player discovers in thirty seconds.
 *
 * Three voices on one MIDI source is deliberate: a single track keeps the step
 * grid honest (one clip, one source, three pitches = three rows), and the drum
 * voice is the same `gm-synth-drum` percussion kernel the canvas rig plays, so
 * what the loop sounds like is what your fingers sound like.
 */

import { normalizeArrangement } from '../song/normalize';
import type { Arrangement, ArrangementNote, MidiSource } from '../song/types';

const PPQ = 960;
/** 4/4 — one bar is the whole loop. */
export const BEAT_BAR_TICKS = PPQ * 4;
/** Eight steps per bar: straight eighths. */
export const BEAT_STEPS = 8;
export const BEAT_STEP_TICKS = BEAT_BAR_TICKS / BEAT_STEPS;

/** The clip's single source — the step grid reads and writes exactly this. */
export const BEAT_SOURCE_ID = 'src:midi:beat-rig-groove';
export const BEAT_TRACK_ID = 'beat-rig-kit';
export const BEAT_CLIP_ID = 'beat-rig-clip';

/**
 * The three rows of the grid, top to bottom. General-MIDI drum pitches, so the
 * percussion voice renders them as distinctly as it can.
 */
export const BEAT_ROWS: ReadonlyArray<{ label: string; pitch: number; velocity: number }> = [
    { label: 'HAT', pitch: 42, velocity: 68 },
    { label: 'SNR', pitch: 38, velocity: 92 },
    { label: 'KICK', pitch: 36, velocity: 104 },
];

/** A plain four-on-the-floor with a backbeat and straight hats. Steps are 0-based. */
const PATTERN: Record<number, number[]> = {
    36: [0, 4],
    38: [2, 6],
    42: [0, 1, 2, 3, 4, 5, 6, 7],
};

function grooveNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    for (const row of BEAT_ROWS) {
        for (const step of PATTERN[row.pitch] ?? []) {
            notes.push({
                id: `beat-${row.pitch}-${step}`,
                tick: step * BEAT_STEP_TICKS,
                durTick: Math.round(BEAT_STEP_TICKS * 0.5),
                pitch: row.pitch,
                vel: row.velocity,
            });
        }
    }
    return notes;
}

/**
 * Build the beat rig's arrangement. Its `graph` is the arrangement's OWN routing
 * substrate (the timeline lowers through `conduct`, not through the canvas
 * graph) — a drum voice into a speaker, matching the canvas rig's kit exactly.
 */
export function buildBeatSong(tempoBpm = 96): Arrangement {
    const source: MidiSource = {
        id: BEAT_SOURCE_ID,
        kind: 'midi',
        name: 'Groove',
        notes: grooveNotes(),
        lengthTick: BEAT_BAR_TICKS,
    };

    return normalizeArrangement({
        name: 'Beat rig',
        tempoBpm,
        ppq: PPQ,
        timeSignature: [4, 4],
        sources: { [BEAT_SOURCE_ID]: source },
        // A loop location so the pill's Loop toggle has something to loop over
        // and the groove runs until the player stops it.
        locations: [
            { id: 'beat-rig-loop', name: 'Loop', kind: 'loop', startTick: 0, endTick: BEAT_BAR_TICKS },
        ],
        graph: {
            nodes: [
                { ref: 'kit', type: 'instrument', data: { instrumentId: 'gm-synth-drum' } },
                { ref: 'spk', type: 'speaker' },
            ],
            connections: [{ from: 'kit', to: 'spk' }],
        },
        tracks: [
            {
                id: BEAT_TRACK_ID,
                ref: 'kit',
                name: 'Kit',
                clips: [
                    {
                        id: BEAT_CLIP_ID,
                        sourceId: BEAT_SOURCE_ID,
                        startTick: 0,
                        lengthTick: BEAT_BAR_TICKS,
                        name: 'Groove',
                    },
                ],
            },
        ],
    });
}
