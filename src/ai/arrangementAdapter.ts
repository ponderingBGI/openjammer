/**
 * Live binding of the timeline tool port to the arrangement store — the song-layer
 * mirror of {@link import('./graphAdapter').createGraphStoreApi}. {@link
 * applyToolCall} stays pure (it takes an {@link ArrangementToolPort}); this is where
 * `describe_arrangement` / `edit_timeline` reach the real Zustand store, so the agent
 * authors the ONE Arrangement through the SAME reversible verbs + command-log a human
 * GUI drag uses (one Ctrl+Z for both).
 *
 * Ids for ADDED entities are minted here (the agent omits them), so an inverse can
 * name what it created — the same `mintId` the GUI uses, kept collision-free.
 */

import { useArrangementStore } from '../store/arrangementStore';
import { describeArrangement } from '../song/describe';
import { applyVerbs, type Verb } from '../song/verbs';
import type { ArrangementToolPort } from './tools';
import { deleteClips, deleteTime, duplicateClips, insertTime, moveClips, nudge, splitAt, trimClip, type TimelineOp } from '../song/ops';
import { useEditingContextStore, type GridUnit } from '../store/editingContextStore';

/** Fill any missing stable id on a verb's ADDED entity (and nested notes), so the
 *  reversible inverse can address exactly what this edit created. */
function withMintedIds(verb: Verb, mint: (prefix: string) => string): Verb {
    const midiSourceId = () => mint('src:midi:m').replace(/m-(\d+)$/, 'm$1');
    const sourceWithIds = <T extends Extract<Verb, { kind: 'addSource' }>['source']>(source: T): T => {
        if (source.kind === 'audio') return { ...source, id: `src:audio:${source.assetId.toLowerCase()}` };
        return {
            ...source,
            id: source.id || midiSourceId(),
            notes: source.notes.map((note) => note.id ? note : { ...note, id: mint('note') }),
        } as T;
    };
    const clipWithId = <T extends Extract<Verb, { kind: 'addClip' }>['clip']>(clip: T): T =>
        (clip.id ? clip : { ...clip, id: mint('clip') }) as T;
    switch (verb.kind) {
        case 'addTrack':
            return verb.track.id ? verb : { ...verb, track: { ...verb.track, id: mint('track') } };
        case 'addSource':
            return { ...verb, source: sourceWithIds(verb.source) };
        case 'addClip':
            return { ...verb, clip: clipWithId(verb.clip) };
        case 'splitClip':
            return { ...verb, left: clipWithId(verb.left), right: clipWithId(verb.right) };
        case 'duplicateClip':
            return { ...verb, clip: clipWithId(verb.clip), source: verb.source ? sourceWithIds(verb.source) : undefined };
        case 'stretchClip':
            return { ...verb, newSource: sourceWithIds(verb.newSource), newClip: clipWithId(verb.newClip) };
        case 'bounceClips':
            return { ...verb, newSource: sourceWithIds(verb.newSource), newClip: clipWithId(verb.newClip) };
        case 'addNote':
            return verb.note.id ? verb : { ...verb, note: { ...verb.note, id: mint('note') } };
        case 'addLocation':
            return verb.location.id ? verb : { ...verb, location: { ...verb.location, id: mint('location') } };
        case 'addAutomationLane':
            return verb.lane.id ? verb : { ...verb, lane: { ...verb.lane, id: mint('lane') } };
        default:
            return verb;
    }
}

/** Create the live timeline port for {@link applyToolCall}. Reads the store fresh on
 *  every call (mutation discipline — never close over a stale snapshot). */
export function createArrangementPort(): ArrangementToolPort {
    return {
        describe() {
            const arr = useArrangementStore.getState().arrangement;
            if (!arr) return null;
            const editing = useEditingContextStore.getState();
            return { text: describeArrangement(arr), selection: editing.viewports.arrangement.selection, grid: editing.gridUnit, editMode: editing.editMode };
        },
        applyOps(ops: TimelineOp[]) {
            const store = useArrangementStore.getState();
            const arrangement = store.arrangement;
            if (!arrangement) return { ok: false, summary: 'No song is open on the timeline to edit.', undo: () => {} };
            const verbs: Verb[] = [];
            let projected = arrangement;
            let selectedClipIds: string[] | undefined;
            try {
                for (const operation of ops) {
                    let result;
                    switch (operation.op) {
                        case 'moveClips': result = moveClips(projected, operation.clipIds, operation.deltaTick, operation); break;
                        case 'trimClip': result = trimClip(projected, operation.clipIds, operation.edge, operation.atTick); break;
                        case 'splitAt': result = splitAt(projected, operation.clipIds, operation.atTick, store.mintId); break;
                        case 'duplicateClips': result = duplicateClips(projected, operation.clipIds, operation.deltaTick, store.mintId); break;
                        case 'deleteClips': result = deleteClips(projected, operation.clipIds, operation.ripple); break;
                        case 'nudge': result = nudge(projected, operation.clipIds, operation.amount, operation.direction); break;
                        case 'deleteTime': result = deleteTime(projected, operation.fromTick, operation.toTick, operation.trackIds); break;
                        case 'insertTime': result = insertTime(projected, operation.atTick, operation.durationTick, operation.trackIds); break;
                        case 'setGrid': useEditingContextStore.getState().setGridUnit(operation.grid as GridUnit); continue;
                    }
                    projected = applyVerbs(projected, result.verbs).next;
                    verbs.push(...result.verbs);
                    selectedClipIds = result.selectedClipIds ?? selectedClipIds;
                }
            } catch (error) {
                return { ok: false, summary: `edit_timeline failed: ${error instanceof Error ? error.message : String(error)}`, undo: () => {} };
            }
            if (verbs.length) store.apply(verbs);
            if (selectedClipIds) useEditingContextStore.getState().setSelection('arrangement', { clipIds: selectedClipIds });
            return { ok: true, summary: `Applied ${ops.length} timeline operation(s).`, undo: () => useArrangementStore.getState().undo() };
        },
        apply(verbs) {
            const s = useArrangementStore.getState();
            if (!s.arrangement) {
                return { ok: false, summary: 'No song is open on the timeline to edit.', undo: () => {} };
            }
            const minted = verbs.map((v) => withMintedIds(v, s.mintId));
            try {
                // One store.apply = one command-log entry = one Ctrl+Z (atomic: a bad
                // verb throws inside applyVerbs BEFORE any state commits, so the edit is
                // all-or-nothing).
                s.apply(minted);
            } catch (err) {
                return {
                    ok: false,
                    summary: `edit_timeline failed: ${err instanceof Error ? err.message : String(err)}`,
                    undo: () => {},
                };
            }
            return {
                ok: true,
                summary: `Applied ${minted.length} timeline edit(s).`,
                undo: () => useArrangementStore.getState().undo(),
            };
        },
    };
}
