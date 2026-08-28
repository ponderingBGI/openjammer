import { describe, expect, it } from 'vitest';
import { getGridLadder } from '../rulerMarks';

describe('arrangement grid ladder', () => {
    it.each([
        [104, 1, 1, true, false],
        [48, 1, 1, true, false],
        [36, 1, 1, false, false],
        [9, 1, 4, false, false],
        [8, 1, 16, false, false],
        [4, 4, 16, false, false],
        [2, 16, 64, false, false],
    ])('maps %d px/bar to the required thinning ladder', (pxPerBar, barStride, labelStride, beats, subdivisions) => {
        expect(getGridLadder(pxPerBar, 4, '1/16')).toEqual({ barStride, labelStride, drawBeats: beats, drawSubdivisions: subdivisions });
    });

    it('draws subdivisions only when the active unit has at least 9px spacing', () => {
        expect(getGridLadder(144, 4, '1/16').drawSubdivisions).toBe(true);
        expect(getGridLadder(140, 4, '1/16').drawSubdivisions).toBe(false);
    });

    it('keeps bar structure but removes beat and sub lines at grid none', () => {
        expect(getGridLadder(104, 4, 'none')).toMatchObject({ barStride: 1, drawBeats: false, drawSubdivisions: false });
    });
});
