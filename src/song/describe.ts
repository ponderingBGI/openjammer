// src/song/describe.ts — render an Arrangement as a compact, readable summary an
// AGENT (and a human) reads to GROUND itself before editing (agents.md: "Ground every
// plan in what is already on the canvas before you add anything"). It is the read half
// of the agent's timeline surface — the reversible verbs are the write half — and it
// names entities by their stable id + musical bar.beat (never raw ticks), so the
// summary the agent reads and the verbs it emits speak the same coordinates. Pure.

import { midiToNote } from '../music/note';
import { arrangementLengthTicks, formatBarBeat, timebase, type Timebase } from './time';
import type { Arrangement, ArrangementTrack } from './types';

/** Pitch + tick span of a track's notes (absolute ticks), or null when it has none. */
function trackExtent(track: ArrangementTrack): { lo: number; hi: number; first: number; last: number; count: number } | null {
    let lo = Infinity;
    let hi = -Infinity;
    let first = Infinity;
    let last = 0;
    let count = 0;
    for (const clip of track.clips) {
        for (const n of clip.notes) {
            count++;
            lo = Math.min(lo, n.pitch);
            hi = Math.max(hi, n.pitch);
            const onset = clip.startTick + n.tick;
            first = Math.min(first, onset);
            last = Math.max(last, onset + Math.max(1, n.durTick));
        }
    }
    return count === 0 ? null : { lo, hi, first, last, count };
}

function describeTrack(tb: Timebase, track: ArrangementTrack, index: number): string {
    const head = `  ${index + 1}. "${track.name ?? track.ref}" (id ${track.id}, ref ${track.ref})${track.mute ? ' — MUTED' : ''}`;
    const ext = trackExtent(track);
    const clipWord = track.clips.length === 1 ? 'clip' : 'clips';
    const body = ext
        ? `${track.clips.length} ${clipWord}, ${ext.count} notes, ` +
          `${midiToNote(ext.lo)}–${midiToNote(ext.hi)}, ` +
          `bars ${formatBarBeat(tb, ext.first)}–${formatBarBeat(tb, ext.last)}`
        : `${track.clips.length} ${clipWord}, empty`;
    const clips = track.clips
        .map((c) => `      • clip ${c.id} at ${formatBarBeat(tb, c.startTick)} (${c.notes.length} notes)`)
        .join('\n');
    const automation = (track.automation ?? [])
        .map((l) => `      ~ automation ${l.id}: ref ${l.ref} param ${l.param} (${l.points.length} points)`)
        .join('\n');
    return [head, `      ${body}`, clips, automation].filter((s) => s.length > 0).join('\n');
}

/**
 * A multi-line summary: title + tempo/meter/length, sections at bar.beat, then each
 * track with its ids, note count, pitch range, bar span, clips, and automation. The
 * ids are exactly the ones the reversible verbs target, so an agent can read this and
 * immediately author against it.
 */
export function describeArrangement(arr: Arrangement): string {
    const tb = timebase(arr);
    const [bpb, unit] = arr.timeSignature ?? [4, 4];
    const bars = Math.round(arrangementLengthTicks(arr) / tb.ticksPerBar);
    const lines: string[] = [];
    lines.push(`"${arr.name}" — ${arr.tempoBpm} BPM, ${bpb}/${unit}, ${bars} bars`);

    const sections = arr.sections ?? [];
    if (sections.length > 0) {
        lines.push(
            'Sections: ' +
                sections.map((s) => `${s.name} (${formatBarBeat(tb, (s.startBar - 1) * tb.ticksPerBar)})`).join(', '),
        );
    }

    if (arr.tracks.length === 0) {
        lines.push('No tracks yet — an empty page.');
    } else {
        lines.push('Tracks:');
        arr.tracks.forEach((t, i) => lines.push(describeTrack(tb, t, i)));
    }

    return lines.join('\n');
}
