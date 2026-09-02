/**
 * U11 — the Knife, one level down.
 *
 * The Song's knife is `splitAt`, which has always existed. Its twin on a note
 * did not, so the piano roll's `K` button was rendered, enabled, and did
 * nothing (HA-13). `splitNotes` closes that WITHOUT a new verb: the left half is
 * an `editNote` shortening the original — so its id, and any selection pointing
 * at it, survives the cut — and the right half is one `addNote`. Applied as one
 * batch, a cut is one Ctrl+Z.
 */

import { describe, expect, it } from 'vitest';
import { EDIT_OPS, splitNotes } from '../ops';
import type { Arrangement, ArrangementNote } from '../types';
import { applyVerbs } from '../verbs';

function arrangement(notes: ArrangementNote[] = [{ id: 'n0', tick: 0, durTick: 480, pitch: 60, vel: 90 }]): Arrangement {
    return {
        name: 'split-notes', tempoBpm: 120, ppq: 960, graph: { nodes: [], connections: [] },
        sources: { midi: { id: 'midi', kind: 'midi', name: 'MIDI', lengthTick: 4000, notes } },
        tracks: [{ id: 'track', ref: 'instrument', clips: [{ id: 'clip', sourceId: 'midi', startTick: 100, sourceStart: 0, lengthTick: 960 }] }],
    };
}

const notesOf = (value: Arrangement) => {
    const source = value.sources!.midi!;
    if (source.kind !== 'midi') throw new Error('test fixture is not MIDI');
    return source.notes;
};

describe('splitNotes', () => {
    it('cuts one note into two abutting halves that keep every other property', () => {
        const before = arrangement();
        const result = splitNotes(before, ['n0'], 200, () => 'n1');

        expect(result.verbs).toEqual([
            { kind: 'editNote', noteId: 'n0', patch: { durTick: 200 } },
            { kind: 'addNote', sourceId: 'midi', index: 1, note: { id: 'n1', tick: 200, durTick: 280, pitch: 60, vel: 90 } },
        ]);

        const after = notesOf(applyVerbs(before, result.verbs).next);
        expect(after).toHaveLength(2);
        // No gap, no overlap, and the pair spans exactly what the original did.
        expect(after[0]!.tick + after[0]!.durTick).toBe(after[1]!.tick);
        expect(after[1]!.tick + after[1]!.durTick).toBe(480);
        expect(after.map((note) => note.pitch)).toEqual([60, 60]);
        expect(after.map((note) => note.vel)).toEqual([90, 90]);
    });

    it('keeps the left half on the original id, and selects both halves', () => {
        const result = splitNotes(arrangement(), ['n0'], 200, () => 'n1');
        expect(result.selectedNoteIds).toEqual(['n0', 'n1']);
    });

    it('is one batch, so one inverse puts the note back whole', () => {
        const before = arrangement();
        const result = splitNotes(before, ['n0'], 200, () => 'n1');
        const applied = applyVerbs(before, result.verbs);
        const restored = applyVerbs(applied.next, [...applied.inverse].reverse());
        expect(notesOf(restored.next)).toEqual(notesOf(before));
    });

    /*
     * F3 — NO SLIVERS. The guard used to be exact-tick equality, so with the
     * snap suspended a press one tick inside a note's edge minted a fragment
     * about a pixel wide: under the draw floor, ungrabbable, and impossible to
     * undo by hand.
     */
    it('refuses a cut that would leave either half under the floor', () => {
        // Default floor: `noteDragFloor(960)` = 8 ticks.
        for (const at of [1, 7, 473, 479]) {
            const result = splitNotes(arrangement(), ['n0'], at, () => 'n1');
            expect(result.verbs, `at ${at}`).toEqual([]);
            expect(result.skipped).toEqual(['n0']);
        }
        expect(splitNotes(arrangement(), ['n0'], 8, () => 'n1').verbs).toHaveLength(2);
        expect(splitNotes(arrangement(), ['n0'], 472, () => 'n1').verbs).toHaveLength(2);
    });

    it('takes the caller’s floor — one snap unit, or 1/32 with snap off', () => {
        const grid = 240; // a sixteenth at ppq 960
        expect(splitNotes(arrangement(), ['n0'], 200, () => 'n1', grid).verbs).toEqual([]);
        expect(splitNotes(arrangement(), ['n0'], 240, () => 'n1', grid).verbs).toHaveLength(2);
        // 1/32 = ppq / 8 = 120: the finest cut a hand can ask for with Ctrl held.
        expect(splitNotes(arrangement(), ['n0'], 120, () => 'n1', 120).verbs).toHaveLength(2);
        expect(splitNotes(arrangement(), ['n0'], 119, () => 'n1', 120).verbs).toEqual([]);
    });

    it('refuses a cut on an edge rather than minting a zero-length note', () => {
        for (const at of [0, 480, -20, 900]) {
            const result = splitNotes(arrangement(), ['n0'], at, () => 'n1');
            expect(result.verbs, `at ${at}`).toEqual([]);
            expect(result.skipped).toEqual(['n0']);
        }
    });

    it('appends each half in order when several notes are cut at once (N5)', () => {
        const before = arrangement([
            { id: 'a', tick: 0, durTick: 480, pitch: 60, vel: 90 },
            { id: 'b', tick: 0, durTick: 480, pitch: 64, vel: 70 },
        ]);
        let minted = 0;
        const result = splitNotes(before, ['a', 'b'], 240, () => `x${minted++}`);
        const indices = result.verbs.filter((verb) => verb.kind === 'addNote').map((verb) => (verb as { index: number }).index);
        // Two source notes, so the halves append at 2 then 3 — not 2 twice,
        // which inserted the second half mid-array.
        expect(indices).toEqual([2, 3]);
        expect(notesOf(applyVerbs(before, result.verbs).next).map((note) => note.id)).toEqual(['a', 'b', 'x0', 'x1']);
    });

    it('cuts every note the tick actually crosses and skips the rest', () => {
        const before = arrangement([
            { id: 'a', tick: 0, durTick: 480, pitch: 60, vel: 90 },
            { id: 'b', tick: 0, durTick: 480, pitch: 64, vel: 70 },
            { id: 'c', tick: 300, durTick: 120, pitch: 67, vel: 70 },
        ]);
        let minted = 0;
        const result = splitNotes(before, ['a', 'b', 'c'], 240, () => `x${minted++}`);

        // `c` spans 300-420, so tick 240 is outside it entirely.
        expect(result.skipped).toEqual(['c']);
        expect(notesOf(applyVerbs(before, result.verbs).next)).toHaveLength(5);
    });

    it('is reachable by the agent, so hand and Pi speak one vocabulary (F7)', () => {
        expect(EDIT_OPS).toContain('splitNotes');
    });

    it('ignores an id that is not in the document', () => {
        const result = splitNotes(arrangement(), ['ghost'], 200, () => 'n1');
        expect(result.verbs).toEqual([]);
        expect(result.skipped).toEqual(['ghost']);
    });
});
