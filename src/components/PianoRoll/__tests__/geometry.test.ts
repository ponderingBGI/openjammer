import { describe, expect, it } from 'vitest';
import { clippedNoteGeometry, pitchRowHeight, resizeEdge, shouldAutoDetectDrums, velocityOpacity } from '../geometry';

describe('piano-roll geometry', () => {
    it('BC-32 exposes resize zones only above 10px and caps them at 8px', () => {
        expect(resizeEdge(1, 10)).toBeNull();
        expect(resizeEdge(7, 30)).toBe('start');
        expect(resizeEdge(9, 30)).toBeNull();
        expect(resizeEdge(23, 30)).toBe('end');
    });

    it('maps velocity to opacity without changing note geometry', () => {
        expect(velocityOpacity(0)).toBeCloseTo(0.45);
        expect(velocityOpacity(127)).toBe(1);
        expect(velocityOpacity(64)).toBeGreaterThan(velocityOpacity(32));
    });

    it('clips source notes to the visible clip window', () => {
        expect(clippedNoteGeometry({ tick: 80, durTick: 40, pitch: 60 }, 1000, 100, 200, 0.5)).toEqual({ left: 500, width: 10 });
        expect(clippedNoteGeometry({ tick: 310, durTick: 20, pitch: 60 }, 1000, 100, 200, 0.5)).toBeNull();
    });

    it('auto-detects a compact GM drum pitch set only', () => {
        expect(shouldAutoDetectDrums([{ tick: 0, durTick: 1, pitch: 36 }, { tick: 10, durTick: 1, pitch: 42 }])).toBe(true);
        expect(shouldAutoDetectDrums([{ tick: 0, durTick: 1, pitch: 20 }])).toBe(false);
        expect(shouldAutoDetectDrums([])).toBe(false);
    });

    it('keeps pitched rows in the 3px to 16px contract range', () => {
        expect(pitchRowHeight(40, { lo: 0, hi: 127 }, false)).toBe(3);
        expect(pitchRowHeight(600, { lo: 60, hi: 71 }, false)).toBe(16);
        expect(pitchRowHeight(20, { lo: 35, hi: 81 }, true)).toBe(18);
    });
});
