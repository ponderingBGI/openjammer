import type { Arrangement, ArrangementClip, ArrangementNote, AutomationPoint, MidiSource } from './types';
import type { Verb } from './verbs';
import { descriptorForLane, evaluateAutomation, thinAutomationPoints } from './automation';
import type { CutBuffer } from '../store/clipboardStore';

export interface OpResult { verbs: Verb[]; selectedClipIds?: string[]; selectedNoteIds?: string[]; skipped?: string[]; rejected?: string }

export const EDIT_OPS = [
    'moveClips', 'trimClip', 'splitAt', 'duplicateClips', 'deleteClips', 'setGrid', 'nudge', 'deleteTime', 'insertTime',
    'cutSelection', 'copySelection', 'paste', 'pasteRepeat', 'selectRange', 'deleteRange', 'slipClip', 'splitRange', 'duplicateRange',
    'drawNote', 'moveNotes', 'copyNotes', 'resizeNotes', 'eraseNotes', 'setVelocity', 'transposeNotes', 'quantizeNotes',
    'setAutomationPoints', 'moveAutomationPoints', 'setAutomationRange', 'thinAutomation',
    'setTrackGain', 'setTrackPan', 'addAutomationPoint', 'addAutomationPoints', 'setLaneState',
] as const;
export type EditOpName = typeof EDIT_OPS[number];
export type TimelineOp =
    | { op: 'moveClips'; clipIds: string[]; deltaTick: number; toTrackId?: string; ripple?: boolean }
    | { op: 'trimClip'; clipIds: string[]; edge: 'start' | 'end'; atTick: number }
    | { op: 'splitAt'; clipIds: string[]; atTick: number }
    | { op: 'duplicateClips'; clipIds: string[]; deltaTick: number }
    | { op: 'deleteClips'; clipIds: string[]; ripple?: boolean }
    | { op: 'setGrid'; grid: string }
    | { op: 'nudge'; clipIds: string[]; amount: number; direction: -1 | 1 }
    | { op: 'deleteTime'; fromTick: number; toTick: number; trackIds: string[] }
    | { op: 'insertTime'; atTick: number; durationTick: number; trackIds: string[] }
    | { op: 'cutSelection' }
    | { op: 'copySelection' }
    | { op: 'paste'; atTick?: number; times?: number; toTrackIds?: string[] }
    | { op: 'pasteRepeat'; times?: number }
    | { op: 'selectRange'; fromTick: number; toTick: number; trackIds: string[] }
    | { op: 'deleteRange'; fromTick: number; toTick: number; trackIds: string[] }
    | { op: 'slipClip'; clipIds: string[]; deltaTick: number }
    | { op: 'splitRange'; fromTick: number; toTick: number; trackIds: string[] }
    | { op: 'duplicateRange'; fromTick: number; toTick: number; trackIds: string[] }
    | { op: 'drawNote'; clipId: string; note: NoteInput; overlap?: NoteOverlapPolicy }
    | { op: 'moveNotes'; noteIds: string[]; deltaTick?: number; deltaPitch?: number }
    | { op: 'copyNotes'; noteIds: string[]; deltaTick?: number; deltaPitch?: number }
    | { op: 'resizeNotes'; noteIds: string[]; edge: 'start' | 'end'; deltaTick?: number; at?: number; mode?: 'relative' | 'absolute' }
    | { op: 'eraseNotes'; noteIds?: string[]; range?: NoteRange }
    | { op: 'setVelocity'; noteIds: string[]; mode: 'delta' | 'set' | 'ramp'; amount?: number; from?: number; to?: number; smush?: boolean }
    | { op: 'transposeNotes'; noteIds: string[]; semitones: number }
    | { op: 'quantizeNotes'; targets: string[]; grid: number; endGrid?: number; snapStart?: boolean; snapEnd?: boolean; strength?: number; swing?: number; threshold?: number; position?: number }
    | { op: 'setAutomationPoints'; laneId: string; points: AutomationPoint[] }
    | { op: 'moveAutomationPoints'; laneId: string; ticks: number[]; deltaTick?: number; deltaValue?: number; push?: boolean }
    | { op: 'setAutomationRange'; laneId: string; fromTick: number; toTick: number; points: AutomationPoint[]; factor?: number }
    | { op: 'thinAutomation'; laneId: string; factor?: number }
    | { op: 'setTrackGain'; trackId: string; gainDb: number }
    | { op: 'setTrackPan'; trackId: string; pan: number }
    | { op: 'addAutomationPoint'; laneId: string; point: AutomationPoint }
    | { op: 'addAutomationPoints'; laneId: string; points: AutomationPoint[] }
    | { op: 'setLaneState'; laneId: string; state: 'Off' | 'Play' };

export interface NoteInput { tick: number; durTick: number; pitch: number; vel?: number; id?: string }
export type NoteOverlapPolicy = 'relax' | 'reject' | 'replace' | 'truncate-existing' | 'truncate-addition' | 'extend';
export interface NoteRange { fromTick: number; toTick: number; minPitch?: number; maxPitch?: number; sourceId?: string }

interface LocatedNote { sourceId: string; source: MidiSource; note: ArrangementNote; index: number }

function findNote(arrangement: Arrangement, noteId: string): LocatedNote | undefined {
    for (const [sourceId, source] of Object.entries(arrangement.sources ?? {})) {
        if (source.kind !== 'midi') continue;
        const index = source.notes.findIndex((note) => note.id === noteId);
        if (index >= 0) return { sourceId, source, note: source.notes[index]!, index };
    }
    return undefined;
}

function sourceForClip(arrangement: Arrangement, clipId: string): { clip: ArrangementClip; source: MidiSource } | undefined {
    const found = findClip(arrangement, clipId);
    if (!found) return undefined;
    const source = arrangement.sources?.[found.clip.sourceId];
    return source?.kind === 'midi' ? { clip: found.clip, source } : undefined;
}

const overlaps = (a: Pick<ArrangementNote, 'tick' | 'durTick'>, b: Pick<ArrangementNote, 'tick' | 'durTick'>) =>
    a.tick < b.tick + b.durTick && b.tick < a.tick + a.durTick;

/** BC-30 rule B: the pointer gesture floor; not a model validation rule. */
export const noteDragFloor = (ppq: number) => Math.max(1, Math.ceil(ppq / 128));

function validNote(note: NoteInput): string | undefined {
    if (!Number.isFinite(note.tick) || note.tick < 0) return 'note tick must be zero or greater';
    if (!Number.isFinite(note.durTick) || note.durTick < 1) return 'note duration must be at least one tick';
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return 'note pitch must be an integer from 0 to 127';
    if (note.vel !== undefined && (!Number.isInteger(note.vel) || note.vel < 0 || note.vel > 127)) return 'note velocity must be an integer from 0 to 127';
    return undefined;
}

const findClip = (arrangement: Arrangement, clipId: string) => {
    for (const track of arrangement.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) return { clip, track };
    }
    return undefined;
};

/** BC-19: move source contents beneath an unchanged timeline window. */
export function slipClips(arrangement: Arrangement, clipIds: readonly string[], deltaTick: number): OpResult {
    const verbs: Verb[] = [];
    const skipped: string[] = [];
    for (const id of clipIds) {
        const found = findClip(arrangement, id);
        if (!found || found.clip.locked) { skipped.push(id); continue; }
        verbs.push({ kind: 'setClipWindow', clipId: id, sourceStart: Math.max(0, (found.clip.sourceStart ?? 0) + deltaTick) });
    }
    return { verbs, skipped };
}

/** BC-25 range delete: remove only the selected spans, preserving both outside pieces. */
export function deleteRange(arrangement: Arrangement, fromTick: number, toTick: number, trackIds: readonly string[], mint: (prefix: string) => string): OpResult {
    const from = Math.max(0, Math.min(fromTick, toTick));
    const to = Math.max(from, Math.max(fromTick, toTick));
    if (to <= from) return { verbs: [] };
    const scope = new Set(trackIds);
    const verbs: Verb[] = [];
    for (const track of arrangement.tracks) {
        const trackId = track.id ?? track.ref;
        if (!scope.has(trackId)) continue;
        for (const clip of track.clips) {
            if (!clip.id) continue;
            const end = clip.startTick + clip.lengthTick;
            if (end <= from || clip.startTick >= to) continue;
            verbs.push({ kind: 'removeClip', clipId: clip.id });
            if (clip.startTick < from) verbs.push({ kind: 'addClip', trackId, clip: { ...clip, id: mint('clip'), lengthTick: from - clip.startTick } });
            if (end > to) verbs.push({ kind: 'addClip', trackId, clip: { ...clip, id: mint('clip'), startTick: to, lengthTick: end - to, sourceStart: (clip.sourceStart ?? 0) + (to - clip.startTick) } });
        }
        for (const lane of track.automation ?? []) if (lane.id) for (const point of lane.points) if (point.tick >= from && point.tick < to) verbs.push({ kind: 'removeAutomationPoint', laneId: lane.id, tick: point.tick });
    }
    return { verbs };
}

/** BC-20: partition clips at both range edges without removing the middle. */
export function splitRange(arrangement: Arrangement, fromTick: number, toTick: number, trackIds: readonly string[], mint: (prefix: string) => string): OpResult {
    const from = Math.max(0, Math.min(fromTick, toTick));
    const to = Math.max(from, Math.max(fromTick, toTick));
    const scope = new Set(trackIds);
    const verbs: Verb[] = [];
    const selectedClipIds: string[] = [];
    for (const track of arrangement.tracks) {
        const trackId = track.id ?? track.ref;
        if (!scope.has(trackId)) continue;
        for (const clip of track.clips) {
            if (!clip.id) continue;
            const end = clip.startTick + clip.lengthTick;
            const edges = [from, to].filter((edge) => edge > clip.startTick && edge < end);
            if (!edges.length) continue;
            verbs.push({ kind: 'removeClip', clipId: clip.id });
            const boundaries = [clip.startTick, ...edges, end];
            for (let index = 0; index < boundaries.length - 1; index++) {
                const startTick = boundaries[index]!;
                const id = mint('clip');
                verbs.push({ kind: 'addClip', trackId, clip: { ...clip, id, startTick, lengthTick: boundaries[index + 1]! - startTick, sourceStart: (clip.sourceStart ?? 0) + startTick - clip.startTick } });
                selectedClipIds.push(id);
            }
        }
    }
    return { verbs, selectedClipIds };
}

export interface PasteOptions {
    atTick: number;
    targetTrackIds: readonly string[];
    focusedClipId?: string | null;
    times?: number;
    repeatOffset?: number;
    spacingTick?: number;
    consume?: 'all' | 'clips' | 'notes';
    mint: (prefix: string) => string;
}

/** BC-28/29: typed, per-destination clipboard consumption with uniform iteration spacing. */
export function pasteCutBuffer(arrangement: Arrangement, buffer: CutBuffer, options: PasteOptions): OpResult {
    const times = Math.max(1, Math.floor(options.times ?? 1));
    const repeatOffset = options.repeatOffset ?? 0;
    const duration = Math.max(1, options.spacingTick ?? buffer.durationTick);
    const consume = options.consume ?? 'all';
    const verbs: Verb[] = [];
    const selectedClipIds: string[] = [];
    const selectedNoteIds: string[] = [];
    const targets = options.targetTrackIds.map((id) => arrangement.tracks.find((track) => (track.id ?? track.ref) === id)).filter((track): track is NonNullable<typeof track> => Boolean(track));

    if (consume !== 'clips' && options.focusedClipId) {
        const focused = findClip(arrangement, options.focusedClipId);
        const source = focused && arrangement.sources?.[focused.clip.sourceId];
        if (focused && source?.kind === 'midi') {
            const focusedTrackId = focused.track.id ?? focused.track.ref;
            const notes = buffer.buckets.filter((bucket) => bucket.sourceTrackId === focusedTrackId).flatMap((bucket) => bucket.notes);
            for (let iteration = 0; iteration < times; iteration++) for (const note of notes) {
                const id = options.mint('note');
                const tick = options.atTick + repeatOffset + iteration * duration + note.offsetTick - focused.clip.startTick + (focused.clip.sourceStart ?? 0);
                if (tick < 0) continue;
                verbs.push({ kind: 'addNote', sourceId: source.id, index: source.notes.length + selectedNoteIds.length, note: { id, tick, durTick: note.durTick, pitch: note.pitch, vel: note.vel } });
                selectedNoteIds.push(id);
            }
        }
        if (consume === 'notes') return { verbs, selectedNoteIds };
    }

    const clipBuckets = buffer.buckets.filter((bucket) => bucket.clips.length);
    const automationBuckets = buffer.buckets.filter((bucket) => bucket.automationPoints.length);
    let clipIndex = 0;
    let automationIndex = 0;
    targets.forEach((target) => {
        const trackId = target.id ?? target.ref;
        const clipBucket = clipBuckets[clipIndex];
        if (consume !== 'notes' && clipBucket) for (let iteration = 0; iteration < times; iteration++) for (const item of clipBucket.clips) {
            const id = options.mint('clip');
            const { offsetTick, ...clip } = item;
            verbs.push({ kind: 'addClip', trackId, clip: { ...structuredClone(clip), id, startTick: options.atTick + repeatOffset + iteration * duration + offsetTick } });
            selectedClipIds.push(id);
        }
        if (clipBucket && consume !== 'notes') clipIndex++;
        if (consume === 'clips') return;
        const lanes = target.automation ?? [];
        const automationBucket = lanes.length ? automationBuckets[automationIndex] : undefined;
        automationBucket?.automationPoints.forEach((point, pointIndex) => {
            const lane = lanes[pointIndex] ?? lanes[0];
            if (!lane?.id) return;
            for (let iteration = 0; iteration < times; iteration++) verbs.push({ kind: 'setAutomationPoint', laneId: lane.id, point: { tick: options.atTick + repeatOffset + iteration * duration + point.offsetTick, value: point.value } });
        });
        if (automationBucket) automationIndex++;
    });
    return { verbs, selectedClipIds, selectedNoteIds };
}

export function moveClips(arrangement: Arrangement, clipIds: readonly string[], deltaTick: number, options: { toTrackId?: string; ripple?: boolean } = {}): OpResult {
    const found = clipIds.map((id) => findClip(arrangement, id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const movable = found.filter(({ clip }) => !clip.locked);
    if (!movable.length) return { verbs: [], skipped: [...clipIds] };
    const clampedDelta = Math.max(deltaTick, -Math.min(...movable.map(({ clip }) => clip.startTick)));
    const primarySourceIndex = arrangement.tracks.findIndex((track) => track.clips.some((clip) => clip.id === clipIds[0]));
    const primaryTargetIndex = options.toTrackId ? arrangement.tracks.findIndex((track) => track.id === options.toTrackId) : primarySourceIndex;
    const trackDelta = primaryTargetIndex >= 0 && primarySourceIndex >= 0 ? primaryTargetIndex - primarySourceIndex : 0;
    const verbs: Verb[] = movable.map(({ clip, track }) => {
        const sourceIndex = arrangement.tracks.indexOf(track);
        const destination = arrangement.tracks[Math.max(0, Math.min(arrangement.tracks.length - 1, sourceIndex + trackDelta))];
        return { kind: 'moveClip', clipId: clip.id!, startTick: clip.startTick + clampedDelta, trackId: destination?.id };
    });
    if (options.ripple && !options.toTrackId && clampedDelta !== 0) {
        const moving = new Set(movable.map(({ clip }) => clip.id));
        const trackIds = [...new Set(movable.map(({ track }) => track.id!))];
        const threshold = Math.min(...movable.map(({ clip }) => clip.startTick));
        for (const track of arrangement.tracks) {
            if (!trackIds.includes(track.id!)) continue;
            for (const clip of track.clips) if (!moving.has(clip.id) && clip.startTick >= threshold) verbs.push({ kind: 'moveClip', clipId: clip.id!, startTick: Math.max(0, clip.startTick + clampedDelta) });
        }
    }
    return { verbs, skipped: found.filter(({ clip }) => clip.locked).map(({ clip }) => clip.id!) };
}

export function trimClip(arrangement: Arrangement, clipIds: readonly string[], edge: 'start' | 'end', atTick: number): OpResult {
    const verbs: Verb[] = [];
    const skipped: string[] = [];
    for (const id of clipIds) {
        const found = findClip(arrangement, id);
        if (!found || found.clip.locked) { skipped.push(id); continue; }
        const { clip } = found;
        if (edge === 'start') {
            const end = clip.startTick + clip.lengthTick;
            const startTick = Math.max(0, Math.min(end - 1, atTick));
            const delta = startTick - clip.startTick;
            const sourceStart = Math.max(0, (clip.sourceStart ?? 0) + delta);
            verbs.push({ kind: 'setClipWindow', clipId: id, startTick, lengthTick: end - startTick, sourceStart });
        } else {
            const source = arrangement.sources?.[clip.sourceId];
            const sourceLength = source?.kind === 'midi' ? source.lengthTick : Number.MAX_SAFE_INTEGER;
            const maxEnd = clip.startTick + Math.max(1, sourceLength - (clip.sourceStart ?? 0));
            const endTick = Math.min(maxEnd, Math.max(clip.startTick + 1, atTick));
            verbs.push({ kind: 'setClipWindow', clipId: id, lengthTick: endTick - clip.startTick });
        }
    }
    return { verbs, skipped };
}

export function splitAt(arrangement: Arrangement, clipIds: readonly string[], atTick: number, mintId: (prefix: string) => string): OpResult {
    const verbs: Verb[] = [];
    const selectedClipIds: string[] = [];
    for (const id of clipIds) {
        const found = findClip(arrangement, id);
        if (!found || found.clip.locked) continue;
        const { clip } = found;
        if (!(atTick > clip.startTick && atTick < clip.startTick + clip.lengthTick)) continue;
        const left: ArrangementClip = { ...clip, id: mintId('clip') };
        const right: ArrangementClip = { ...clip, id: mintId('clip') };
        verbs.push({ kind: 'splitClip', clipId: id, atTick, left, right });
        selectedClipIds.push(left.id!, right.id!);
    }
    return { verbs, selectedClipIds };
}

export function duplicateClips(arrangement: Arrangement, clipIds: readonly string[], deltaTick: number, mintId: (prefix: string) => string, toTrackId?: string): OpResult {
    const verbs: Verb[] = [];
    const selectedClipIds: string[] = [];
    const sourceTrackIndex = arrangement.tracks.findIndex((track) => track.clips.some((item) => item.id === clipIds[0]));
    const targetTrackIndex = toTrackId ? arrangement.tracks.findIndex((track) => track.id === toTrackId) : sourceTrackIndex;
    const trackDelta = targetTrackIndex - sourceTrackIndex;
    for (const id of clipIds) {
        const found = findClip(arrangement, id);
        if (!found) continue;
        const clip = structuredClone(found.clip);
        clip.id = mintId('clip');
        clip.startTick = Math.max(0, clip.startTick + deltaTick);
        const index = arrangement.tracks.indexOf(found.track);
        const destination = arrangement.tracks[Math.max(0, Math.min(arrangement.tracks.length - 1, index + trackDelta))] ?? found.track;
        verbs.push({ kind: 'addClip', trackId: destination.id!, clip });
        selectedClipIds.push(clip.id);
    }
    return { verbs, selectedClipIds };
}

export function deleteClips(arrangement: Arrangement, clipIds: readonly string[], ripple = false): OpResult {
    const found = clipIds.map((id) => findClip(arrangement, id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const verbs: Verb[] = found.map(({ clip }) => ({ kind: 'removeClip', clipId: clip.id! }));
    if (ripple && found.length) {
        const from = Math.min(...found.map(({ clip }) => clip.startTick));
        const to = Math.max(...found.map(({ clip }) => clip.startTick + clip.lengthTick));
        const deleted = new Set(clipIds);
        for (const { track } of found) for (const clip of track.clips) if (clip.id && !deleted.has(clip.id) && clip.startTick >= to) verbs.push({ kind: 'moveClip', clipId: clip.id, startTick: clip.startTick - (to - from) });
    }
    return { verbs };
}

export function nudge(arrangement: Arrangement, clipIds: readonly string[], amount: number, direction: -1 | 1): OpResult {
    return moveClips(arrangement, clipIds, amount * direction);
}

export const setGrid = (grid: string) => ({ grid });

export function deleteTime(_arrangement: Arrangement, fromTick: number, toTick: number, trackIds: readonly string[]): OpResult {
    if (!(toTick > fromTick)) return { verbs: [] };
    return { verbs: [{ kind: 'removeTime', atTick: fromTick, durationTick: toTick - fromTick, trackIds: [...trackIds], moveLocations: true }] };
}

export function insertTime(_arrangement: Arrangement, atTick: number, durationTick: number, trackIds: readonly string[]): OpResult {
    if (!(durationTick > 0)) return { verbs: [] };
    return { verbs: [{ kind: 'insertTime', atTick, durationTick, trackIds: [...trackIds], splitIntersected: true, moveLocations: true }] };
}

function automaticVelocity(notes: readonly ArrangementNote[], tick: number): number {
    if (!notes.length) return 64;
    const ordered = [...notes].sort((a, b) => a.tick - b.tick);
    const after = ordered.find((note) => note.tick >= tick);
    const before = [...ordered].reverse().find((note) => note.tick <= tick);
    if (!before) return after?.vel ?? 64;
    if (!after) return before.vel ?? 64;
    if (after.tick === before.tick) return before.vel ?? after.vel ?? 64;
    const mix = (tick - before.tick) / (after.tick - before.tick);
    return Math.round((before.vel ?? 64) + ((after.vel ?? 64) - (before.vel ?? 64)) * mix);
}

/** BC-30/34. Draw is one atomic batch, including overlap side effects. */
export function drawNotes(
    arrangement: Arrangement,
    clipId: string,
    inputs: readonly NoteInput[],
    mintId: (prefix: string) => string,
    overlapPolicy: NoteOverlapPolicy = 'truncate-existing',
): OpResult {
    const target = sourceForClip(arrangement, clipId);
    if (!target) return { verbs: [], rejected: `clip "${clipId}" is not a MIDI clip` };
    const invalid = inputs.map(validNote).find(Boolean);
    if (invalid) return { verbs: [], rejected: invalid };

    const working = target.source.notes.map((note) => ({ ...note }));
    const verbs: Verb[] = [];
    const selectedNoteIds: string[] = [];
    for (const value of inputs) {
        if (working.some((note) => note.tick === value.tick && note.pitch === value.pitch)) continue;
        let addition: ArrangementNote = { ...value, id: value.id ?? mintId('note'), vel: value.vel ?? automaticVelocity(working, value.tick) };
        let conflicts = working.filter((note) => note.pitch === addition.pitch && overlaps(note, addition));
        if (overlapPolicy === 'reject' && conflicts.length) return { verbs: [], rejected: 'note overlaps an existing note' };
        if (overlapPolicy === 'truncate-addition') {
            for (const note of conflicts.sort((a, b) => a.tick - b.tick)) {
                const end = addition.tick + addition.durTick;
                const noteEnd = note.tick + note.durTick;
                if (note.tick <= addition.tick) addition = { ...addition, tick: noteEnd, durTick: end - noteEnd };
                else addition = { ...addition, durTick: note.tick - addition.tick };
                if (addition.durTick < 1) break;
            }
            if (addition.durTick < 1) continue;
            conflicts = working.filter((note) => note.pitch === addition.pitch && overlaps(note, addition));
        }
        if (overlapPolicy === 'extend' && conflicts.length) {
            const keeper = conflicts[0]!;
            const start = Math.min(keeper.tick, addition.tick);
            const end = Math.max(addition.tick + addition.durTick, ...conflicts.map((note) => note.tick + note.durTick));
            const patch = { tick: start, durTick: end - start };
            verbs.push({ kind: 'editNote', noteId: keeper.id!, patch });
            Object.assign(keeper, patch);
            for (const conflict of conflicts.slice(1)) {
                verbs.push({ kind: 'removeNote', noteId: conflict.id! });
                working.splice(working.indexOf(conflict), 1);
            }
            selectedNoteIds.push(keeper.id!);
            continue;
        }
        if (overlapPolicy === 'replace') {
            for (const conflict of conflicts) {
                verbs.push({ kind: 'removeNote', noteId: conflict.id! });
                working.splice(working.indexOf(conflict), 1);
            }
        } else if (overlapPolicy === 'truncate-existing') {
            for (const conflict of conflicts) {
                const conflictEnd = conflict.tick + conflict.durTick;
                const additionEnd = addition.tick + addition.durTick;
                if (conflict.tick < addition.tick) {
                    const durTick = addition.tick - conflict.tick;
                    verbs.push({ kind: 'editNote', noteId: conflict.id!, patch: { durTick } });
                    conflict.durTick = durTick;
                } else if (conflictEnd > additionEnd) {
                    const patch = { tick: additionEnd, durTick: conflictEnd - additionEnd };
                    verbs.push({ kind: 'editNote', noteId: conflict.id!, patch });
                    Object.assign(conflict, patch);
                } else {
                    verbs.push({ kind: 'removeNote', noteId: conflict.id! });
                    working.splice(working.indexOf(conflict), 1);
                }
            }
        }
        const index = working.length;
        verbs.push({ kind: 'addNote', sourceId: target.source.id, index, note: addition });
        working.push(addition);
        selectedNoteIds.push(addition.id!);
    }
    return { verbs, selectedNoteIds };
}

function clipsForSource(arrangement: Arrangement, sourceId: string): ArrangementClip[] {
    return arrangement.tracks.flatMap((track) => track.clips).filter((clip) => clip.sourceId === sourceId);
}

/** BC-31. A shared clamped delta preserves the selection's relative geometry. */
export function moveNotes(arrangement: Arrangement, noteIds: readonly string[], deltaTick = 0, deltaPitch = 0): OpResult {
    const found = noteIds.map((id) => findNote(arrangement, id)).filter((item): item is LocatedNote => Boolean(item));
    if (!found.length) return { verbs: [], skipped: [...noteIds] };
    const sourceStarts = found.map(({ sourceId }) => {
        const starts = clipsForSource(arrangement, sourceId).map((clip) => clip.sourceStart ?? 0);
        return starts.length ? Math.min(...starts) : 0;
    });
    const tickDelta = Math.max(deltaTick, ...found.map(({ note }, index) => sourceStarts[index]! - note.tick));
    const pitchDelta = Math.max(-Math.min(...found.map(({ note }) => note.pitch)), Math.min(deltaPitch, 127 - Math.max(...found.map(({ note }) => note.pitch))));
    const verbs: Verb[] = found.map(({ note }) => ({ kind: 'editNote', noteId: note.id!, patch: { tick: note.tick + tickDelta, pitch: note.pitch + pitchDelta } }));
    for (const sourceId of new Set(found.map((item) => item.sourceId))) {
        const sourceNotes = found.filter((item) => item.sourceId === sourceId);
        const newEnd = Math.max(...sourceNotes.map(({ note }) => note.tick + tickDelta + note.durTick));
        for (const clip of clipsForSource(arrangement, sourceId)) {
            const needed = newEnd - (clip.sourceStart ?? 0);
            if (needed > clip.lengthTick) verbs.push({ kind: 'setClipWindow', clipId: clip.id!, lengthTick: needed });
        }
    }
    return { verbs, skipped: noteIds.filter((id) => !found.some(({ note }) => note.id === id)) };
}

export function copyNotes(
    arrangement: Arrangement,
    noteIds: readonly string[],
    deltaTick: number,
    deltaPitch: number,
    mintId: (prefix: string) => string,
): OpResult {
    const found = noteIds.map((id) => findNote(arrangement, id)).filter((item): item is LocatedNote => Boolean(item));
    if (!found.length) return { verbs: [], skipped: [...noteIds] };
    const tickDelta = Math.max(deltaTick, -Math.min(...found.map(({ note }) => note.tick)));
    const pitchDelta = Math.max(-Math.min(...found.map(({ note }) => note.pitch)), Math.min(deltaPitch, 127 - Math.max(...found.map(({ note }) => note.pitch))));
    const selectedNoteIds: string[] = [];
    const perSourceCount = new Map<string, number>();
    const verbs = found.map(({ sourceId, source, note }): Verb => {
        const copy = { ...note, id: mintId('note'), tick: note.tick + tickDelta, pitch: note.pitch + pitchDelta };
        selectedNoteIds.push(copy.id!);
        const index = source.notes.length + (perSourceCount.get(sourceId) ?? 0);
        perSourceCount.set(sourceId, (perSourceCount.get(sourceId) ?? 0) + 1);
        return { kind: 'addNote', sourceId, index, note: copy };
    });
    return { verbs, selectedNoteIds, skipped: noteIds.filter((id) => !found.some(({ note }) => note.id === id)) };
}

/** BC-32. Hit-zone choice is UI geometry; this function implements its atomic resize. */
export function resizeNotes(
    arrangement: Arrangement,
    noteIds: readonly string[],
    edge: 'start' | 'end',
    value: { deltaTick?: number; at?: number; mode?: 'relative' | 'absolute' },
): OpResult {
    const found = noteIds.map((id) => findNote(arrangement, id)).filter((item): item is LocatedNote => Boolean(item));
    if (!found.length) return { verbs: [], skipped: [...noteIds] };
    const mode = value.mode ?? 'relative';
    const primaryEdge = edge === 'start' ? found[0]!.note.tick : found[0]!.note.tick + found[0]!.note.durTick;
    const delta = value.deltaTick ?? ((value.at ?? primaryEdge) - primaryEdge);
    const verbs: Verb[] = [];
    for (const { note, source } of found) {
        const oldEnd = note.tick + note.durTick;
        const requested = mode === 'absolute' ? (value.at ?? primaryEdge + delta) : (edge === 'start' ? note.tick : oldEnd) + delta;
        if (edge === 'start') {
            const tick = Math.max(0, Math.min(oldEnd - 1, requested));
            verbs.push({ kind: 'editNote', noteId: note.id!, patch: { tick, durTick: oldEnd - tick } });
        } else {
            const end = Math.max(note.tick + 1, Math.min(source.lengthTick, requested));
            verbs.push({ kind: 'editNote', noteId: note.id!, patch: { durTick: end - note.tick } });
        }
    }
    return { verbs };
}

/** BC-32's exact pointer hit-zone geometry. */
export function noteResizeZone(widthPx: number, xPx: number): 'start' | 'end' | undefined {
    if (!(widthPx > 10)) return undefined;
    const edgeWidth = Math.min(8, widthPx / 2 - 1);
    if (xPx <= edgeWidth) return 'start';
    if (xPx >= widthPx - edgeWidth) return 'end';
    return undefined;
}

/** BC-32 generic-body fallback when no explicit edge handle was identified. */
export const noteBodyResizeEdge = (xFraction: number): 'start' | 'end' => xFraction <= 0.25 ? 'start' : 'end';

export function eraseNotes(arrangement: Arrangement, request: { noteIds?: readonly string[]; range?: NoteRange }): OpResult {
    const ids = request.noteIds ? [...request.noteIds] : Object.entries(arrangement.sources ?? {}).flatMap(([sourceId, source]) => {
        if (source.kind !== 'midi' || request.range?.sourceId && request.range.sourceId !== sourceId) return [];
        const range = request.range;
        if (!range) return [];
        return source.notes.filter((note) => note.tick < range.toTick && note.tick + note.durTick > range.fromTick && note.pitch >= (range.minPitch ?? 0) && note.pitch <= (range.maxPitch ?? 127)).map((note) => note.id!);
    });
    const existing = ids.filter((id) => findNote(arrangement, id));
    return { verbs: existing.map((noteId) => ({ kind: 'removeNote', noteId })), skipped: ids.filter((id) => !existing.includes(id)) };
}

/** BC-33. Without smush, one out-of-range value rejects the entire stroke. */
export function setVelocity(
    arrangement: Arrangement,
    noteIds: readonly string[],
    request: { mode: 'delta' | 'set' | 'ramp'; amount?: number; from?: number; to?: number; smush?: boolean },
): OpResult {
    const found = noteIds.map((id) => findNote(arrangement, id)).filter((item): item is LocatedNote => Boolean(item));
    const ordered = [...found].sort((a, b) => a.note.tick - b.note.tick || a.index - b.index);
    const values = new Map<string, number>();
    ordered.forEach(({ note }, index) => {
        let value: number;
        if (request.mode === 'delta') value = (note.vel ?? 64) + (request.amount ?? 0);
        else if (request.mode === 'set') value = request.amount ?? note.vel ?? 64;
        else {
            const mix = ordered.length <= 1 ? 0 : index / (ordered.length - 1);
            value = Math.round((request.from ?? 64) + ((request.to ?? request.from ?? 64) - (request.from ?? 64)) * mix);
        }
        values.set(note.id!, value);
    });
    if (!request.smush && [...values.values()].some((value) => value < 0 || value > 127)) return { verbs: [], rejected: 'velocity step would leave the 0–127 range' };
    return { verbs: found.map(({ note }) => ({ kind: 'editNote', noteId: note.id!, patch: { vel: Math.max(0, Math.min(127, values.get(note.id!)!)) } })) };
}

/** BC-35. Transposition follows the same whole-selection rejection law as velocity. */
export function transposeNotes(arrangement: Arrangement, noteIds: readonly string[], semitones: number): OpResult {
    const found = noteIds.map((id) => findNote(arrangement, id)).filter((item): item is LocatedNote => Boolean(item));
    if (found.some(({ note }) => note.pitch + semitones < 0 || note.pitch + semitones > 127)) return { verbs: [], rejected: 'transpose would leave the 0–127 pitch range' };
    return { verbs: found.map(({ note }) => ({ kind: 'editNote', noteId: note.id!, patch: { pitch: note.pitch + semitones } })) };
}

function quantizeCandidate(tick: number, grid: number, offset: number, swing: number): number {
    const position = tick - offset;
    const index = Math.round(position / grid);
    if (swing === 0) return index * grid + offset;
    const displacement = grid * swing / 300;
    const swung = (point: number) => point * grid + (Math.abs(point) % 2 === 1 ? displacement : 0) + offset;
    const current = swung(index);
    const previous = swung(index - 1);
    return Math.abs(tick - previous) < Math.abs(tick - current) ? previous : current;
}

/** BC-37, re-derived from Ardour: length uses fully quantized edges, never strength. */
export function quantizeNotes(
    arrangement: Arrangement,
    noteIds: readonly string[],
    request: { startGrid: number; endGrid?: number; snapStart?: boolean; snapEnd?: boolean; strength?: number; swing?: number; threshold?: number; position?: number },
): OpResult {
    const snapStart = request.snapStart ?? true;
    const snapEnd = request.snapEnd ?? false;
    if (!snapStart && !snapEnd) return { verbs: [] };
    if (!(request.startGrid > 0) || !((request.endGrid ?? request.startGrid) > 0)) return { verbs: [], rejected: 'quantize grids must be greater than zero' };
    const endGrid = request.endGrid ?? request.startGrid;
    const strength = (request.strength ?? 100) / 100;
    const swing = request.swing ?? 0;
    const threshold = request.threshold ?? 0;
    const position = request.position ?? 0;
    const roundPos = Math.round(position / request.startGrid) * request.startGrid;
    const offset = roundPos - position;
    const verbs: Verb[] = [];
    for (const id of noteIds) {
        const found = findNote(arrangement, id);
        if (!found) continue;
        const note = found.note;
        const candidateStart = quantizeCandidate(note.tick, request.startGrid, offset, swing);
        const startDelta = candidateStart - note.tick;
        const movedStart = snapStart && Math.abs(startDelta) >= threshold ? note.tick + Math.round(startDelta * strength) : note.tick;
        const patch: { tick?: number; durTick?: number } = {};
        if (snapStart && movedStart !== note.tick) patch.tick = movedStart;
        if (snapEnd) {
            const oldEnd = note.tick + note.durTick;
            const candidateEnd = quantizeCandidate(oldEnd, endGrid, offset, swing);
            const endDelta = candidateEnd - oldEnd;
            if (Math.abs(endDelta) >= threshold) {
                let duration = candidateEnd - candidateStart;
                if (duration === 0) duration = endGrid;
                patch.durTick = duration;
            }
        }
        if (Object.keys(patch).length) verbs.push({ kind: 'editNote', noteId: note.id!, patch });
    }
    return { verbs };
}

function locateAutomationLane(arrangement: Arrangement, laneId: string) {
    for (const track of arrangement.tracks) {
        const lane = (track.automation ?? []).find((item) => item.id === laneId);
        if (lane) return { track, lane };
    }
    return undefined;
}

export function setAutomationPoints(arrangement: Arrangement, laneId: string, points: AutomationPoint[]): OpResult {
    const found = locateAutomationLane(arrangement, laneId);
    if (!found) return { verbs: [], rejected: `no automation lane "${laneId}"` };
    return { verbs: points.map((point) => ({ kind: 'setAutomationPoint', laneId, point })) };
}

/** BC-39: move points as one batch, stopping one tick before an unselected neighbour. */
export function moveAutomationPoints(
    arrangement: Arrangement,
    laneId: string,
    ticks: readonly number[],
    deltaTick = 0,
    deltaValue = 0,
    push = false,
): OpResult {
    const found = locateAutomationLane(arrangement, laneId);
    if (!found) return { verbs: [], rejected: `no automation lane "${laneId}"` };
    const selectedTicks = new Set(ticks);
    const grabbed = found.lane.points.filter((point) => selectedTicks.has(point.tick));
    if (!grabbed.length) return { verbs: [], skipped: [...ticks].map(String) };
    const moving = push
        ? found.lane.points.filter((point) => point.tick >= Math.min(...grabbed.map((item) => item.tick)))
        : grabbed;
    const movingTicks = new Set(moving.map((point) => point.tick));
    const stationary = found.lane.points.filter((point) => !movingTicks.has(point.tick));
    let safeDelta = Math.round(deltaTick);
    safeDelta = Math.max(safeDelta, -Math.min(...moving.map((point) => point.tick)));
    for (const point of moving) {
        const left = stationary.filter((item) => item.tick < point.tick).at(-1);
        const right = stationary.find((item) => item.tick > point.tick);
        if (left) safeDelta = Math.max(safeDelta, left.tick + 1 - point.tick);
        if (right) safeDelta = Math.min(safeDelta, right.tick - 1 - point.tick);
    }
    const descriptor = descriptorForLane(arrangement, found.lane);
    const moved = moving.map((point) => ({
        tick: point.tick + safeDelta,
        value: descriptor
            ? Math.max(descriptor.min, Math.min(descriptor.max, point.value + deltaValue))
            : point.value + deltaValue,
    }));
    const fromTick = Math.min(...moving.map((point) => point.tick), ...moved.map((point) => point.tick));
    const toTick = Math.max(...moving.map((point) => point.tick), ...moved.map((point) => point.tick));
    const untouchedWithin = found.lane.points.filter((point) => point.tick >= fromTick && point.tick <= toTick && !movingTicks.has(point.tick));
    return { verbs: [{ kind: 'setAutomationRange', laneId, fromTick, toTick, points: [...untouchedWithin, ...moved] }] };
}

/** BC-40 local range replacement with one-tick boundary guards and commit thinning. */
export function setAutomationRange(
    arrangement: Arrangement,
    laneId: string,
    fromTick: number,
    toTick: number,
    points: AutomationPoint[],
    factor = 20,
): OpResult {
    const found = locateAutomationLane(arrangement, laneId);
    if (!found) return { verbs: [], rejected: `no automation lane "${laneId}"` };
    if (!(toTick >= fromTick) || fromTick < 0) return { verbs: [], rejected: 'automation range is invalid' };
    const descriptor = descriptorForLane(arrangement, found.lane);
    const authored = descriptor?.toggled ? [...points] : thinAutomationPoints(points, factor);
    const guarded = [...authored];
    const leftTick = Math.round(fromTick) - 1;
    const rightTick = Math.round(toTick) + 1;
    if (leftTick >= 0 && !found.lane.points.some((point) => point.tick >= leftTick && point.tick < fromTick)) {
        const value = evaluateAutomation(found.lane.points, leftTick, found.lane.interp);
        if (value !== undefined) guarded.unshift({ tick: leftTick, value });
    }
    if (!found.lane.points.some((point) => point.tick > toTick && point.tick <= rightTick)) {
        const value = evaluateAutomation(found.lane.points, rightTick, found.lane.interp);
        if (value !== undefined) guarded.push({ tick: rightTick, value });
    }
    return { verbs: [{ kind: 'setAutomationRange', laneId, fromTick, toTick, points: guarded }] };
}

export function thinAutomation(arrangement: Arrangement, laneId: string, factor = 20): OpResult {
    const found = locateAutomationLane(arrangement, laneId);
    if (!found) return { verbs: [], rejected: `no automation lane "${laneId}"` };
    const descriptor = descriptorForLane(arrangement, found.lane);
    if (descriptor?.toggled || found.lane.points.length < 3) return { verbs: [] };
    return { verbs: [{ kind: 'setAutomationRange', laneId, fromTick: found.lane.points[0]!.tick, toTick: found.lane.points.at(-1)!.tick, points: thinAutomationPoints(found.lane.points, factor) }] };
}
