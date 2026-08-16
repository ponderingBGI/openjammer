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
import {
    copyNotes,
    deleteClips,
    deleteTime,
    deleteRange,
    drawNotes,
    duplicateClips,
    eraseNotes,
    insertTime,
    moveClips,
    moveAutomationPoints,
    moveNotes,
    nudge,
    quantizeNotes,
    resizeNotes,
    setAutomationPoints,
    setAutomationRange,
    setVelocity,
    splitAt,
    splitRange,
    slipClips,
    transposeNotes,
    trimClip,
    thinAutomation,
    type OpResult,
    type TimelineOp,
} from '../song/ops';
import { useEditingContextStore, type GridUnit } from '../store/editingContextStore';
import { copySelection, cutSelection, duplicateSelectedRange, paste } from '../song/editingActions';
import { useClipboardStore } from '../store/clipboardStore';
import { timebase } from '../song/time';

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
            const clipboard = useClipboardStore.getState().summary();
            const ticksPerBar = timebase(arr).ticksPerBar;
            const record = useArrangementStore.getState();
            const recordingState = `Recording: ${record.isRecording ? 'RECORDING' : 'stopped'}; armed [${record.armedTrackIds.join(', ') || 'none'}]; click ${record.clickEnabled ? 'on' : 'off'}; count-in ${record.countInBars} bar(s); punch ${record.punchEnabled ? 'on' : 'off'}.`;
            return { text: `${describeArrangement(arr)}\n${recordingState}`, selection: editing.viewports.arrangement.selection, grid: editing.gridUnit, editMode: editing.editMode, clipboard: { ...clipboard, durationBars: clipboard.durationTick / ticksPerBar } };
        },
        applyOps(ops: TimelineOp[]) {
            const store = useArrangementStore.getState();
            const arrangement = store.arrangement;
            if (!arrangement) return { ok: false, summary: 'No song is open on the timeline to edit.', undo: () => {} };
            const verbs: Verb[] = [];
            let projected = arrangement;
            let selectedClipIds: string[] | undefined;
            let selectedNoteIds: string[] | undefined;
            try {
                for (const operation of ops) {
                    let result: OpResult = { verbs: [] };
                    switch (operation.op) {
                        case 'moveClips': result = moveClips(projected, operation.clipIds, operation.deltaTick, operation); break;
                        case 'trimClip': result = trimClip(projected, operation.clipIds, operation.edge, operation.atTick); break;
                        case 'splitAt': result = splitAt(projected, operation.clipIds, operation.atTick, store.mintId); break;
                        case 'duplicateClips': result = duplicateClips(projected, operation.clipIds, operation.deltaTick, store.mintId); break;
                        case 'deleteClips': result = deleteClips(projected, operation.clipIds, operation.ripple); break;
                        case 'nudge': result = nudge(projected, operation.clipIds, operation.amount, operation.direction); break;
                        case 'deleteTime': result = deleteTime(projected, operation.fromTick, operation.toTick, operation.trackIds); break;
                        case 'insertTime': result = insertTime(projected, operation.atTick, operation.durationTick, operation.trackIds); break;
                        case 'deleteRange': result = deleteRange(projected, operation.fromTick, operation.toTick, operation.trackIds, store.mintId); break;
                        case 'slipClip': result = slipClips(projected, operation.clipIds, operation.deltaTick); break;
                        case 'splitRange': result = splitRange(projected, operation.fromTick, operation.toTick, operation.trackIds, store.mintId); break;
                        case 'selectRange': {
                            const context = useEditingContextStore.getState();
                            context.beginSelectionOp('arrangement');
                            context.setSelection('arrangement', { timeRange: { fromTick: operation.fromTick, toTick: operation.toTick, trackIds: operation.trackIds } });
                            context.commitSelectionOp('arrangement');
                            continue;
                        }
                        case 'copySelection': copySelection('arrangement'); continue;
                        case 'cutSelection': cutSelection('arrangement'); continue;
                        case 'paste': paste({ atTick: operation.atTick, times: operation.times, toTrackIds: operation.toTrackIds, surface: 'arrangement' }); continue;
                        case 'pasteRepeat': paste({ times: operation.times, surface: 'arrangement' }); continue;
                        case 'duplicateRange': {
                            useEditingContextStore.getState().setSelection('arrangement', { timeRange: { fromTick: operation.fromTick, toTick: operation.toTick, trackIds: operation.trackIds } });
                            duplicateSelectedRange();
                            continue;
                        }
                        case 'setGrid': useEditingContextStore.getState().setGridUnit(operation.grid as GridUnit); continue;
                        case 'drawNote': result = drawNotes(projected, operation.clipId, [operation.note], store.mintId, operation.overlap); break;
                        case 'moveNotes': result = moveNotes(projected, operation.noteIds, operation.deltaTick, operation.deltaPitch); break;
                        case 'copyNotes': result = copyNotes(projected, operation.noteIds, operation.deltaTick ?? 0, operation.deltaPitch ?? 0, store.mintId); break;
                        case 'resizeNotes': result = resizeNotes(projected, operation.noteIds, operation.edge, operation); break;
                        case 'eraseNotes': result = eraseNotes(projected, operation); break;
                        case 'setVelocity': result = setVelocity(projected, operation.noteIds, operation); break;
                        case 'transposeNotes': result = transposeNotes(projected, operation.noteIds, operation.semitones); break;
                        case 'quantizeNotes': result = quantizeNotes(projected, operation.targets, { ...operation, startGrid: operation.grid }); break;
                        case 'setAutomationPoints': result = setAutomationPoints(projected, operation.laneId, operation.points); break;
                        case 'moveAutomationPoints': result = moveAutomationPoints(projected, operation.laneId, operation.ticks, operation.deltaTick, operation.deltaValue, operation.push); break;
                        case 'setAutomationRange': result = setAutomationRange(projected, operation.laneId, operation.fromTick, operation.toTick, operation.points, operation.factor); break;
                        case 'thinAutomation': result = thinAutomation(projected, operation.laneId, operation.factor); break;
                        case 'setTrackGain': result = { verbs: [{ kind: 'setTrackGain', trackId: operation.trackId, gainDb: operation.gainDb }] }; break;
                        case 'setTrackPan': result = { verbs: [{ kind: 'setTrackPan', trackId: operation.trackId, pan: operation.pan }] }; break;
                        case 'addAutomationPoint': result = setAutomationPoints(projected, operation.laneId, [operation.point]); break;
                        case 'addAutomationPoints': result = setAutomationPoints(projected, operation.laneId, operation.points); break;
                        case 'setLaneState': result = { verbs: [{ kind: 'setAutomationLaneState', laneId: operation.laneId, state: operation.state }] }; break;
                        case 'armTrack': {
                            const armed = store.armTrack(operation.trackId, operation.armed);
                            if (!armed.ok) throw new Error(armed.message ?? 'track could not be armed');
                            continue;
                        }
                        case 'setClick': store.setClick(operation.on); continue;
                        case 'setCountIn': store.setCountIn(operation.bars); continue;
                        case 'record': {
                            if ((operation.action === 'start') !== store.isRecording) void store.record();
                            continue;
                        }
                    }
                    if (result.rejected) throw new Error(result.rejected);
                    projected = applyVerbs(projected, result.verbs).next;
                    verbs.push(...result.verbs);
                    selectedClipIds = result.selectedClipIds ?? selectedClipIds;
                    selectedNoteIds = result.selectedNoteIds ?? selectedNoteIds;
                }
            } catch (error) {
                return { ok: false, summary: `edit_timeline failed: ${error instanceof Error ? error.message : String(error)}`, undo: () => {} };
            }
            if (verbs.length) store.apply(verbs);
            if (selectedClipIds) useEditingContextStore.getState().setSelection('arrangement', { clipIds: selectedClipIds });
            if (selectedNoteIds) useEditingContextStore.getState().setSelection('arrangement', { noteIds: selectedNoteIds });
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
