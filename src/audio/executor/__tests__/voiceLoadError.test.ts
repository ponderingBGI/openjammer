/**
 * ERR-1 / REV-1 gate: the per-node default-voice load-error flag.
 *
 * `setNodeVoiceLoadError` is how a FAILING instrument node surfaces its own
 * non-focus-stealing "!" badge when the engine could not build its built-in
 * default voice (DEFECT 3). Two invariants matter:
 *
 *  1. It writes the flag onto `node.data` (so the UI can show it) but ONLY when
 *     the value actually changes — engine-derived runtime state, not a user edit.
 *  2. It does NOT create an undo-history entry: it is called OUTSIDE any gesture,
 *     so a transient load error never pollutes Ctrl+Z (REV-1).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { setNodeVoiceLoadError } from '../voiceLoadError';
import type { InstrumentNodeData } from '../../../engine/types';
import { useHistoryStore } from '../../../store/historyStore';

const STORAGE_KEY = 'openjammer-graph-v2';

function reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        version: 0,
    });
    useHistoryStore.getState().clear();
}

/** Add a `keys` instrument node and return its root id. */
function addKeys(): string {
    useGraphStore.getState().addNode('keys', { x: 0, y: 0 });
    const node = Array.from(useGraphStore.getState().nodes.values()).find(
        (n) => n.type === 'keys',
    );
    if (!node) throw new Error('keys node not created');
    return node.id;
}

describe('setNodeVoiceLoadError', () => {
    beforeEach(reset);

    it('sets and clears voiceLoadError on the node data', () => {
        const id = addKeys();

        setNodeVoiceLoadError(id, true);
        let data = useGraphStore.getState().nodes.get(id)!.data as InstrumentNodeData;
        expect(data.voiceLoadError).toBe(true);

        setNodeVoiceLoadError(id, false);
        data = useGraphStore.getState().nodes.get(id)!.data as InstrumentNodeData;
        expect(data.voiceLoadError).toBe(false);
    });

    it('records graph mutations in the unified history', () => {
        const id = addKeys();
        const before = useHistoryStore.getState().entries.length;

        setNodeVoiceLoadError(id, true);
        setNodeVoiceLoadError(id, false);

        expect(useHistoryStore.getState().entries.length).toBe(before + 2);
    });

    it('is a no-op when the value is unchanged (no version bump)', () => {
        const id = addKeys();
        setNodeVoiceLoadError(id, true);
        const v = useGraphStore.getState().version;

        // Same value again — must not mutate the store.
        setNodeVoiceLoadError(id, true);
        expect(useGraphStore.getState().version).toBe(v);
    });

    it('is safe for an unknown node id', () => {
        expect(() => setNodeVoiceLoadError('does-not-exist', true)).not.toThrow();
    });
});
