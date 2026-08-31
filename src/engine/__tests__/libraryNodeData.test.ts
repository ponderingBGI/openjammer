/**
 * W6-Z T1 — `LibraryNodeData.missingItemIds` is gone, and a save that still
 * carries it opens anyway.
 *
 * The field was a SECOND record of a fact `LibraryItem.status` already owns:
 * `libraryStore.checkMissingItems` writes the status, `LibraryNode` renders the
 * struck-through row from it and counts the banner from it. Nothing has ever
 * written the node-data copy — and it must not, for two reasons W6-P7D worked
 * out and this file pins:
 *
 *  1. `node.data` is PERSISTED project state. A `.oj` file carrying
 *     `missingItemIds` says "these were missing last Tuesday on another
 *     machine" — derived, environment-specific, and wrong the moment the
 *     project is opened somewhere else.
 *  2. Writing it from the filesystem walk would push a `setNodeData` undo entry
 *     for something the player never did (the sibling defect T4 fixes).
 *
 * The last two tests are the migration argument, made as evidence rather than as
 * a claim: NOTHING whitelists a node's `data` on either load path, so a save
 * written before this deletion still opens, still keeps every key it had, and
 * carries the now-unread one as inert baggage. No migration, no version bump.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { get as getNodeDefinition } from '../registry';
import { exportWorkflow, importWorkflow } from '../serialization';
import type { GraphNode, LibraryNodeData } from '../types';
import { useGraphStore } from '../../store/graphStore';

/** Built, not written, so this file does not match its own grep. */
const FIELD = 'missing' + 'ItemIds';

/**
 * The ONE surviving use of the identifier in the app, and it is not this field:
 * `checkMissingItems` names its local return array `missingItemIds`. That is a
 * function-scoped variable holding the walk's answer, never persisted state.
 */
const ALLOWED = ['src/store/libraryStore.ts'];

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

function libraryNode(data: Record<string, unknown>): GraphNode {
    const definition = getNodeDefinition('library');
    return {
        id: 'lib-1',
        type: 'library',
        category: definition.category,
        position: { x: 10, y: 20 },
        data: { ...definition.defaultData, ...data },
        ports: [...definition.defaultPorts],
        parentId: null,
        childIds: [],
        specialNodes: [],
    };
}

describe('LibraryNodeData has no missing-items copy', () => {
    it('the library definition mints no such key in its default data', () => {
        const defaults = getNodeDefinition('library').defaultData as Record<string, unknown>;
        expect(Object.keys(defaults)).not.toContain(FIELD);
        // The keys that DO carry the card's real state are untouched, so this is
        // a deletion and not a defaults rewrite.
        expect(defaults).toMatchObject({ itemRefs: [], playbackMode: 'oneshot', volume: 1 });
    });

    it('is a compile-time absence, not just a runtime one', () => {
        // `LibraryNodeData` is structural: if the field came back as optional,
        // this object would still typecheck. What pins it is the grep below plus
        // the fact that the ONLY reader of missing-ness is the store's status.
        const data: LibraryNodeData = {
            itemRefs: [],
            playbackMode: 'oneshot',
            volume: 1,
        };
        expect(Object.keys(data)).not.toContain(FIELD);
    });

    it('names the identifier in no source file but the walk that owns the local', () => {
        const root = resolve(process.cwd(), 'src');
        const offenders = sourceFiles(root)
            .filter((file) => readFileSync(file, 'utf8').includes(FIELD))
            .map((file) => file.slice(resolve(process.cwd()).length + 1).replace(/\\/g, '/'))
            .filter((file) => !ALLOWED.includes(file));
        expect(offenders).toEqual([]);
    });
});

describe('a save written before the deletion still opens', () => {
    it('workflow import keeps a node whose data carries the removed key', () => {
        // A project exported by the OLD build: the card's data still has the
        // field, because `exportWorkflow` deep-clones `node.data` verbatim.
        const stale = libraryNode({ [FIELD]: ['gone-1', 'gone-2'], libraryId: 'lib-a' });
        const exported = exportWorkflow(new Map([[stale.id, stale]]), new Map(), 'stale');
        expect((exported.nodes[0]!.data as Record<string, unknown>)[FIELD]).toEqual(['gone-1', 'gone-2']);

        const { nodes } = importWorkflow(JSON.stringify(exported));
        expect(nodes).toHaveLength(1);
        const loaded = nodes[0]!;
        expect(loaded.type).toBe('library');
        // Tolerated SILENTLY: the key rides along unread rather than throwing,
        // being stripped, or taking the node down with it. `importWorkflow`
        // assigns `data: serialized.data` with no whitelist — FROZEN-1's "a
        // saved project always opens" is what makes the migration unnecessary.
        expect((loaded.data as Record<string, unknown>)[FIELD]).toEqual(['gone-1', 'gone-2']);
        expect((loaded.data as LibraryNodeData).libraryId).toBe('lib-a');
    });

    it('localStorage rehydrate keeps it too, and the card is fully usable', async () => {
        const stale = libraryNode({ [FIELD]: ['gone-1'], libraryId: 'lib-a', volume: 0.5 });
        localStorage.setItem(
            'openjammer-graph-v2',
            JSON.stringify({
                version: 0,
                state: {
                    nodes: [[stale.id, stale]],
                    connections: [],
                    rootNodeIds: [stale.id],
                    selectedNodeIds: [],
                    selectedConnectionIds: [],
                },
            }),
        );

        await useGraphStore.persist.rehydrate();

        const loaded = useGraphStore.getState().nodes.get(stale.id);
        expect(loaded).toBeDefined();
        // The persist reader touches `parentId`/`childIds`/`specialNodes`/`ports`
        // and `type` — never `data`. So the unknown key survives, unread.
        expect((loaded!.data as Record<string, unknown>)[FIELD]).toEqual(['gone-1']);
        expect((loaded!.data as LibraryNodeData).volume).toBe(0.5);
        expect(loaded!.ports.some((port) => port.id === 'sample-out')).toBe(true);
    });

    beforeEach(() => {
        localStorage.clear();
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
    });

    afterEach(() => {
        localStorage.clear();
    });
});
