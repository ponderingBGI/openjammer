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
