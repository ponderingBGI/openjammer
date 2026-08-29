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
        // W4-TBb: the floor rose 0.45 -> 0.68. At 0.45 the softest note composited
        // to 1.65:1 against a white-key row, so the primary object of this editor
        // failed WCAG 1.4.11 at every velocity below maximum. The composited floor
        // itself is gated in `Arrangement/__tests__/contrast.test.ts`; this pins
        // the shape of the ramp: monotonic, clamped, and exactly 1 at 127.
        expect(velocityOpacity(0)).toBeCloseTo(0.68);
        expect(velocityOpacity(127)).toBe(1);
        expect(velocityOpacity(64)).toBeGreaterThan(velocityOpacity(32));
        expect(velocityOpacity(-40)).toBeCloseTo(0.68);
        expect(velocityOpacity(400)).toBe(1);
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

    it('keeps pitched rows in the 6px to 22px hit-testable contract range', () => {
        // Spec 2.7: clamp(6, fit, 22). The ceiling rose from 16 in W4-TB so a
        // narrow pitch range fills the surface instead of floating above a third
        // of it; the 6px floor (D18) is unchanged — it is the pointer contract.
        expect(pitchRowHeight(40, { lo: 0, hi: 127 }, false)).toBe(6);
        expect(pitchRowHeight(600, { lo: 60, hi: 71 }, false)).toBe(22);
        expect(pitchRowHeight(20, { lo: 35, hi: 81 }, true)).toBe(18);
    });
});
