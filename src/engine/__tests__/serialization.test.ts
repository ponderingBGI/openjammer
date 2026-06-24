import { describe, expect, it, beforeEach } from 'vitest';
import { exportWorkflow, importWorkflow } from '../serialization';
import { arrangementForExport, readArrangement } from '../../song/project';
import { conduct } from '../../song/conduct';
import { normalizeArrangement } from '../../song/normalize';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import { resolveNodeDefinition } from '../registry';
import {
    registerDynamicPlugin,
    makeDspNodeDefinition,
    dspPluginIdFor,
    getDynamicPlugin,
    _resetDynamicRegistryForTests,
} from '../dynamicRegistry';
import type { GraphNode, Connection, SerializedWorkflow } from '../types';

describe('workflow serialization — timeline persistence (FROZEN-3)', () => {
    it('round-trips the arrangement through export -> import, losslessly', () => {
        const arr = normalizeArrangement(buildPaperSketch());
        const workflow = exportWorkflow(new Map(), new Map(), 'song', arrangementForExport(arr));
        // The opaque blob is carried on the serialized form …
        expect(workflow.arrangement).toBeDefined();
        const { arrangement } = importWorkflow(workflow);
        const reopened = readArrangement(arrangement);
        expect(reopened).toBeDefined();
        // … and a reopened song conducts to the EXACT same sound (the timeline survived).
        expect(conduct(reopened!)).toEqual(conduct(arr));
    });

    it('omits the arrangement entirely when there is no song', () => {
        const workflow = exportWorkflow(new Map(), new Map(), 'graph-only');
        expect('arrangement' in workflow).toBe(false);
        // And importing a graph-only workflow yields no arrangement (the GUI clears it).
        expect(importWorkflow(workflow).arrangement).toBeUndefined();
    });
});

describe('workflow serialization', () => {
    it('drops imported connections that reference removed ports', () => {
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Old looper workflow',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'looper-1',
                    type: 'looper',
                    category: 'routing',
                    position: { x: 0, y: 0 },
                    data: { duration: 10, isRecording: false, loops: [], currentTime: 0 }
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: [
                {
                    id: 'stale-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'sample-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                },
                {
                    id: 'valid-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'audio-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                }
            ]
        };

        const imported = importWorkflow(workflow);
        const looper = imported.nodes.find(node => node.id === 'looper-1');

        expect(looper?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out']);
        expect(imported.connections.map(connection => connection.id)).toEqual(['valid-conn']);
    });

    it('prefers persisted per-instance ports over registry defaults', () => {
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Looper with grown ports',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'looper-1',
                    type: 'looper',
                    category: 'routing',
                    position: { x: 0, y: 0 },
                    data: { duration: 10, isRecording: false, loops: [], currentTime: 0 },
                    // Instance has an extra port not present in registry defaults.
                    ports: [
                        { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
                        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
                        { id: 'sample-out', name: 'Sample', type: 'audio', direction: 'output' }
                    ]
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: [
                {
                    id: 'sample-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'sample-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                }
            ]
        };

        const imported = importWorkflow(workflow);
        const looper = imported.nodes.find(node => node.id === 'looper-1');

        expect(looper?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out', 'sample-out']);
        // Connection to the persisted port is kept because the port now exists.
        expect(imported.connections.map(connection => connection.id)).toEqual(['sample-conn']);
    });

    it('KEEPS an unknown node type as a labeled stub — a saved project always opens (FROZEN-1)', () => {
        // STABILITY.md §2: an unknown node (e.g. saved by a newer build, or a
        // missing plugin) must NEVER delete the user's work — it loads as a labeled
        // passthrough stub that preserves topology + data + the ref. The previous
        // behavior DROPPED it, silently losing work; the engine's compile_resilient
        // already degrades it, so the TS load path must keep it too.
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Workflow with future node',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'mystery-1',
                    // Pretend a newer build saved a node type this build does not know.
                    type: 'future-node' as never,
                    category: 'utility',
                    position: { x: 0, y: 0 },
                    data: { keep: 'this' },
                    // Persisted per-instance ports keep the node's topology so its
                    // connections survive (the future-rebind contract).
                    ports: [
                        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' }
                    ]
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: [
                {
                    id: 'into-speaker',
                    sourceNodeId: 'mystery-1',
                    sourcePortId: 'audio-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                }
            ]
        };

        const imported = importWorkflow(workflow);

        // The unknown node is KEPT (never dropped) …
        expect(imported.nodes.map(node => node.id).sort()).toEqual(['mystery-1', 'speaker-1']);
        const mystery = imported.nodes.find(node => node.id === 'mystery-1');
        // … round-trips losslessly (type, data, persisted ports preserved) …
        expect(mystery?.type).toBe('future-node');
        expect(mystery?.data).toEqual({ keep: 'this' });
        expect(mystery?.ports.map(port => port.id)).toEqual(['audio-out']);
        // … resolves to the inert MISSING_DEFINITION so the app stays operable …
        expect(resolveNodeDefinition(mystery!).name).toBe('Unknown');
        // … and the connection to it SURVIVES (topology preserved for a rebind).
        expect(imported.connections.map(connection => connection.id)).toEqual(['into-speaker']);
    });
});

// ============================================================================
// M5 — open node identity: round-trip, self-healing, migration, no-orphan
// ============================================================================

describe('open node identity (M5)', () => {
    beforeEach(() => {
        _resetDynamicRegistryForTests();
    });

    const FAUST = 'process = _ : *(0.5);';

    /** A live GraphNode carrying an open identity (type stays 'effect'). */
    function dynamicEffectNode(pluginId: string): GraphNode {
        return {
            id: 'ai-1',
            type: 'effect',
            category: 'effects',
            pluginId,
            position: { x: 10, y: 20 },
            data: { aiDsp: true, aiDspName: 'Tape Echo', faustSource: FAUST },
            ports: [
                { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
                { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
            ],
            parentId: null,
            childIds: [],
            specialNodes: [],
        };
    }

    it('round-trips pluginId AND self-heals the dynamic registry on a fresh load', () => {
        const pluginId = dspPluginIdFor(FAUST);
        // Author-time: the dynamic plugin is registered and a node carries its id.
        registerDynamicPlugin(pluginId, makeDspNodeDefinition({ name: 'Tape Echo', faustSource: FAUST }));

        const node = dynamicEffectNode(pluginId);
        const nodes = new Map<string, GraphNode>([[node.id, node]]);
        const connections = new Map<string, Connection>();

        const exported = exportWorkflow(nodes, connections, 'Dynamic');
        // pluginId is persisted in the export.
        expect(exported.nodes[0].pluginId).toBe(pluginId);

        // Simulate a FRESH state: clear the dynamic registry before importing.
        _resetDynamicRegistryForTests();
        expect(getDynamicPlugin(pluginId)).toBeUndefined();

        const imported = importWorkflow(exported);
        const reloaded = imported.nodes.find((n) => n.id === 'ai-1');

        // The node KEEPS its pluginId …
        expect(reloaded?.pluginId).toBe(pluginId);
        // … and its per-instance ports survive the round-trip (dynamic-node port
        // identity is preserved, not reset to the static defaultPorts).
        expect(reloaded?.ports.map((p) => p.id)).toEqual(['audio-in', 'audio-out']);
        // … and the dynamic registry was RE-POPULATED from the serialized data, so
        // identity resolves to the dynamic def (not MISSING_DEFINITION).
        expect(getDynamicPlugin(pluginId)).toBeDefined();
        const resolved = resolveNodeDefinition(reloaded!);
        expect(resolved.name).toBe('Tape Echo');
        expect(resolved.name).not.toBe('Unknown');
    });

    it('migrates an OLD-shape effect+faustSource AI node to a first-class pluginId node', () => {
        // An older workflow (no pluginId, older version) with a pre-M5 AI node.
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Legacy AI workflow',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'legacy-ai-1',
                    type: 'effect',
                    category: 'effects',
                    position: { x: 0, y: 0 },
                    // OLD shape: source in data + aiDsp flag, NO pluginId.
                    data: { aiDsp: true, aiDspName: 'Bitcrusher', faustSource: FAUST },
                },
            ],
            connections: [],
        };

        const imported = importWorkflow(workflow);
        const migrated = imported.nodes.find((n) => n.id === 'legacy-ai-1');

        const expectedId = dspPluginIdFor(FAUST);
        // The node now carries the stable kernel-derived pluginId …
        expect(migrated?.pluginId).toBe(expectedId);
        // … and a dynamic registry entry exists for it (no orphaning).
        expect(getDynamicPlugin(expectedId)).toBeDefined();
        // type stays 'effect' (execution path unchanged).
        expect(migrated?.type).toBe('effect');
        // The SAME faustSource maps to the SAME id.
        expect(expectedId).toBe(dspPluginIdFor(FAUST));
    });

    it('does NOT drop a node whose identity is a registered dynamic id (no-orphan)', () => {
        const pluginId = dspPluginIdFor(FAUST);
        registerDynamicPlugin(pluginId, makeDspNodeDefinition({ name: 'Echo', faustSource: FAUST }));

        const workflow: SerializedWorkflow = {
            version: '1.1.0',
            name: 'Dynamic node workflow',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'dyn-1',
                    type: 'effect',
                    category: 'effects',
                    pluginId,
                    position: { x: 0, y: 0 },
                    data: { aiDsp: true, aiDspName: 'Echo', faustSource: FAUST },
                },
            ],
            connections: [],
        };

        const imported = importWorkflow(workflow);
        expect(imported.nodes.map((n) => n.id)).toEqual(['dyn-1']);
    });

    it('keeps an unregistered exotic-type node and round-trips it losslessly (FROZEN-1)', () => {
        const workflow: SerializedWorkflow = {
            version: '1.1.0',
            name: 'Exotic-type workflow',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'mystery-1',
                    // Neither a known plugin id NOR a registered dynamic id, and no pluginId.
                    type: 'totally-unknown' as never,
                    category: 'utility',
                    position: { x: 5, y: 7 },
                    data: { secret: 42 },
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 },
                },
            ],
            connections: [],
        };

        const imported = importWorkflow(workflow);
        // Both nodes survive — the unknown one is never dropped (FROZEN-1).
        expect(imported.nodes.map((n) => n.id).sort()).toEqual(['mystery-1', 'speaker-1']);
        const mystery = imported.nodes.find((n) => n.id === 'mystery-1')!;
        // It resolves to the inert MISSING_DEFINITION (Unknown) rather than crashing.
        expect(resolveNodeDefinition(mystery).name).toBe('Unknown');

        // Re-export preserves the exotic node VERBATIM (lossless persisted surface),
        // so a project saved on a build that lacks the node is never corrupted by a
        // round-trip through it.
        const nodes = new Map(imported.nodes.map((n) => [n.id, n]));
        const connections = new Map(imported.connections.map((c) => [c.id, c]));
        const reexported = exportWorkflow(nodes, connections, 'roundtrip');
        const m = reexported.nodes.find((n) => n.id === 'mystery-1')!;
        expect(m.type).toBe('totally-unknown');
        expect(m.data).toEqual({ secret: 42 });
        expect(m.position).toEqual({ x: 5, y: 7 });
    });
});
