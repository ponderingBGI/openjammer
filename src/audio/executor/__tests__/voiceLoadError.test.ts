/**
 * ERR-1 / REV-1 gate: the per-node default-voice load-error flag.
 *
 * `setNodeVoiceLoadError` is how a FAILING instrument node surfaces its own
 * non-focus-stealing "!" badge when the engine could not build its built-in
 * default voice (DEFECT 3). Two invariants matter:
 *
 *  1. It writes the flag onto `node.data` (so the UI can show it) but ONLY when
 *     the value actually changes — engine-derived runtime state, not a user edit.
 *  2. It does NOT create an undo-history entry, so a transient load error never
 *     pollutes Ctrl+Z (REV-1).
 *
 * (2) used to be stated here and CONTRADICTED three lines down: a test called
 * "records graph mutations in the unified history" asserted `entries.length`
 * grew by exactly 2. Both cannot be true, and the test was the honest one —
 * being outside `begin/endGesture` never kept a write out of history, because
 * `graphStore`'s `set` wrapper diffs and records every graph mutation that is
 * not a replay. So a built-in voice failing mid-set spent the player's next
 * `Ctrl+Z` on un-flagging a badge. W6-SHIP made the doc comment true instead of
 * the test, with the `{ record: false }` opt-out, and this file now pins the
 * grows-by-ZERO shape in both directions.
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

    it('grows the undo history by ZERO — the engine is not the player', () => {
        const id = addKeys();
        const before = useHistoryStore.getState().entries.length;

        setNodeVoiceLoadError(id, true);
        setNodeVoiceLoadError(id, false);

        expect(useHistoryStore.getState().entries.length).toBe(before);
    });

    it('leaves the player their own last edit to undo', () => {
        // The failure spelled out: the player sets a volume, a voice fails to
        // build, and `Ctrl+Z` un-flags the badge instead of undoing the volume.
        const keysId = addKeys();
        useGraphStore.getState().addNode('speaker', { x: 400, y: 0 });
        const speakerId = Array.from(useGraphStore.getState().nodes.values())
            .find((n) => n.type === 'speaker')!.id;
        useHistoryStore.getState().clear();

        useGraphStore.getState().updateNodeData(speakerId, { volume: 0.25 });
        setNodeVoiceLoadError(keysId, true);

        expect(useHistoryStore.getState().entries).toHaveLength(1);
        useGraphStore.getState().undo();
        expect(
            (useGraphStore.getState().nodes.get(speakerId)!.data as { volume?: number }).volume,
        ).not.toBe(0.25);
        // …and the badge is still up: undo did not un-report a real failure.
        expect(
            (useGraphStore.getState().nodes.get(keysId)!.data as InstrumentNodeData).voiceLoadError,
        ).toBe(true);
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
