// src/song/time.ts — the ONE place tick⇄bar/beat/seconds arithmetic lives. The GUI
// ruler, the Playhead, the agent's `describe_arrangement`, and a future bar.beat
// input all read from here, so a human and an agent always speak the same musical
// time (labels + bars.beats, never raw ticks). Pure: no engine, no clock — `conduct`
// owns the lowering to the render schedule; this is the authoring/display layer.

import type { Arrangement } from './types';
import { PPQ } from '@openjammer/oj-protocol';
import {
    buildTempoMap,
    secondsToTick as mapSecondsToTick,
    tickToSeconds as mapTickToSeconds,
} from './tempoMap';

/** Resolved timing constants for an arrangement (defaults applied). */
export interface Timebase {
    ppq: number;
    beatsPerBar: number;
    /** Ticks in one beat (a quarter = ppq in x/4; an eighth = ppq/2 in x/8). */
    ticksPerBeat: number;
    /** Ticks in one bar. */
    ticksPerBar: number;
    tempoBpm: number;
}

export { PPQ as DEFAULT_PPQ };
export const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

/** Resolve an arrangement's timebase (PPQ + time signature → ticks per beat/bar). */
export function timebase(arr: Pick<Arrangement, 'ppq' | 'timeSignature' | 'tempoBpm'>): Timebase {
    const ppq = arr.ppq ?? PPQ;
    const [beatsPerBar, beatUnit] = arr.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    // PPQ counts quarter notes; a beat of 1/beatUnit is (4/beatUnit) quarter notes.
    const ticksPerBeat = Math.round((ppq * 4) / beatUnit);
    return { ppq, beatsPerBar, ticksPerBeat, ticksPerBar: ticksPerBeat * beatsPerBar, tempoBpm: arr.tempoBpm };
}

/** Seconds per tick at the arrangement's tempo (the same constant `conduct` uses). */
export function secondsPerTick(arr: Pick<Arrangement, 'ppq' | 'tempoBpm'>): number {
    return mapTickToSeconds(buildTempoMap(arr), 1);
}

/** Convert a tick to seconds at the arrangement's tempo. */
export function tickToSeconds(arr: Pick<Arrangement, 'ppq' | 'tempoBpm'>, tick: number): number {
    return mapTickToSeconds(buildTempoMap(arr), tick);
}

/** Convert seconds to a (possibly fractional) tick at the arrangement's tempo. */
export function secondsToTick(arr: Pick<Arrangement, 'ppq' | 'tempoBpm'>, seconds: number): number {
    return mapSecondsToTick(buildTempoMap(arr), seconds);
}

/** A musical position: 1-based bar and beat plus the leftover ticks inside the beat. */
export interface BarBeat {
    bar: number;
    beat: number;
    tickInBeat: number;
}

/** Decompose an absolute tick into 1-based bar/beat + remainder. */
export function tickToBarBeat(tb: Timebase, tick: number): BarBeat {
    const t = Math.max(0, Math.floor(tick));
    const bar = Math.floor(t / tb.ticksPerBar) + 1;
    const inBar = t % tb.ticksPerBar;
    const beat = Math.floor(inBar / tb.ticksPerBeat) + 1;
    const tickInBeat = inBar % tb.ticksPerBeat;
    return { bar, beat, tickInBeat };
}

/** The absolute tick at the start of a 1-based bar. */
export function barToTick(tb: Timebase, bar: number): number {
    return (Math.max(1, Math.floor(bar)) - 1) * tb.ticksPerBar;
}

/**
 * Human/agent-facing label for a tick: `"bar.beat"` (e.g. `"3.2"`), extended to
 * `"bar.beat.tick"` only when the position is mid-beat — never a raw tick count, so
 * a player and the agent read the same musical coordinate.
 */
export function formatBarBeat(tb: Timebase, tick: number): string {
    const { bar, beat, tickInBeat } = tickToBarBeat(tb, tick);
    return tickInBeat === 0 ? `${bar}.${beat}` : `${bar}.${beat}.${tickInBeat}`;
}

/** Total length of the arrangement in ticks (last clip/automation end), >= one bar. */
export function arrangementLengthTicks(arr: Arrangement): number {
    let last = 0;
    for (const track of arr.tracks) {
        for (const clip of track.clips) {
            for (const n of clip.notes) {
                last = Math.max(last, clip.startTick + n.tick + Math.max(1, n.durTick));
            }
        }
        for (const lane of track.automation ?? []) {
            for (const p of lane.points) last = Math.max(last, p.tick);
        }
    }
    const tb = timebase(arr);
    // Round up to a whole bar so the ruler always ends on a bar line, min one bar.
    return Math.max(tb.ticksPerBar, Math.ceil(last / tb.ticksPerBar) * tb.ticksPerBar);
}
