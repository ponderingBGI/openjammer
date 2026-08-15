import type { Arrangement, ArrangementClip } from './types';
import type { Verb } from './verbs';

export interface OpResult { verbs: Verb[]; selectedClipIds?: string[]; skipped?: string[] }

export const EDIT_OPS = ['moveClips', 'trimClip', 'splitAt', 'duplicateClips', 'deleteClips', 'setGrid', 'nudge', 'deleteTime', 'insertTime'] as const;
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
    | { op: 'insertTime'; atTick: number; durationTick: number; trackIds: string[] };

const findClip = (arrangement: Arrangement, clipId: string) => {
    for (const track of arrangement.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) return { clip, track };
    }
    return undefined;
};

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
