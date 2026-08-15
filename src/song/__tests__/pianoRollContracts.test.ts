import { describe, expect, it } from 'vitest';
import {
    copyNotes,
    drawNotes,
    eraseNotes,
    moveNotes,
    noteBodyResizeEdge,
    noteDragFloor,
    noteResizeZone,
    quantizeNotes,
    resizeNotes,
    setVelocity,
    transposeNotes,
} from '../ops';
import type { Arrangement, ArrangementNote } from '../types';
import { applyVerbs } from '../verbs';

function arrangement(notes: ArrangementNote[] = [{ id: 'n0', tick: 0, durTick: 240, pitch: 60, vel: 40 }]): Arrangement {
    return {
        name: 'piano-roll-contracts', tempoBpm: 120, ppq: 960, graph: { nodes: [], connections: [] },
        sources: { midi: { id: 'midi', kind: 'midi', name: 'MIDI', lengthTick: 4000, notes } },
        tracks: [{ id: 'track', ref: 'instrument', clips: [{ id: 'clip', sourceId: 'midi', startTick: 100, sourceStart: 0, lengthTick: 960 }] }],
    };
}

const notesOf = (value: Arrangement) => {
    const source = value.sources!.midi!;
    if (source.kind !== 'midi') throw new Error('test fixture is not MIDI');
    return source.notes;
};

describe('BC-30 draw notes', () => {
    it('keeps the one-tick model backstop distinct from the ppq/128 drag floor', () => {
        const arr = arrangement([]);
        expect(noteDragFloor(960)).toBe(8);
        expect(drawNotes(arr, 'clip', [{ tick: 0, durTick: 0, pitch: 60 }], () => 'bad').verbs).toEqual([]);
        expect(drawNotes(arr, 'clip', [{ tick: 0, durTick: 1, pitch: 60 }], () => 'one').verbs).toHaveLength(1);
    });

    it('does not mint or insert an exact time/pitch duplicate', () => {
        let minted = 0;
        const result = drawNotes(arrangement(), 'clip', [{ tick: 0, durTick: 480, pitch: 60 }], () => `note-${minted++}`);
        expect(result.verbs).toEqual([]);
        expect(minted).toBe(0);
    });

    it.each([
        ['no neighbours', [], 100, 64],
        ['before sequence', [{ id: 'a', tick: 100, durTick: 10, pitch: 61, vel: 20 }], 0, 20],
        ['after sequence', [{ id: 'a', tick: 100, durTick: 10, pitch: 61, vel: 90 }], 200, 90],
        ['between neighbours', [{ id: 'a', tick: 0, durTick: 10, pitch: 61, vel: 20 }, { id: 'b', tick: 100, durTick: 10, pitch: 62, vel: 100 }], 25, 40],
    ])('computes automatic velocity: %s', (_label, existing, tick, expected) => {
        const arr = arrangement(existing as ArrangementNote[]);
        const result = applyVerbs(arr, drawNotes(arr, 'clip', [{ tick: tick as number, durTick: 20, pitch: 70 }], () => 'new').verbs).next;
        expect(notesOf(result).find((note) => note.id === 'new')!.vel).toBe(expected);
    });
});

describe('BC-31 note move and copy', () => {
    it('clamps a shared pitch/tick delta and extends the clip in the same batch', () => {
        const arr = arrangement([
            { id: 'lo', tick: 10, durTick: 100, pitch: 1 },
            { id: 'hi', tick: 900, durTick: 200, pitch: 120 },
        ]);
        const operation = moveNotes(arr, ['lo', 'hi'], -50, 20);
        const next = applyVerbs(arr, operation.verbs).next;
        expect(notesOf(next).map(({ tick, pitch }) => ({ tick, pitch }))).toEqual([{ tick: 0, pitch: 8 }, { tick: 890, pitch: 127 }]);
        expect(next.tracks[0]!.clips[0]!.lengthTick).toBe(1090);
    });

    it('copies with fresh ids and leaves originals untouched', () => {
        const arr = arrangement();
        const result = copyNotes(arr, ['n0'], 120, 12, () => 'copy');
        const next = applyVerbs(arr, result.verbs).next;
        expect(notesOf(next)).toEqual([
            { id: 'n0', tick: 0, durTick: 240, pitch: 60, vel: 40 },
            { id: 'copy', tick: 120, durTick: 240, pitch: 72, vel: 40 },
        ]);
    });
});

describe('BC-32 note resize', () => {
    it('implements the exact hit zones and generic quarter fallback', () => {
        expect(noteResizeZone(10, 0)).toBeUndefined();
        expect(noteResizeZone(20, 8)).toBe('start');
        expect(noteResizeZone(20, 12)).toBe('end');
        expect(noteResizeZone(40, 9)).toBeUndefined();
        expect(noteBodyResizeEdge(0.25)).toBe('start');
        expect(noteBodyResizeEdge(0.251)).toBe('end');
    });

    it('supports relative and absolute multi-note resize with a one-tick floor', () => {
        const arr = arrangement([{ id: 'a', tick: 100, durTick: 100, pitch: 60 }, { id: 'b', tick: 300, durTick: 200, pitch: 62 }]);
        const relative = applyVerbs(arr, resizeNotes(arr, ['a', 'b'], 'end', { deltaTick: 50, mode: 'relative' }).verbs).next;
        expect(notesOf(relative).map((note) => note.durTick)).toEqual([150, 250]);
        const absolute = applyVerbs(arr, resizeNotes(arr, ['a', 'b'], 'end', { at: 450, mode: 'absolute' }).verbs).next;
        expect(notesOf(absolute).map((note) => note.durTick)).toEqual([350, 150]);
        const floor = applyVerbs(arr, resizeNotes(arr, ['a'], 'end', { at: 0, mode: 'absolute' }).verbs).next;
        expect(notesOf(floor)[0]!.durTick).toBe(1);
    });
});

describe('BC-33 velocity gestures', () => {
    it('supports one/ten steps and rejects the whole non-smush request at a boundary', () => {
        const arr = arrangement([{ id: 'a', tick: 0, durTick: 10, pitch: 60, vel: 118 }, { id: 'b', tick: 20, durTick: 10, pitch: 62, vel: 127 }]);
        expect(setVelocity(arr, ['a'], { mode: 'delta', amount: 1 }).verbs).toEqual([{ kind: 'editNote', noteId: 'a', patch: { vel: 119 } }]);
        expect(setVelocity(arr, ['a'], { mode: 'delta', amount: -10 }).verbs).toEqual([{ kind: 'editNote', noteId: 'a', patch: { vel: 108 } }]);
        expect(setVelocity(arr, ['a', 'b'], { mode: 'delta', amount: 1 })).toMatchObject({ verbs: [], rejected: expect.any(String) });
        expect(setVelocity(arr, ['a', 'b'], { mode: 'delta', amount: 10, smush: true }).verbs).toHaveLength(2);
    });

    it('lowers an arbitrarily dense ramp to one verb batch', () => {
        const source = Array.from({ length: 200 }, (_, index) => ({ id: `n${index}`, tick: index * 10, durTick: 5, pitch: 60, vel: 64 }));
        expect(setVelocity(arrangement(source), source.map((note) => note.id), { mode: 'ramp', from: 1, to: 127 }).verbs).toHaveLength(200);
    });
});

describe('BC-34 erase and overlap policy', () => {
    it('truncates an existing same-pitch note by default and one inverse restores both side effects', () => {
        const arr = arrangement();
        const changed = applyVerbs(arr, drawNotes(arr, 'clip', [{ tick: 120, durTick: 240, pitch: 60, vel: 80 }], () => 'drawn').verbs);
        expect(notesOf(changed.next)).toEqual([{ id: 'n0', tick: 0, durTick: 120, pitch: 60, vel: 40 }, { id: 'drawn', tick: 120, durTick: 240, pitch: 60, vel: 80 }]);
        expect(applyVerbs(changed.next, changed.inverse).next).toEqual(arr);
        expect(eraseNotes(changed.next, { noteIds: ['drawn'] }).verbs).toEqual([{ kind: 'removeNote', noteId: 'drawn' }]);
    });

    it('reject policy leaves the model untouched', () => {
        const arr = arrangement();
        const result = drawNotes(arr, 'clip', [{ tick: 120, durTick: 240, pitch: 60 }], () => 'drawn', 'reject');
        expect(result).toMatchObject({ verbs: [], rejected: expect.any(String) });
    });
});

describe('BC-35 keyboard note transforms', () => {
    it('transposes semitones/octaves and rejects a whole selection past 0/127', () => {
        const arr = arrangement([{ id: 'a', tick: 0, durTick: 10, pitch: 1 }, { id: 'b', tick: 20, durTick: 10, pitch: 120 }]);
        expect(transposeNotes(arr, ['a'], 12).verbs[0]).toMatchObject({ patch: { pitch: 13 } });
        expect(transposeNotes(arr, ['a', 'b'], 12)).toMatchObject({ verbs: [], rejected: expect.any(String) });
    });
});

describe('BC-36 step entry lowering', () => {
    it('lowers a chord keystroke through one draw-note batch', () => {
        const arr = arrangement([]);
        let id = 0;
        const result = drawNotes(arr, 'clip', [60, 64, 67].map((pitch) => ({ tick: 240, durTick: 240, pitch, vel: 70 })), () => `step-${id++}`);
        expect(result.verbs).toHaveLength(3);
        expect(applyVerbs(arr, result.verbs).inverse).toHaveLength(3);
    });
});

describe('BC-37 Ardour-rule quantize', () => {
    it.each([
        ['full start', { startGrid: 240 }, { tick: 0 }],
        ['50% start', { startGrid: 240, strength: 50 }, { tick: 50 }],
        ['end length ignores 50% strength', { startGrid: 240, endGrid: 240, snapEnd: true, strength: 50 }, { tick: 50, durTick: 480 }],
        ['end-only still uses candidate start', { startGrid: 240, endGrid: 240, snapStart: false, snapEnd: true }, { durTick: 480 }],
    ] as const)('%s', (_label, request, patch) => {
        const arr = arrangement([{ id: 'q', tick: 100, durTick: 300, pitch: 60 }]);
        expect(quantizeNotes(arr, ['q'], request).verbs).toEqual([{ kind: 'editNote', noteId: 'q', patch }]);
    });

    it('displaces alternating grid points by swing × grid / 300', () => {
        const arr = arrangement([{ id: 'q', tick: 200, durTick: 100, pitch: 60 }]);
        expect(quantizeNotes(arr, ['q'], { startGrid: 240, swing: 66 }).verbs).toEqual([
            { kind: 'editNote', noteId: 'q', patch: { tick: 293 } },
        ]);
    });

    it('uses inclusive threshold, one end-grid for zero duration, and no verbs with both flags off', () => {
        const threshold = arrangement([{ id: 'q', tick: 200, durTick: 40, pitch: 60 }]);
        expect(quantizeNotes(threshold, ['q'], { startGrid: 240, threshold: 40 }).verbs[0]).toMatchObject({ patch: { tick: 240 } });
        const zero = arrangement([{ id: 'q', tick: 100, durTick: 10, pitch: 60 }]);
        expect(quantizeNotes(zero, ['q'], { startGrid: 240, endGrid: 120, snapEnd: true }).verbs[0]).toMatchObject({ patch: { durTick: 120 } });
        expect(quantizeNotes(zero, ['q'], { startGrid: 240, snapStart: false, snapEnd: false }).verbs).toEqual([]);
    });
});
