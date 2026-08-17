import type { SurfaceId } from '../store/uiViewStore';
import { useArrangementStore } from '../store/arrangementStore';
import { useClipboardStore, captureCutBuffer, pasteOffset } from '../store/clipboardStore';
import { gridTicks, useEditingContextStore } from '../store/editingContextStore';
import { deleteRange, pasteCutBuffer, splitRange } from './ops';
import { timebase } from './time';
import type { Verb } from './verbs';

function activeSurface(surface?: SurfaceId): 'arrangement' | 'pianoroll' {
    return surface === 'pianoroll' ? 'pianoroll' : 'arrangement';
}

export function copySelection(surface?: SurfaceId): boolean {
    const store = useArrangementStore.getState();
    if (!store.arrangement) return false;
    const editing = useEditingContextStore.getState();
    const which = activeSurface(surface);
    const buffer = captureCutBuffer(store.arrangement, editing.viewports[which].selection, editing.enteredClipId ?? editing.viewports[which].selection.clipIds[0]);
    if (!buffer) return false;
    useClipboardStore.getState().setBuffer(buffer);
    return true;
}

function removalVerbs(surface?: SurfaceId): Verb[] {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    if (!arrangement) return [];
    const editing = useEditingContextStore.getState();
    const selection = editing.viewports[activeSurface(surface)].selection;
    if (selection.timeRange) return deleteRange(arrangement, selection.timeRange.fromTick, selection.timeRange.toTick, selection.timeRange.trackIds, store.mintId).verbs;
    const verbs: Verb[] = selection.clipIds.map((clipId) => ({ kind: 'removeClip', clipId }));
    verbs.push(...selection.noteIds.map((noteId) => ({ kind: 'removeNote', noteId } as const)));
    for (const track of arrangement.tracks) for (const lane of track.automation ?? []) if (lane.id) for (const point of lane.points) {
        if (selection.automationPointIds.some((id) => id === `${lane.id}:${point.tick}` || id === `${lane.id}@${point.tick}` || id === `${lane.id}/${point.tick}`)) verbs.push({ kind: 'removeAutomationPoint', laneId: lane.id, tick: point.tick });
    }
    return verbs;
}

export function cutSelection(surface?: SurfaceId): boolean {
    if (!copySelection(surface)) return false;
    const verbs = removalVerbs(surface);
    if (!verbs.length) return false;
    useArrangementStore.getState().apply(verbs);
    useEditingContextStore.getState().clearSelection(activeSurface(surface));
    useEditingContextStore.getState().beginSelectionOpHistory(activeSurface(surface));
    return true;
}

/** Delete is intentionally clipboard-preserving (BC-27). */
export function deleteSelection(surface?: SurfaceId): boolean {
    const verbs = removalVerbs(surface);
    if (!verbs.length) return false;
    useArrangementStore.getState().apply(verbs);
    useEditingContextStore.getState().clearSelection(activeSurface(surface));
    useEditingContextStore.getState().beginSelectionOpHistory(activeSurface(surface));
    return true;
}

function resolveTargetTracks(): string[] {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    if (!arrangement) return [];
    const editing = useEditingContextStore.getState();
    const explicit = [...new Set(editing.viewports.arrangement.selection.trackIds)];
    if (explicit.length) return arrangement.tracks.map((track) => track.id ?? track.ref).filter((id) => explicit.includes(id));
    let base = editing.enteredTrackId;
    if (!base && editing.enteredClipId) base = arrangement.tracks.find((track) => track.clips.some((clip) => clip.id === editing.enteredClipId))?.id ?? null;
    if (!base) base = useClipboardStore.getState().buffer?.buckets[0]?.sourceTrackId ?? null;
    const index = arrangement.tracks.findIndex((track) => (track.id ?? track.ref) === base);
    return index < 0 ? [] : arrangement.tracks.slice(index).map((track) => track.id ?? track.ref);
}

export function paste(options: { atTick?: number; times?: number; surface?: SurfaceId; toTrackIds?: string[] } = {}): boolean {
    const arrangementStore = useArrangementStore.getState();
    const arrangement = arrangementStore.arrangement;
    const clipboard = useClipboardStore.getState();
    if (!arrangement || !clipboard.buffer) return false;
    const editing = useEditingContextStore.getState();
    const position = Math.max(0, Math.round(options.atTick ?? arrangementStore.playheadTick));
    const count = clipboard.notePasteAttempt(position);
    const tb = timebase(arrangement);
    const grid = gridTicks(editing.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, editing.viewports.arrangement.pxPerTick, true) ?? 1;
    const surface = activeSurface(options.surface);
    const noteDuration = Math.ceil(clipboard.buffer.durationTick / grid) * grid;
    const result = pasteCutBuffer(arrangement, clipboard.buffer, {
        atTick: position,
        targetTrackIds: options.toTrackIds ?? resolveTargetTracks(),
        focusedClipId: editing.enteredClipId ?? editing.viewports.pianoroll.selection.clipIds[0],
        times: options.times,
        repeatOffset: pasteOffset(position, count, surface === 'pianoroll' ? noteDuration : clipboard.buffer.durationTick, grid),
        spacingTick: surface === 'pianoroll' ? noteDuration : clipboard.buffer.durationTick,
        consume: surface === 'pianoroll' ? 'notes' : 'all',
        mint: arrangementStore.mintId,
    });
    if (!result.verbs.length) return false;
    arrangementStore.apply(result.verbs);
    const context = useEditingContextStore.getState();
    context.setSelection(surface, { clipIds: result.selectedClipIds ?? [], noteIds: result.selectedNoteIds ?? [] });
    context.beginSelectionOpHistory(surface);
    return true;
}

export const pasteRepeat = paste;

export function splitSelectedRange(): boolean {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    const context = useEditingContextStore.getState();
    const range = context.viewports.arrangement.selection.timeRange;
    if (!arrangement || !range) return false;
    const result = splitRange(arrangement, range.fromTick, range.toTick, range.trackIds, store.mintId);
    if (!result.verbs.length) return false;
    store.apply(result.verbs);
    return true;
}

export function loopFromSelection(): boolean {
    const store = useArrangementStore.getState();
    const range = useEditingContextStore.getState().viewports.arrangement.selection.timeRange;
    if (!store.arrangement || !range) return false;
    store.apply([{ kind: 'setLoopRange', location: { id: store.mintId('location'), name: 'Loop', kind: 'loop', startTick: range.fromTick, endTick: range.toTick } }]);
    return true;
}

/** Duplicate is deliberately clipboard-neutral (BC-29). */
export function duplicateSelectedRange(): boolean {
    const store = useArrangementStore.getState();
    const arrangement = store.arrangement;
    const context = useEditingContextStore.getState();
    const selection = context.viewports.arrangement.selection;
    const range = selection.timeRange;
    if (!arrangement || !range) return false;
    const temporary = captureCutBuffer(arrangement, selection, null);
    if (!temporary) return false;
    const result = pasteCutBuffer(arrangement, temporary, { atTick: range.toTick, targetTrackIds: range.trackIds, mint: store.mintId });
    if (!result.verbs.length) return false;
    store.apply(result.verbs);
    context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] });
    context.beginSelectionOpHistory('arrangement');
    return true;
}
