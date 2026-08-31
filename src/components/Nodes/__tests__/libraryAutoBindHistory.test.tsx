/**
 * W6-Z T4 — mounting a Library card is not an edit.
 *
 * `LibraryNode`'s auto-bind effect writes `libraryId` into `node.data` when a
 * project library already exists. `graphStore`'s `set` wrapper diffs EVERY graph
 * mutation and records a `setNodeData` verb, so that write — decided by the
 * environment, in an effect, before the player has touched anything — pushed an
 * undo entry. The player's next `Ctrl+Z`, reaching for the note or the cable
 * they just made, spent itself putting `libraryId` back to `undefined` and
 * changing nothing they could see. Undo belongs to the player.
 *
 * The fix is the smallest one that does not fork: `updateNodeData` grew an
 * OPT-IN `{ record: false }`, defaulting to recording, routed through the same
 * body and the same `rawSet` the recording wrapper already delegates to. So this
 * file pins all three halves of "smallest":
 *
 *  - the binding still HAPPENS (it is a real pin — `addLibrary` re-points
 *    `projectLibraryId`, so a card without it would jump folders under the
 *    player); it just does not land in history;
 *  - a USER edit through the very same action still records, so the hatch is an
 *    opt-in and not a blanket wrapper;
 *  - the engine's degraded-plugin flag, whose own doc comment always CLAIMED to
 *    be off the undo stack and never was, is off it now.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
    get: vi.fn(async (k: string) => idb.get(k)),
    set: vi.fn(async (k: string, v: unknown) => { idb.set(k, v); }),
    del: vi.fn(async (k: string) => { idb.delete(k); }),
    keys: vi.fn(async () => [...idb.keys()]),
}));

const fsa = vi.hoisted(() => ({
    restoreHandle: vi.fn(),
    verifyPermission: vi.fn(async () => true),
    persistHandle: vi.fn(async () => {}),
}));
vi.mock('../../../utils/fileSystemAccess', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/fileSystemAccess')>()),
    restoreHandle: fsa.restoreHandle,
    verifyPermission: fsa.verifyPermission,
    persistHandle: fsa.persistHandle,
}));

import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useLibraryStore } from '../../../store/libraryStore';
import { setNodePluginLoadError } from '../../../audio/executor/pluginLoadError';
import { LibraryNode } from '../LibraryNode';
import type { LibraryNodeData, NodeData } from '../../../engine/types';

/** A library that is READY and already scanned, so no filesystem effect fires. */
function seedProjectLibrary() {
    useLibraryStore.setState({
        libraries: {
            lib: {
                id: 'lib',
                name: 'Drums',
                rootPath: 'Drums',
                handleKey: 'lib-root',
                itemCount: 0,
                lastScanAt: 1,
                status: 'ready',
            } as never,
        },
        items: {},
        allTags: [],
        pinnedTags: [],
        activeFilterTag: null,
        scanProgress: null,
        projectLibraryId: 'lib',
    });
}

const faceProps = (id: string) => ({
    node: useGraphStore.getState().nodes.get(id)!,
    hasConnection: () => false,
    handleHeaderMouseDown: () => {},
    handleNodeMouseEnter: () => {},
    handleNodeMouseLeave: () => {},
    isSelected: false,
    isDragging: false,
    isHoveredWithConnections: false,
    style: {},
});

beforeEach(() => {
    idb.clear();
    fsa.restoreHandle.mockReset().mockResolvedValue(null);
    fsa.verifyPermission.mockReset().mockResolvedValue(true);
    fsa.persistHandle.mockReset().mockResolvedValue(undefined);
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
});
afterEach(cleanup);

describe('mounting a Library card', () => {
    it('binds itself to the project library WITHOUT growing the undo stack', async () => {
        seedProjectLibrary();
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        expect(
            (useGraphStore.getState().nodes.get(id)!.data as LibraryNodeData).libraryId,
        ).toBeUndefined();

        // Clear AFTER addNode: adding the card is the player's edit and keeps
        // its entry. What must not appear is a SECOND one, minted by a mount.
        useHistoryStore.getState().clear();
        render(<LibraryNode {...faceProps(id)} />);

        // The binding lands…
        await waitFor(() =>
            expect(
                (useGraphStore.getState().nodes.get(id)!.data as LibraryNodeData).libraryId,
            ).toBe('lib'),
        );
        // …and history never noticed.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().cursor).toBe(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
    });

    it('leaves the player their own last edit to undo', async () => {
        // The failure this prevents, spelled out: the player wires something,
        // a Library card mounts, and Ctrl+Z hits the card's bookkeeping instead
        // of the cable.
        seedProjectLibrary();
        const graph = useGraphStore.getState();
        const libId = graph.addNode('library', { x: 0, y: 0 });
        const speakerId = graph.addNode('speaker', { x: 400, y: 0 });
        useHistoryStore.getState().clear();

        // The player's edit.
        useGraphStore.getState().updateNodeData<NodeData>(speakerId, { volume: 0.25 });
        expect(useHistoryStore.getState().entries).toHaveLength(1);

        // The card mounts afterwards.
        render(<LibraryNode {...faceProps(libId)} />);
        await waitFor(() =>
            expect(
                (useGraphStore.getState().nodes.get(libId)!.data as LibraryNodeData).libraryId,
            ).toBe('lib'),
        );

        // One entry, and one Ctrl+Z puts the volume back.
        expect(useHistoryStore.getState().entries).toHaveLength(1);
        useGraphStore.getState().undo();
        expect(
            (useGraphStore.getState().nodes.get(speakerId)!.data as NodeData & { volume?: number }).volume,
        ).not.toBe(0.25);
    });
});

describe('the escape hatch is opt-in, not a blanket wrapper', () => {
    it('records a plain updateNodeData — the player authoring is the default', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useHistoryStore.getState().clear();

        useGraphStore.getState().updateNodeData<NodeData>(id, { volume: 0.4 });

        expect(useHistoryStore.getState().entries).toHaveLength(1);
        expect(useHistoryStore.getState().entries[0]!.verbs[0]).toMatchObject({
            domain: 'graph',
            verb: { kind: 'setNodeData', nodeId: id },
        });
    });

    it('still writes, persists and repaints when it is silent', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useHistoryStore.getState().clear();
        const version = useGraphStore.getState().version;
        let notified = 0;
        const stop = useGraphStore.subscribe(() => { notified += 1; });

        useGraphStore.getState().updateNodeData<NodeData>(id, { volume: 0.4 }, { record: false });
        stop();

        // The write LANDS — silent is not a no-op…
        expect(
            (useGraphStore.getState().nodes.get(id)!.data as NodeData & { volume?: number }).volume,
        ).toBe(0.4);
        // …every subscriber still woke up (the card repaints, autosave sees the
        // version bump)…
        expect(notified).toBeGreaterThan(0);
        expect(useGraphStore.getState().version).toBe(version + 1);
        // …only the undo entry is missing.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });

    it('keeps the engine-derived degraded-plugin flag off the stack', () => {
        // `setNodePluginLoadError`'s own doc comment has always said this. It was
        // not true: staying outside begin/endGesture does not keep a write out of
        // history, because the `set` wrapper records every mutation that is not a
        // history replay. So a plugin crashing mid-set pushed an undo entry.
        const id = useGraphStore.getState().addNode('effect', { x: 0, y: 0 });
        useHistoryStore.getState().clear();

        setNodePluginLoadError(id, true);

        expect(
            (useGraphStore.getState().nodes.get(id)!.data as NodeData).pluginLoadError,
        ).toBe(true);
        expect(useHistoryStore.getState().entries).toHaveLength(0);
    });
});
