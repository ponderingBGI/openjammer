import { describe, expect, it } from 'vitest';
import { clipGeometry, tickToPx, virtualizationWindow } from '../geometry';

describe('arrangement clip geometry', () => {
    it('maps ticks to pixels relative to the visible origin', () => {
        expect(tickToPx(960, 480, 0.25)).toBe(120);
        expect(clipGeometry(960, 1920, 480, 0.25)).toEqual({ left: 120, width: 480 });
    });
});

describe('arrangement lane virtualization boundaries', () => {
    const windowFor = (heights: number[], top: number, height = 100) => virtualizationWindow(heights, { left: 0, top: top + 64, width: 800, height: height + 64 }, 1, 200, 64);

    it('handles zero lanes and a viewport below every lane', () => {
        expect(windowFor([], 0)).toMatchObject({ offsets: [0], firstLane: 0, lastLane: 0 });
        expect(windowFor([40, 50], 500)).toMatchObject({ firstLane: 1, lastLane: 2 });
    });

    it('uses half-open exact boundaries and mixed automation heights', () => {
        expect(windowFor([40, 120, 60], 40, 120)).toMatchObject({ firstLane: 0, lastLane: 3 });
        expect(windowFor([40, 120, 60], 160, 1)).toMatchObject({ firstLane: 1, lastLane: 3 });
    });

    it('recomputes safely when lane heights change during scroll', () => {
        const before = windowFor([72, 72, 72, 72], 150, 80);
        const after = windowFor([72, 240, 72, 72], 150, 80);
        expect(before.firstLane).toBe(1);
        expect(after.firstLane).toBe(0);
        expect(after.lastLane).toBeGreaterThan(after.firstLane);
    });
});
