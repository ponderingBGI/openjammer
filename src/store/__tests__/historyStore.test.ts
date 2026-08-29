import { beforeEach, describe, expect, it } from 'vitest';
import { useHistoryStore } from '../historyStore';
import { useGraphStore } from '../graphStore';
import { useArrangementStore } from '../arrangementStore';
import type { Arrangement } from '../../song/types';

const seed: Arrangement = {
    name: 'history', tempoBpm: 120, ppq: 960,
    graph: { nodes: [], connections: [] },
    sources: { midi: { id: 'midi', kind: 'midi', name: 'midi', lengthTick: 3840, notes: [{ tick: 0, durTick: 120, pitch: 60 }] } },
    tracks: [{ ref: 'keys', clips: [{ sourceId: 'midi', startTick: 0, lengthTick: 3840 }] }],
};

/** The loop arm a document lands with when nobody asks for anything else. */
const OFF = { loopEnabled: false, loopOn: false };

describe('BC-01 unified gesture transaction', () => {
    beforeEach(() => {
        useGraphStore.setState({ nodes: new Map(), connections: new Map(), connectionsByNode: new Map(), rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(), clipboard: null, version: 0 });
        useArrangementStore.getState().setArrangement(seed);
        useHistoryStore.getState().clear();
    });

    it('flattens nested transactions and abort rolls back byte-exactly', () => {
        const graph = useGraphStore.getState();
        graph.addNode('effect', { x: 0, y: 0 });
        const id = useGraphStore.getState().rootNodeIds[0]!;
        const before = structuredClone(useGraphStore.getState().nodes.get(id));
        const cursor = useHistoryStore.getState().cursor;
        graph.beginGesture();
        graph.beginGesture();
        graph.updateNodeData(id, { rate: 2 });
        graph.endGesture();
        useHistoryStore.getState().abort();
        expect(useGraphStore.getState().nodes.get(id)).toEqual(before);
        expect(useHistoryStore.getState().cursor).toBe(cursor);
    });

    it('interleaves graph, clip, and note edits and undoes in reverse byte-exact order', () => {
        const graphBefore = new Map(useGraphStore.getState().nodes);
        useGraphStore.getState().addNode('effect', { x: 3, y: 4 });
        const graphAfter = new Map(useGraphStore.getState().nodes);
        const arrangement0 = structuredClone(useArrangementStore.getState().arrangement!);
        const clip = arrangement0.tracks[0]!.clips[0]!;
        useArrangementStore.getState().apply({ kind: 'moveClip', clipId: clip.id!, startTick: 240 });
        const arrangement1 = structuredClone(useArrangementStore.getState().arrangement!);
        const source = arrangement1.sources!.midi!;
        if (source.kind !== 'midi') throw new Error('expected midi');
        useArrangementStore.getState().apply({ kind: 'editNote', noteId: source.notes[0]!.id!, patch: { pitch: 64 } });
        useHistoryStore.getState().undo();
        expect(useArrangementStore.getState().arrangement).toEqual(arrangement1);
        useHistoryStore.getState().undo();
        expect(useArrangementStore.getState().arrangement).toEqual(arrangement0);
        useHistoryStore.getState().undo();
        expect(useGraphStore.getState().nodes).toEqual(graphBefore);
        expect(graphAfter.size).toBeGreaterThan(graphBefore.size);
    });

    it('cleanCursor follows save position and undoing to it is clean', () => {
        useHistoryStore.getState().markClean();
        expect(useHistoryStore.getState().isDirty()).toBe(false);
        useGraphStore.getState().addNode('effect', { x: 0, y: 0 });
        expect(useHistoryStore.getState().isDirty()).toBe(true);
        useHistoryStore.getState().undo();
        expect(useHistoryStore.getState().isDirty()).toBe(false);
    });
});

/**
 * W6-P10 · the `document` domain.
 *
 * A `Verb` edits an Arrangement that already exists. Installing a preset rig
 * has to cross null→song (and song→song) inside ONE entry, so the log carries a
 * snapshot verb for that one shape. These pin the rules that make it safe: the
 * clear-on-open law it must not break, order-preserving application in both
 * directions, and the loop arm travelling with the document it belongs to.
 */
describe('W6-P10 document swaps in the command-log', () => {
    beforeEach(() => {
        useGraphStore.setState({ nodes: new Map(), connections: new Map(), connectionsByNode: new Map(), rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(), clipboard: null, version: 0 });
        useArrangementStore.getState().setArrangement(null);
        useHistoryStore.getState().clear();
    });

    it('still CLEARS the log when a document is simply opened', () => {
        // The law that has to survive the new option: undo must never reach
        // across a document boundary and put half of one song inside another.
        useGraphStore.getState().addNode('effect', { x: 0, y: 0 });
        expect(useHistoryStore.getState().entries.length).toBeGreaterThan(0);

        useArrangementStore.getState().setArrangement(seed);
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().cursor).toBe(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('keeps the log, and records the swap, when it is part of a bigger gesture', () => {
        // Outside an open gesture this mints its own standalone entry — the
        // documented shape (`setArrangement`'s JSDoc), and what makes this test
        // able to read the recorded verb pair directly.
        useArrangementStore.getState().setArrangement(seed, { preserveHistory: true });
        const [entry] = useHistoryStore.getState().entries;
        expect(entry?.verbs).toEqual([{ domain: 'document', verb: { kind: 'setArrangement', arrangement: useArrangementStore.getState().arrangement, transport: OFF } }]);
        expect(entry?.inverse).toEqual([{ domain: 'document', verb: { kind: 'setArrangement', arrangement: null, transport: OFF } }]);

        useHistoryStore.getState().undo();
        expect(useArrangementStore.getState().arrangement).toBeNull();
        // Replaying the swap must not append a second entry.
        expect(useHistoryStore.getState().entries).toHaveLength(1);
    });

    it('applies a swap and the verbs around it in the order they were recorded', () => {
        // The constraint, in BOTH directions. `record` appends verbs and
        // PREPENDS inverses, so the same entry arrives as `[document, ...verbs]`
        // going forward and `[...invVerbs, document]` coming back. Forward the
        // swap must land FIRST (the verbs edit the song it brought in); on undo
        // it must land LAST (the inverse verbs still belong to the song being
        // taken away, and applying them to the restored document would corrupt
        // it). A single tempo is the witness for each direction.
        const previous = { ...seed, name: 'previous', tempoBpm: 120 };
        useArrangementStore.getState().setArrangement(previous);
        const loaded = { ...seed, name: 'swapped', tempoBpm: 120 };
        useHistoryStore.getState().record(
            [
                { domain: 'document', verb: { kind: 'setArrangement', arrangement: loaded, transport: OFF } },
                { domain: 'arrangement', verb: { kind: 'setTempo', tempoBpm: 132 } },
            ],
            [
                { domain: 'arrangement', verb: { kind: 'setTempo', tempoBpm: 100 } },
                { domain: 'document', verb: { kind: 'setArrangement', arrangement: previous, transport: OFF } },
            ],
            'Install rig',
            'arrangement',
        );

        // Undo: restore LAST. Document-first here would put `previous` back and
        // then stamp 100 bpm on it — the player's own song, edited by an undo.
        useHistoryStore.getState().undo();
        expect(useArrangementStore.getState().arrangement?.name).toBe('previous');
        expect(useArrangementStore.getState().arrangement?.tempoBpm).toBe(120);

        // Redo: swap FIRST. Verbs-first here would apply 132 to `previous` and
        // then throw it away with the snapshot, landing on 120.
        useHistoryStore.getState().redo();
        expect(useArrangementStore.getState().arrangement?.name).toBe('swapped');
        expect(useArrangementStore.getState().arrangement?.tempoBpm).toBe(132);
    });

    it('resets the loop arm on an ordinary document open, and carries it on a preserved swap', () => {
        // The law that has to survive the snapshot's new `transport` field:
        // opening a document by hand still lands with the loop OFF, whatever
        // the player had armed for the song before it.
        useArrangementStore.getState().setArrangement(seed);
        useArrangementStore.getState().setLoopEnabled(true);
        useArrangementStore.getState().setArrangement({ ...seed, name: 'plain open' });
        expect(useArrangementStore.getState().loopEnabled).toBe(false);

        // A preserved swap asked to arrive armed does, and says so in the log.
        useArrangementStore.getState().setArrangement(seed, {
            preserveHistory: true,
            transport: { loopEnabled: true, loopOn: false },
        });
        expect(useArrangementStore.getState().loopEnabled).toBe(true);
        const [entry] = useHistoryStore.getState().entries;
        const forward = entry?.verbs[0];
        expect(forward?.domain === 'document' && forward.verb.transport).toEqual({ loopEnabled: true, loopOn: false });
        const back = entry?.inverse[0];
        expect(back?.domain === 'document' && back.verb.transport).toEqual(OFF);
    });
});
