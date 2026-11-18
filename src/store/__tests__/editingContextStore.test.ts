import { beforeEach, describe, expect, it } from 'vitest';
import { snapTimeline, useEditingContextStore, zoomAroundPointer } from '../editingContextStore';

describe('editingContextStore zoom', () => {
    beforeEach(() => useEditingContextStore.setState({
        viewports: {
            canvas: useEditingContextStore.getInitialState().viewports.canvas,
            arrangement: { ...useEditingContextStore.getInitialState().viewports.arrangement },
            pianoroll: { ...useEditingContextStore.getInitialState().viewports.pianoroll },
        },
    }));

    it('keeps the tick beneath the pointer invariant', () => {
        const before = { pxPerTick: 0.1, leftTick: 1200 };
        const pointer = 320;
        const anchor = before.leftTick + pointer / before.pxPerTick;
        const after = zoomAroundPointer(before, pointer, 1.5, 3840);
        expect(after.leftTick + pointer / after.pxPerTick).toBeCloseTo(anchor, 8);
    });

    it('clamps horizontal scale to 4 through 4000 pixels per bar', () => {
        expect(zoomAroundPointer({ pxPerTick: 1, leftTick: 0 }, 0, 100, 100).pxPerTick).toBe(40);
        expect(zoomAroundPointer({ pxPerTick: 0.1, leftTick: 0 }, 0, 0.00001, 100).pxPerTick).toBe(0.04);
    });
});

describe('timeline magnetic snap', () => {
    it('uses 12px grid and 18px anchor radii, with anchors winning ties', () => {
        expect(snapTimeline({ rawTick: 100, anchorTicks: [88], pxPerTick: 1, gridUnitTicks: 224, relativeOffsetTick: 112, mode: 'magnetic' })).toMatchObject({ tick: 88, target: 'anchor', indicatorTick: 88 });
        expect(snapTimeline({ rawTick: 113, anchorTicks: [], pxPerTick: 2, gridUnitTicks: 20, mode: 'magnetic' }).tick).toBe(113);
        expect(snapTimeline({ rawTick: 100, anchorTicks: [118], pxPerTick: 1, gridUnitTicks: null, mode: 'magnetic' }).tick).toBe(118);
    });

    it('disables snap below three pixels per grid unit and inverts live', () => {
        const base = { rawTick: 101, anchorTicks: [], pxPerTick: 1, gridUnitTicks: 2, mode: 'magnetic' as const };
        expect(snapTimeline(base).tick).toBe(101);
        expect(snapTimeline({ ...base, gridUnitTicks: 20, invert: true }).tick).toBe(101);
        expect(snapTimeline({ ...base, gridUnitTicks: 20, mode: 'off', invert: true }).tick).toBe(100);
    });

    it('pins the former clip, note, and ruler inputs to specific hand-computed ticks', () => {
        const clipEdge = snapTimeline({ rawTick: 94, gridUnitTicks: 100, anchorTicks: [], pxPerTick: 1, mode: 'magnetic' });
        const noteTie = snapTimeline({ rawTick: 106, gridUnitTicks: 100, anchorTicks: [112], pxPerTick: 1, mode: 'magnetic' });
        const rulerBelowScale = snapTimeline({ rawTick: 19, gridUnitTicks: 20, anchorTicks: [17], pxPerTick: 0.1, mode: 'magnetic' });
        const noGrid = snapTimeline({ rawTick: 51, gridUnitTicks: null, anchorTicks: [48], pxPerTick: 2, mode: 'magnetic' });
        expect(clipEdge).toMatchObject({ tick: 100, target: 'grid' });
        expect(noteTie).toMatchObject({ tick: 112, target: 'anchor' });
        expect(rulerBelowScale).toMatchObject({ tick: 17, target: 'anchor' });
        expect(noGrid).toMatchObject({ tick: 48, target: 'anchor' });
    });
});

describe('editingContextStore surface selection history', () => {
    it('keeps arrangement and piano-roll depth, branches, undo, and redo independent', () => {
        const context = useEditingContextStore.getState();
        context.beginSelectionOpHistory('arrangement');
        context.beginSelectionOpHistory('pianoroll');
        context.beginSelectionOp('arrangement');
        context.setSelection('arrangement', { clipIds: ['clip-a'] });
        context.commitSelectionOp('arrangement');
        context.beginSelectionOp('pianoroll');
        context.setSelection('pianoroll', { noteIds: ['note-a'] });
        context.commitSelectionOp('pianoroll');
        context.undoSelection('arrangement');
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toEqual([]);
        expect(useEditingContextStore.getState().viewports.pianoroll.selection.noteIds).toEqual(['note-a']);
        context.undoSelection('pianoroll');
        context.redoSelection('arrangement');
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toEqual(['clip-a']);
        expect(useEditingContextStore.getState().viewports.pianoroll.selection.noteIds).toEqual([]);
    });

    it('aborts to the exact pre-operation selection', () => {
        const context = useEditingContextStore.getState();
        context.setSelection('arrangement', { clipIds: ['before'] });
        context.beginSelectionOp('arrangement');
        context.setSelection('arrangement', { clipIds: ['preview'] });
        context.abortSelectionOp('arrangement');
        expect(useEditingContextStore.getState().viewports.arrangement.selection.clipIds).toEqual(['before']);
    });
});
