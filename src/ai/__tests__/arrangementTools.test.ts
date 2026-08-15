import { beforeEach, describe, expect, it } from 'vitest';
import { applyToolCall, type ArrangementToolPort, type DspNodeRegistrar } from '../tools';
import { createArrangementPort } from '../arrangementAdapter';
import type { GraphStoreApi } from '../graphAdapter';
import { useArrangementStore } from '../../store/arrangementStore';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import type { Verb } from '../../song/verbs';

// The timeline handlers touch neither the graph store nor the registrar.
const dummyStore = {} as unknown as GraphStoreApi;
const dummyReg = { registerDspNode: () => () => {} } as unknown as DspNodeRegistrar;

describe('agent timeline tools — dispatch through applyToolCall', () => {
    it('describe_arrangement relays the song summary from the port', () => {
        const port: ArrangementToolPort = {
            describe: () => ({ text: 'SUMMARY' }),
            apply: () => ({ ok: true, summary: '', undo: () => {} }),
        };
        const r = applyToolCall(
            { name: 'describe_arrangement', args: {} },
            dummyStore,
            dummyReg,
            undefined,
            undefined,
            port,
        );
        expect(r.ok).toBe(true);
        expect(r.data).toEqual({ text: 'SUMMARY' });
    });

    it('edit_timeline forwards the verbs to the port', () => {
        let seen: Verb[] | null = null;
        const port: ArrangementToolPort = {
            describe: () => null,
            apply: (verbs) => {
                seen = verbs;
                return { ok: true, summary: `n=${verbs.length}`, undo: () => {} };
            },
        };
        const r = applyToolCall(
            { name: 'edit_timeline', args: { verbs: [{ kind: 'setTempo', tempoBpm: 100 }] } },
            dummyStore,
            dummyReg,
            undefined,
            undefined,
            port,
        );
        expect(r.ok).toBe(true);
        expect(seen).toEqual([{ kind: 'setTempo', tempoBpm: 100 }]);
    });

    it('edit_timeline forwards shared operation names to the op layer', () => {
        let seen = '';
        const port: ArrangementToolPort = {
            describe: () => null,
            apply: () => ({ ok: true, summary: '', undo: () => {} }),
            applyOps: (ops) => { seen = ops[0]!.op; return { ok: true, summary: '', undo: () => {} }; },
        };
        const result = applyToolCall({ name: 'edit_timeline', args: { ops: [{ op: 'nudge', clipIds: ['c'], amount: 240, direction: 1 }] } }, dummyStore, dummyReg, undefined, undefined, port);
        expect(result.ok).toBe(true);
        expect(seen).toBe('nudge');
    });

    it('both tools degrade cleanly when no timeline port is wired', () => {
        const d = applyToolCall({ name: 'describe_arrangement', args: {} }, dummyStore, dummyReg);
        expect(d.ok).toBe(true);
        expect(d.data).toBeNull();
        // edit is fail-closed: no port = no edit (never a silent drop).
        const e = applyToolCall({ name: 'edit_timeline', args: { verbs: [] } }, dummyStore, dummyReg);
        expect(e.ok).toBe(false);
    });
});

describe('createArrangementPort — live binding to the arrangement store', () => {
    beforeEach(() => useArrangementStore.getState().setArrangement(buildPaperSketch()));

    it('describe returns the real song summary', () => {
        expect(createArrangementPort().describe()?.text).toContain('Paper Sketch No. 1');
    });

    it('applies verbs, MINTS ids for adds, and undoes the whole call with one step', () => {
        const port = createArrangementPort();
        const trackId = useArrangementStore.getState().arrangement!.tracks[0]!.id!;
        const sourceId = useArrangementStore.getState().arrangement!.tracks[0]!.clips[0]!.sourceId;
        const res = port.apply([
            { kind: 'setTempo', tempoBpm: 96 },
            // an addClip with NO id — the adapter mints it so the inverse can name it.
            { kind: 'addClip', trackId, clip: { sourceId, startTick: 20_000, lengthTick: 240 } },
        ]);
        expect(res.ok).toBe(true);

        const arr = useArrangementStore.getState().arrangement!;
        expect(arr.tempoBpm).toBe(96);
        const added = arr.tracks[0]!.clips[1]!;
        expect(added.id).toBeTruthy(); // minted

        // One undo reverts the WHOLE edit_timeline call (tempo + clip).
        res.undo();
        const after = useArrangementStore.getState().arrangement!;
        expect(after.tempoBpm).toBe(84);
        expect(after.tracks[0]!.clips).toHaveLength(1); // the added clip is gone
    });

    it('fails closed when no song is open', () => {
        useArrangementStore.getState().setArrangement(null);
        const res = createArrangementPort().apply([{ kind: 'setTempo', tempoBpm: 100 }]);
        expect(res.ok).toBe(false);
    });

    it('shared moveClips op matches the hand op and is one undo step', () => {
        const clip = useArrangementStore.getState().arrangement!.tracks[0]!.clips[0]!;
        const before = structuredClone(useArrangementStore.getState().arrangement!);
        const result = createArrangementPort().applyOps!([{ op: 'moveClips', clipIds: [clip.id!], deltaTick: 240 }]);
        expect(result.ok).toBe(true);
        expect(useArrangementStore.getState().arrangement!.tracks[0]!.clips[0]!.startTick).toBe(240);
        result.undo();
        expect(useArrangementStore.getState().arrangement).toEqual(before);
    });

    it('BC-30..37 dispatches the public piano-note ops through the shared lowering layer', () => {
        const port = createArrangementPort();
        const before = structuredClone(useArrangementStore.getState().arrangement!);
        const clip = before.tracks[0]!.clips[0]!;
        const source = before.sources![clip.sourceId]!;
        if (source.kind !== 'midi') throw new Error('fixture clip must be MIDI');
        const target = source.notes[0]!;

        const result = port.applyOps!([
            { op: 'drawNote', clipId: clip.id!, note: { tick: 123, durTick: 61, pitch: 73, vel: 55 } },
            { op: 'setVelocity', noteIds: [target.id!], mode: 'set', amount: 77 },
            { op: 'transposeNotes', noteIds: [target.id!], semitones: 1 },
            { op: 'quantizeNotes', targets: [target.id!], grid: 240, strength: 100 },
        ]);

        expect(result.ok).toBe(true);
        const nextSource = useArrangementStore.getState().arrangement!.sources![clip.sourceId]!;
        if (nextSource.kind !== 'midi') throw new Error('edited source must remain MIDI');
        expect(nextSource.notes).toContainEqual(expect.objectContaining({ tick: 123, durTick: 61, pitch: 73, vel: 55 }));
        expect(nextSource.notes.find((note) => note.id === target.id)).toEqual(expect.objectContaining({ vel: 77, pitch: target.pitch + 1 }));
        result.undo();
        const undone = useArrangementStore.getState().arrangement!;
        // Id minting is deliberately monotonic across undo; the song content is exact.
        expect({ ...undone, idCounter: before.idCounter }).toEqual(before);
    });

    it('a bad verb fails the call atomically (no partial apply)', () => {
        const port = createArrangementPort();
        const before = useArrangementStore.getState().arrangement!.tempoBpm;
        const res = port.apply([
            { kind: 'setTempo', tempoBpm: 70 },
            { kind: 'removeClip', clipId: 'ghost' }, // references a missing id -> throws
        ]);
        expect(res.ok).toBe(false);
        // Nothing committed: the first verb did not land either (applyVerbs is atomic).
        expect(useArrangementStore.getState().arrangement!.tempoBpm).toBe(before);
    });
});
