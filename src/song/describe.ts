// src/song/describe.ts — render an Arrangement as a compact, readable summary an
// AGENT (and a human) reads to GROUND itself before editing (agents.md: "Ground every
// plan in what is already on the canvas before you add anything"). It is the read half
// of the agent's timeline surface — the reversible verbs are the write half — and it
// names entities by their stable id + musical bar.beat (never raw ticks), so the
// summary the agent reads and the verbs it emits speak the same coordinates. Pure.

import { midiToNote } from '../music/note';
import { arrangementLengthTicks, formatBarBeat, timebase, type Timebase } from './time';
import type { Arrangement, ArrangementNote, ArrangementTrack } from './types';

function clipNotes(arr: Arrangement, sourceId: string): ArrangementNote[] {
    const source = arr.sources?.[sourceId];
    return source?.kind === 'midi' ? source.notes : [];
}

/** Keep the grounding summary bounded even for generated/dense MIDI clips. */
export const DESCRIBE_NOTE_CAP = 24;

function visibleClipNotes(arr: Arrangement, sourceId: string, sourceStart: number, lengthTick: number): ArrangementNote[] {
    const sourceEnd = sourceStart + lengthTick;
    return clipNotes(arr, sourceId).filter((note) => {
        const noteEnd = note.tick + Math.max(1, note.durTick);
        return noteEnd > sourceStart && note.tick < sourceEnd;
    });
}

function describeClipNotes(notes: ArrangementNote[]): string {
    if (notes.length === 0) return '';
    const shown = notes.slice(0, DESCRIBE_NOTE_CAP).map((note) =>
        `{id ${note.id ?? '(unassigned)'}, pitch ${note.pitch}, tick ${note.tick}, durTick ${note.durTick}, vel ${note.vel ?? 64}}`,
    );
    const omitted = notes.length - shown.length;
    return `\n        notes (first ${shown.length} of ${notes.length}): ${shown.join('; ')}${omitted > 0 ? `; +${omitted} more` : ''}`;
}

/** Pitch + tick span of a track's notes (absolute ticks), or null when it has none. */
function trackExtent(arr: Arrangement, track: ArrangementTrack): { lo: number; hi: number; first: number; last: number; count: number } | null {
    let lo = Infinity;
    let hi = -Infinity;
    let first = Infinity;
    let last = 0;
    let count = 0;
    for (const clip of track.clips) {
        const sourceStart = clip.sourceStart ?? 0;
        for (const n of clipNotes(arr, clip.sourceId)) {
            const noteEnd = n.tick + Math.max(1, n.durTick);
            if (noteEnd <= sourceStart || n.tick >= sourceStart + clip.lengthTick) continue;
            count++;
            lo = Math.min(lo, n.pitch);
            hi = Math.max(hi, n.pitch);
            const onset = clip.startTick + Math.max(0, n.tick - sourceStart);
            first = Math.min(first, onset);
            last = Math.max(last, clip.startTick + Math.min(clip.lengthTick, noteEnd - sourceStart));
        }
    }
    return count === 0 ? null : { lo, hi, first, last, count };
}

function describeTrack(arr: Arrangement, tb: Timebase, track: ArrangementTrack, index: number): string {
    const head = `  ${index + 1}. "${track.name ?? track.ref}" (id ${track.id}, ref ${track.ref})${track.mute ? ' — MUTED' : ''}`;
    const ext = trackExtent(arr, track);
    const clipWord = track.clips.length === 1 ? 'clip' : 'clips';
    const body = ext
        ? `${track.clips.length} ${clipWord}, ${ext.count} notes, ` +
          `${midiToNote(ext.lo)}–${midiToNote(ext.hi)}, ` +
          `bars ${formatBarBeat(tb, ext.first)}–${formatBarBeat(tb, ext.last)}`
        : `${track.clips.length} ${clipWord}, empty`;
    const clips = track.clips
        .map((c) => {
            const notes = visibleClipNotes(arr, c.sourceId, c.sourceStart ?? 0, c.lengthTick);
            const gain = c.gain === undefined ? '' : `, gain ${c.gain}`;
            const fades = c.fadeIn || c.fadeOut ? `, fades ${c.fadeIn?.lengthTick ?? 0}/${c.fadeOut?.lengthTick ?? 0}` : '';
            return `      • clip ${c.id} at ${formatBarBeat(tb, c.startTick)}, length ${c.lengthTick}, source ${c.sourceId} (${notes.length} notes${gain}${fades})${describeClipNotes(notes)}`;
        })
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
    lines.push(`"${arr.name}" — ${arr.tempoBpm} BPM, ${bpb}/${unit}, ${bars} bars (ppq ${tb.ppq}, ticksPerBar ${tb.ticksPerBar})`);

    const sections = (arr.locations ?? []).filter((location) => location.kind === 'section');
    if (sections.length > 0) {
        lines.push(
            'Sections: ' +
                sections.map((s) => `${s.name} (${formatBarBeat(tb, s.startTick)})`).join(', '),
        );
    }
    const otherLocations = (arr.locations ?? []).filter((location) => location.kind !== 'section');
    if (otherLocations.length > 0) lines.push('Locations: ' + otherLocations.map((location) => `${location.kind} ${location.name} (${formatBarBeat(tb, location.startTick)}${location.endTick === undefined ? '' : `–${formatBarBeat(tb, location.endTick)}`})`).join(', '));

    if (arr.tracks.length === 0) {
        lines.push('No tracks yet — an empty page.');
    } else {
        lines.push('Tracks:');
        arr.tracks.forEach((t, i) => lines.push(describeTrack(arr, tb, t, i)));
    }

    return lines.join('\n');
}
