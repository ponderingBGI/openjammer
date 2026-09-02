/**
 * W6-SHIP B3 — `Ctrl+S` may not spend the player's `Ctrl+Z`.
 *
 * `capturePluginStates()` runs on EVERY save: it asks the engine for each hosted
 * plugin's opaque state blob and writes it into that plugin's `node.data` so the
 * project export carries it (the `oj.state` save half). The write is engine-derived
 * bookkeeping by definition — the player pressed save, they did not author a blob.
 *
 * It used to record. Its own comment said "off-undo (outside any gesture)", which
 * is the belief `pluginLoadError.ts` documents as false: `graphStore`'s `set`
 * wrapper diffs and records every graph mutation that is not a history replay,
 * gesture or no gesture. So a project with three hosted plugins buried the
 * player's last edit under three undo entries every time they saved — and the
 * next `Ctrl+Z`, reaching for the note they just wrote, un-saved a state blob.
 *
 * This pins the shape the review asked for: `entries.length` grows by ZERO across
 * the path, while the blob still LANDS (silent is not a no-op).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OjcoreNativeExecutor } from '../OjcoreNativeExecutor';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { HOSTED_PLUGIN_STATE_KEY } from '../../../engine/dynamicRegistry';

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

/** The Tauri global bridge the native executor resolves `invoke` from. */
function installMockTauri(
    handler: (cmd: string, args?: Record<string, unknown>) => unknown,
): void {
    const invoke = vi.fn((cmd: string, args?: Record<string, unknown>) =>
        Promise.resolve(handler(cmd, args)),
    );
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
}

/** Let the initial `push_graph` resolve so the NodeIdx interning is committed. */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('capturePluginStates writes the plugin blob off the undo history', () => {
    beforeEach(reset);
    afterEach(() => {
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
        vi.restoreAllMocks();
    });

    /** Boot a native executor over a real two-node graph and hand back the
     *  engine NodeIdx the save path will report a blob for. */
    async function bootWithBlob(blob: number[]): Promise<{ ex: OjcoreNativeExecutor; visualId: string }> {
        const graph = useGraphStore.getState();
        const effectId = graph.addNode('effect', { x: 0, y: 0 });
        graph.addNode('speaker', { x: 400, y: 0 });

        let states: { node: number; blob: number[] }[] = [];
        installMockTauri((cmd) => (cmd === 'save_plugin_states' ? states : undefined));

        const ex = new OjcoreNativeExecutor();
        ex.initialize(
            () => () => {},
            () => () => {},
            () => useGraphStore.getState().nodes,
            () => useGraphStore.getState().connections,
        );
        await flush();

        // The engine addresses nodes by NodeIdx; the executor owns the reverse
        // index. Read the real one rather than guessing at interning order.
        const reverse = (ex as unknown as { reverseIndex: Map<number, string> }).reverseIndex;
        const engineIdx = [...reverse.entries()].find(([, id]) => id === effectId)?.[0];
        expect(engineIdx, 'the effect node interned to a NodeIdx').toBeTypeOf('number');
        states = [{ node: engineIdx!, blob }];
        return { ex, visualId: effectId };
    }

    it('lands the blob and grows the undo history by ZERO', async () => {
        const { ex, visualId } = await bootWithBlob([1, 2, 3, 4]);
        useHistoryStore.getState().clear();

        await ex.capturePluginStates();

        // The write LANDED — a save that persists nothing is worse than a noisy one.
        expect(
            (useGraphStore.getState().nodes.get(visualId)!.data as Record<string, unknown>)[
                HOSTED_PLUGIN_STATE_KEY
            ],
        ).toEqual([1, 2, 3, 4]);
        // …and history never noticed.
        expect(useHistoryStore.getState().entries).toHaveLength(0);
        expect(useHistoryStore.getState().canUndo()).toBe(false);
        ex.dispose();
    });

    it('leaves the player their own last edit to undo across a save', async () => {
        const { ex } = await bootWithBlob([9, 9]);
        const speakerId = [...useGraphStore.getState().nodes.values()]
            .find((n) => n.type === 'speaker')!.id;
        useHistoryStore.getState().clear();

        // The player's edit, then `Ctrl+S`.
        useGraphStore.getState().updateNodeData(speakerId, { volume: 0.25 });
        await ex.capturePluginStates();

        expect(useHistoryStore.getState().entries).toHaveLength(1);
        useGraphStore.getState().undo();
        expect(
            (useGraphStore.getState().nodes.get(speakerId)!.data as { volume?: number }).volume,
        ).not.toBe(0.25);
        ex.dispose();
    });
});
