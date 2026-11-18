/**
 * TA2d must-fix 4 — `I` / `O` at the song start emitted an invalid verb.
 *
 * TA2c's `arrangement.loopOut` computed `startTick: Math.min(loop?.startTick ?? 0,
 * tick - 1)`, which is `-1` with the playhead at 1.1, and `applyVerb` throws
 * "location cannot start below zero" as an uncaught page error — mid-set, from a
 * single keystroke. The edge setters now clamp: never below zero, never shorter
 * than one grid unit, symmetric for both edges.
 */

import { describe, expect, it } from 'vitest';
import { loopRangeForEdge } from '../ops';
import { applyVerb } from '../verbs';
import { buildPaperSketch } from '../songs/paperSketch';
import { arrangementLengthTicks } from '../time';

const BAR = 3840;

describe('loopRangeForEdge', () => {
    it('O at tick 0 yields a legal one-unit range instead of startTick -1', () => {
        expect(loopRangeForEdge(undefined, 0, 'out', BAR)).toEqual({ startTick: 0, endTick: BAR });
        expect(loopRangeForEdge({ startTick: 0, endTick: 7680 }, 0, 'out', BAR)).toEqual({ startTick: 0, endTick: BAR });
    });

    it('I at tick 0 yields the symmetric one-unit range', () => {
        expect(loopRangeForEdge(undefined, 0, 'in', BAR)).toEqual({ startTick: 0, endTick: BAR });
        expect(loopRangeForEdge({ startTick: 0, endTick: 7680 }, 0, 'in', BAR)).toEqual({ startTick: 0, endTick: 7680 });
    });

    it('keeps the far edge when it is already legal', () => {
        expect(loopRangeForEdge({ startTick: BAR, endTick: 4 * BAR }, 2 * BAR, 'in', BAR)).toEqual({ startTick: 2 * BAR, endTick: 4 * BAR });
        expect(loopRangeForEdge({ startTick: BAR, endTick: 4 * BAR }, 6 * BAR, 'out', BAR)).toEqual({ startTick: BAR, endTick: 6 * BAR });
    });

    it('pulls the far edge in rather than inverting the range', () => {
        // O before the existing start: the start follows to keep one unit of length.
        expect(loopRangeForEdge({ startTick: 8 * BAR, endTick: 9 * BAR }, 2 * BAR, 'out', BAR)).toEqual({ startTick: BAR, endTick: 2 * BAR });
        // I after the existing end: the end follows.
        expect(loopRangeForEdge({ startTick: 0, endTick: BAR }, 8 * BAR, 'in', BAR)).toEqual({ startTick: 8 * BAR, endTick: 9 * BAR });
    });

    it('survives a zero, negative or non-finite grid unit and a negative tick', () => {
        expect(loopRangeForEdge(undefined, -50, 'out', 0)).toEqual({ startTick: 0, endTick: 1 });
        expect(loopRangeForEdge(undefined, -50, 'in', Number.NaN)).toEqual({ startTick: 0, endTick: 1 });
        expect(loopRangeForEdge(undefined, Number.NaN, 'out', -10)).toEqual({ startTick: 0, endTick: 1 });
    });

    it('emits a verb the document actually accepts, at tick 0 and at the song end', () => {
        const arrangement = buildPaperSketch();
        const songEnd = arrangementLengthTicks(arrangement);
        for (const [tick, edge] of [[0, 'out'], [0, 'in'], [songEnd, 'out'], [songEnd, 'in']] as const) {
            const range = loopRangeForEdge({ startTick: 0, endTick: BAR }, tick, edge, BAR);
            expect(range.startTick).toBeGreaterThanOrEqual(0);
            expect(range.endTick - range.startTick).toBeGreaterThanOrEqual(BAR);
            expect(() => applyVerb(arrangement, { kind: 'setLoopRange', location: { id: 'loop-1', name: 'Loop', kind: 'loop', ...range } })).not.toThrow();
        }
    });
});
