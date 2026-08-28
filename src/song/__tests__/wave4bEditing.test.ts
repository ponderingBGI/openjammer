import { beforeEach, describe, expect, it } from 'vitest';
import type { Arrangement } from '../types';
import { applyVerbs } from '../verbs';
import { deleteRange, pasteCutBuffer, slipClips } from '../ops';
import { captureCutBuffer, pasteOffset, useClipboardStore } from '../../store/clipboardStore';
import { emptySelection, useEditingContextStore } from '../../store/editingContextStore';
import { useHistoryStore } from '../../store/historyStore';

const arrangement = (): Arrangement => ({
    name: 'Wave 4b', tempoBpm: 120, ppq: 960, timeSignature: [4, 4], graph: { nodes: [], connections: [] },
    sources: {
        midi: { id: 'midi', kind: 'midi', name: 'Notes', lengthTick: 8000, notes: [{ id: 'n1', tick: 120, durTick: 360, pitch: 60, vel: 90 }] },
    },
    tracks: [
        { id: 't1', ref: 'one', clips: [{ id: 'c1', sourceId: 'midi', startTick: 100, lengthTick: 1000, sourceStart: 20 }], automation: [{ id: 'lane1', ref: 'one', param: 0, points: [{ tick: 200, value: 0.5 }] }] },
        { id: 't2', ref: 'two', clips: [] },
    ],
});

let id = 0;
const mint = (prefix: string) => `${prefix}-${++id}`;

beforeEach(() => {
    id = 0;
    useClipboardStore.setState({ buffer: null, pasteCount: 0, lastPastePos: null });
    useHistoryStore.getState().clear();
    useEditingContextStore.setState({ selectionHistory: [emptySelection()], selectionHistoryIndex: 0, selectionOpDepth: 0, selectionOpBefore: null });
    useEditingContextStore.getState().clearSelection('arrangement');
});

describe('BC-19 slip contents', () => {
    it('changes source start while preserving the clip window', () => {
        const arr = arrangement();
        const next = applyVerbs(arr, slipClips(arr, ['c1'], 80).verbs).next.tracks[0]!.clips[0]!;
        expect(next).toMatchObject({ startTick: 100, lengthTick: 1000, sourceStart: 100 });
    });
});

describe('BC-23 object/range exclusivity', () => {
    it('range clears objects and a new object clears the range', () => {
        const context = useEditingContextStore.getState();
        context.setSelection('arrangement', { clipIds: ['c1'] });
        context.setSelection('arrangement', { timeRange: { fromTick: 10, toTick: 20, trackIds: ['t1'] } });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toEqual([]);
        context.setSelection('arrangement', { clipIds: ['c1'] });
        expect(useEditingContextStore.getState().viewports.arrangement.selection.timeRange).toBeNull();
    });
});

describe('BC-25 range delete', () => {
    it('splits a clip at both range boundaries and advances the right source window', () => {
        const arr = arrangement();
        const next = applyVerbs(arr, deleteRange(arr, 300, 700, ['t1'], mint).verbs).next;
        expect(next.tracks[0]!.clips).toEqual([
            expect.objectContaining({ startTick: 100, lengthTick: 200, sourceStart: 20 }),
            expect.objectContaining({ startTick: 700, lengthTick: 400, sourceStart: 620 }),
        ]);
    });
});

describe('BC-26 selection undo', () => {
    it('branches independently and object commits reset it to one baseline', () => {
        const context = useEditingContextStore.getState();
        for (const clipIds of [['a'], ['b'], ['c']]) {
            context.beginSelectionOp('arrangement'); context.setSelection('arrangement', { clipIds }); context.commitSelectionOp('arrangement');
        }
        context.undoSelection('arrangement'); context.undoSelection('arrangement');
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toEqual(['a']);
        context.beginSelectionOp('arrangement'); context.setSelection('arrangement', { clipIds: ['branch'] }); context.commitSelectionOp('arrangement');
        expect(useEditingContextStore.getState().selectionHistory.map((entry) => entry.clipIds)).toEqual([['branch'], ['a'], []]);
        useHistoryStore.getState().record([{ domain: 'arrangement', verb: { kind: 'setTempo', tempoBpm: 121 } }], [{ domain: 'arrangement', verb: { kind: 'setTempo', tempoBpm: 120 } }], 'tempo', 'arrangement');
        expect(useEditingContextStore.getState().selectionHistory).toHaveLength(1);
    });
});

describe('BC-27 cut buffer capture', () => {
    it('captures clipped range models at a global origin with automation', () => {
        const selection = { ...emptySelection(), timeRange: { fromTick: 150, toTick: 500, trackIds: ['t1'] }, automationPointIds: ['lane1:200'] };
        const buffer = captureCutBuffer(arrangement(), selection)!;
        expect(buffer.originTick).toBe(150);
        expect(buffer.buckets[0]!.clips[0]).toMatchObject({ offsetTick: 0, lengthTick: 350, sourceStart: 70 });
        expect(buffer.buckets[0]!.clips[0]).not.toHaveProperty('id');
    });
});

describe('BC-28 paste target consumption', () => {
    it('mints fresh ids and preserves the source-bucket offset', () => {
        const buffer = captureCutBuffer(arrangement(), { ...emptySelection(), clipIds: ['c1'] })!;
        const result = pasteCutBuffer(arrangement(), buffer, { atTick: 2000, targetTrackIds: ['t2'], mint });
        expect(result.verbs).toHaveLength(1);
        expect(result.verbs[0]).toMatchObject({ kind: 'addClip', trackId: 't2', clip: { startTick: 2000 } });
        expect(result.selectedClipIds).not.toEqual(['c1']);
    });
});

describe('BC-29 repeat paste math', () => {
    it('places three pastes at 0, d, 2d and rounds each ladder rung upward', () => {
        expect([0, 1, 2].map((count) => pasteOffset(0, count, 370, 240))).toEqual([0, 480, 960]);
        expect(pasteOffset(100, 1, 370, 240)).toBe(380);
    });
});
