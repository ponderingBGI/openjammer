import { create } from 'zustand';
import type { Arrangement, ArrangementClip, ArrangementNote, AutomationPoint } from '../song/types';
import type { ObjectSelection } from './editingContextStore';

export interface ClipboardClip extends Omit<ArrangementClip, 'id' | 'startTick'> { offsetTick: number }
export interface ClipboardNote extends Omit<ArrangementNote, 'id' | 'tick'> { offsetTick: number; sourceClipId: string }
export interface ClipboardAutomationPoint extends AutomationPoint { offsetTick: number; sourceLaneId: string }
export interface ClipboardBucket {
    sourceTrackId: string;
    clips: ClipboardClip[];
    notes: ClipboardNote[];
    automationPoints: ClipboardAutomationPoint[];
}
export interface CutBuffer {
    originTick: number;
    durationTick: number;
    buckets: ClipboardBucket[];
}
export interface ClipboardSummary {
    clips: number;
    notes: number;
    automationPoints: number;
    durationTick: number;
    sourceTrackIds: string[];
}

function pointIdentity(laneId: string, tick: number): string[] {
    return [`${laneId}:${tick}`, `${laneId}@${tick}`, `${laneId}/${tick}`];
}

/** BC-27: capture model copies at one global origin, never live ids. */
export function captureCutBuffer(arrangement: Arrangement, selection: ObjectSelection, focusedClipId?: string | null): CutBuffer | null {
    const range = selection.timeRange;
    const trackFilter = range?.trackIds.length ? new Set(range.trackIds) : null;
    const candidates: Array<{ trackId: string; position: number; kind: 'clip' | 'note' | 'point'; value: ArrangementClip | ArrangementNote | AutomationPoint; sourceClipId?: string; sourceLaneId?: string }> = [];
    for (const track of arrangement.tracks) {
        const trackId = track.id ?? track.ref;
        if (trackFilter && !trackFilter.has(trackId)) continue;
        for (const clip of track.clips) {
            if (range) {
                const from = Math.max(range.fromTick, clip.startTick);
                const to = Math.min(range.toTick, clip.startTick + clip.lengthTick);
                if (to > from) candidates.push({ trackId, position: from, kind: 'clip', value: { ...clip, startTick: from, lengthTick: to - from, sourceStart: (clip.sourceStart ?? 0) + (from - clip.startTick) } });
            } else if (clip.id && selection.clipIds.includes(clip.id)) candidates.push({ trackId, position: clip.startTick, kind: 'clip', value: clip });
        }
        for (const clip of track.clips) {
            if (!clip.id || (focusedClipId && clip.id !== focusedClipId)) continue;
            const source = arrangement.sources?.[clip.sourceId];
            if (source?.kind !== 'midi') continue;
            for (const note of source.notes) if (note.id && selection.noteIds.includes(note.id)) {
                candidates.push({ trackId, position: clip.startTick + note.tick - (clip.sourceStart ?? 0), kind: 'note', value: note, sourceClipId: clip.id });
            }
        }
        for (const lane of track.automation ?? []) for (const point of lane.points) {
            const selectedByRange = Boolean(range && point.tick >= range.fromTick && point.tick < range.toTick);
            if (lane.id && (selectedByRange || selection.automationPointIds.some((id) => pointIdentity(lane.id!, point.tick).includes(id)))) candidates.push({ trackId, position: point.tick, kind: 'point', value: point, sourceLaneId: lane.id });
        }
    }
    if (!candidates.length) return null;
    const originTick = Math.min(...candidates.map((item) => item.position));
    const buckets: ClipboardBucket[] = [];
    for (const item of candidates) {
        let bucket = buckets.find((entry) => entry.sourceTrackId === item.trackId);
        if (!bucket) { bucket = { sourceTrackId: item.trackId, clips: [], notes: [], automationPoints: [] }; buckets.push(bucket); }
        if (item.kind === 'clip') {
            const clip = item.value as ArrangementClip;
            const { id: _id, startTick, ...copy } = clip;
            bucket.clips.push({ ...structuredClone(copy), offsetTick: startTick - originTick });
        } else if (item.kind === 'note') {
            const note = item.value as ArrangementNote;
            const { id: _id, tick: _tick, ...copy } = note;
            bucket.notes.push({ ...copy, offsetTick: item.position - originTick, sourceClipId: item.sourceClipId! });
        } else {
            const point = item.value as AutomationPoint;
            bucket.automationPoints.push({ ...point, offsetTick: point.tick - originTick, sourceLaneId: item.sourceLaneId! });
        }
    }
    const end = Math.max(...candidates.map((item) => item.kind === 'clip' ? item.position + (item.value as ArrangementClip).lengthTick : item.kind === 'note' ? item.position + (item.value as ArrangementNote).durTick : item.position));
    return { originTick, durationTick: Math.max(1, end - originTick), buckets };
}

interface ClipboardState {
    buffer: CutBuffer | null;
    pasteCount: number;
    lastPastePos: number | null;
    setBuffer: (buffer: CutBuffer | null) => void;
    clear: () => void;
    notePasteAttempt: (position: number) => number;
    resetPasteContext: () => void;
    summary: () => ClipboardSummary;
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
    buffer: null,
    pasteCount: 0,
    lastPastePos: null,
    setBuffer: (buffer) => set({ buffer, pasteCount: 0, lastPastePos: null }),
    clear: () => set({ buffer: null, pasteCount: 0, lastPastePos: null }),
    notePasteAttempt: (position) => {
        const state = get();
        const count = state.lastPastePos === position ? state.pasteCount : 0;
        set({ pasteCount: count + 1, lastPastePos: position });
        return count;
    },
    resetPasteContext: () => set({ pasteCount: 0, lastPastePos: null }),
    summary: () => {
        const buffer = get().buffer;
        return {
            clips: buffer?.buckets.reduce((n, bucket) => n + bucket.clips.length, 0) ?? 0,
            notes: buffer?.buckets.reduce((n, bucket) => n + bucket.notes.length, 0) ?? 0,
            automationPoints: buffer?.buckets.reduce((n, bucket) => n + bucket.automationPoints.length, 0) ?? 0,
            durationTick: buffer?.durationTick ?? 0,
            sourceTrackIds: buffer?.buckets.map((bucket) => bucket.sourceTrackId) ?? [],
        };
    },
}));

export function pasteOffset(position: number, count: number, duration: number, grid: number): number {
    if (count === 0) return 0;
    const raw = position + duration * count;
    return Math.ceil(raw / Math.max(1, grid)) * Math.max(1, grid) - position;
}
