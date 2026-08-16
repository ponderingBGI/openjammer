import type { CaptureResult, CapturedNote } from '@openjammer/oj-protocol';
import type { LiveNoteEvent } from '../audio/executor/timelinePlayback';
import type { Arrangement, ArrangementNote, ArrangementTrack } from './types';
import type { Verb } from './verbs';

export interface RecordTrackBinding {
    trackId: string;
    ref: string;
    node: number;
    kind: 'audio' | 'midi';
    inputLabel: string;
}

export interface RecordSpan { startTick: number; endTick: number }

export function wasmTapToCapturedNote(event: LiveNoteEvent, blockTick: number): CapturedNote {
    return { node: event.node, note: event.note, velocity: event.velocity, on: event.on, tick: Math.round(blockTick) };
}

export function punchRecordState(enabled: boolean, range: { startTick: number; endTick?: number } | undefined, tick: number): 'off' | 'inside' | 'outside' {
    if (!enabled || !range?.endTick) return 'off';
    return tick >= range.startTick && tick < range.endTick ? 'inside' : 'outside';
}

export interface RecordMint {
    (prefix: string): string;
}

export function trackRecordKind(arrangement: Arrangement, track: ArrangementTrack): 'audio' | 'midi' {
    return arrangement.graph.nodes.find((node) => node.ref === track.ref)?.type === 'microphone' ? 'audio' : 'midi';
}

export function trackRecordInput(arrangement: Arrangement, track: ArrangementTrack): string {
    const node = arrangement.graph.nodes.find((item) => item.ref === track.ref);
    if (node?.type !== 'microphone') return 'MIDI';
    const device = node.data?.deviceId;
    return typeof device === 'string' && device !== 'default' ? device : 'Default input';
}

export function recordBindings(
    arrangement: Arrangement,
    armedTrackIds: readonly string[],
    trackIndex: Readonly<Record<string, number>>,
): RecordTrackBinding[] {
    const armed = new Set(armedTrackIds);
    return arrangement.tracks.flatMap((track) => {
        const trackId = track.id ?? track.ref;
        const node = trackIndex[track.ref];
        if (!armed.has(trackId) || node === undefined) return [];
        return [{ trackId, ref: track.ref, node, kind: trackRecordKind(arrangement, track), inputLabel: trackRecordInput(arrangement, track) }];
    });
}

/** Pair note marks in exact engine ticks. A repeated note-on closes the previous
 * voice at the new onset: the record flow's truncate-existing default. */
export function pairCapturedNotes(events: readonly CapturedNote[], span: RecordSpan, mint: RecordMint): ArrangementNote[] {
    const active = new Map<number, { tick: number; velocity: number }>();
    const notes: ArrangementNote[] = [];
    const close = (pitch: number, endTick: number) => {
        const start = active.get(pitch);
        if (!start) return;
        const from = Math.max(span.startTick, start.tick);
        const to = Math.min(span.endTick, endTick);
        if (to > from) notes.push({ id: mint('note'), tick: from - span.startTick, durTick: to - from, pitch, vel: start.velocity });
        active.delete(pitch);
    };
    for (const event of [...events].sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on))) {
        if (event.tick < span.startTick || event.tick > span.endTick) continue;
        if (event.on) {
            close(event.note, event.tick);
            active.set(event.note, { tick: event.tick, velocity: event.velocity });
        } else close(event.note, event.tick);
    }
    for (const pitch of active.keys()) close(pitch, span.endTick);
    return notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

function nextLayer(track: ArrangementTrack, startTick: number, endTick: number): number {
    return track.clips.reduce((max, clip) => {
        const overlaps = clip.startTick < endTick && startTick < clip.startTick + clip.lengthTick;
        return overlaps ? Math.max(max, clip.layerIndex ?? 0) : max;
    }, -1) + 1;
}

export function captureResultToVerbs(args: {
    arrangement: Arrangement;
    result: CaptureResult;
    bindings: readonly RecordTrackBinding[];
    span: RecordSpan;
    mint: RecordMint;
}): Verb[] {
    const { arrangement, result, bindings, span, mint } = args;
    const verbs: Verb[] = [];
    const byNode = new Map(bindings.map((binding) => [binding.node, binding]));

    for (const binding of bindings.filter((item) => item.kind === 'midi')) {
        const events = result.notes.filter((note) => note.node === binding.node);
        const notes = pairCapturedNotes(events, span, mint);
        if (notes.length === 0) continue;
        const sourceId = mint('src:midi');
        verbs.push({ kind: 'addSource', source: { id: sourceId, kind: 'midi', name: `Take ${result.take_id}`, notes, lengthTick: span.endTick - span.startTick } });
        verbs.push({ kind: 'addClip', trackId: binding.trackId, clip: { id: mint('clip'), sourceId, startTick: span.startTick, lengthTick: span.endTick - span.startTick, name: `Take ${result.take_id}` } });
    }

    for (const segment of [...result.segments].sort((a, b) => a.loop_index - b.loop_index || a.start_tick - b.start_tick)) {
        const binding = byNode.get(segment.node);
        if (!binding || binding.kind !== 'audio' || segment.length_ticks <= 0 || segment.frames <= 0) continue;
        const assetId = Math.max(0, segment.asset).toString(16);
        const sourceId = `src:audio:${assetId}`;
        if (!arrangement.sources?.[sourceId] && !verbs.some((verb) => verb.kind === 'addSource' && verb.source.id === sourceId)) {
            verbs.push({ kind: 'addSource', source: { id: sourceId, kind: 'audio', name: `Take ${result.take_id}`, assetId, frames: segment.frames, sampleRate: arrangement.sampleRate ?? 48_000, channels: 1 } });
        }
        const track = arrangement.tracks.find((item) => (item.id ?? item.ref) === binding.trackId)!;
        verbs.push({ kind: 'addClip', trackId: binding.trackId, clip: {
            id: mint('clip'), sourceId, startTick: segment.start_tick, lengthTick: segment.length_ticks,
            domain: 'samples', layerIndex: nextLayer(track, segment.start_tick, segment.start_tick + segment.length_ticks) + segment.loop_index,
            name: `Take ${result.take_id}${segment.loop_index > 0 ? ` · pass ${segment.loop_index + 1}` : ''}`,
        } });
    }
    return verbs;
}
