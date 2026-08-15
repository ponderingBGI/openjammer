import { describe, expect, it } from 'vitest';
import { clipGeometry, tickToPx } from '../geometry';

describe('arrangement clip geometry', () => {
    it('maps ticks to pixels relative to the visible origin', () => {
        expect(tickToPx(960, 480, 0.25)).toBe(120);
        expect(clipGeometry(960, 1920, 480, 0.25)).toEqual({ left: 120, width: 480 });
    });
});
