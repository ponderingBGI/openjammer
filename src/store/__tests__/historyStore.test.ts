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
