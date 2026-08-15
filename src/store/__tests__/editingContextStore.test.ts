import { beforeEach, describe, expect, it } from 'vitest';
import { useEditingContextStore, zoomAroundPointer } from '../editingContextStore';

describe('editingContextStore zoom', () => {
    beforeEach(() => useEditingContextStore.setState({
        viewports: {
            canvas: useEditingContextStore.getInitialState().viewports.canvas,
            arrangement: { ...useEditingContextStore.getInitialState().viewports.arrangement },
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
