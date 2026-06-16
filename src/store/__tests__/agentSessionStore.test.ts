/**
 * Agent session transaction (U20).
 *
 * Drives the FULL path with Pi mocked: a {@link MockAgentBackend} streams a
 * scripted plan; the session applies each tool call against the REAL graph store
 * (the same verbs the UI uses), then proves:
 *   - Approve KEEPS the applied changes, and
 *   - Reject REVERTS them (graph back to its pre-run state),
 *   - an `error` event reverts whatever was applied before it, and
 *   - `author_dsp_node` registers a command-palette entry that Reject removes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentSessionStore, _resetAgentSessionForTests } from '../agentSessionStore';
import { useGraphStore } from '../graphStore';
import { getCommand, _resetForTests as resetCommands } from '../commandRegistry';
import { MockAgentBackend } from '../../ai/MockAgentBackend';
import {
    registerAiCollabBridge,
    unregisterAiCollabBridge,
    type AiCollabFrameTarget,
} from '../../collab';
import {
    dspPluginIdFor,
    getDynamicPlugin,
    hasDynamicPlugin,
    AI_MANIFEST_PARAMS_KEY,
    _resetDynamicRegistryForTests,
} from '../../engine/dynamicRegistry';
import type { AgentEvent } from '../../ai/types';
import type { NodeType } from '../../engine/types';

const STORAGE_KEY = 'openjammer-graph-v2';

function resetGraph() {
    localStorage.removeItem(STORAGE_KEY);
    useGraphStore.setState({
        nodes: new Map(),
        connections: new Map(),
        connectionsByNode: new Map(),
        rootNodeIds: [],
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        clipboard: null,
        history: [],
        historyIndex: -1,
        version: 0,
    });
}

/** Count root-level nodes (excludes auto-created internal children). */
function rootNodeCount(): number {
    return useGraphStore.getState().rootNodeIds.length;
}

describe('agentSessionStore transaction', () => {
    beforeEach(() => {
        resetGraph();
        resetCommands();
        _resetDynamicRegistryForTests();
        _resetAgentSessionForTests();
    });

    const addTwoNodesScript: AgentEvent[] = [
        { kind: 'thought', text: 'I will add a looper and a speaker.' },
        { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
        { kind: 'tool-call', id: 't2', call: { name: 'add_node', args: { type: 'speaker' as NodeType } } },
        { kind: 'result', summary: 'Added a looper and a speaker.' },
    ];

    it('applies tool calls during the run and lands in awaiting-approval', async () => {
        const backend = new MockAgentBackend({ script: addTwoNodesScript });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'add a looper' });

        expect(useAgentSessionStore.getState().phase).toBe('awaiting-approval');
        expect(rootNodeCount()).toBe(before + 2);
        // Transcript carries the thought + 2 tool-calls + result.
        expect(useAgentSessionStore.getState().transcript).toHaveLength(4);
    });

    it('approve keeps the applied changes', async () => {
        const backend = new MockAgentBackend({ script: addTwoNodesScript });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'x' });
        useAgentSessionStore.getState().approve();

        expect(useAgentSessionStore.getState().phase).toBe('idle');
        expect(rootNodeCount()).toBe(before + 2);
        expect(useAgentSessionStore.getState().transcript).toHaveLength(0);
    });

    it('reject reverts every applied change', async () => {
        const backend = new MockAgentBackend({ script: addTwoNodesScript });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'x' });
        expect(rootNodeCount()).toBe(before + 2);

        useAgentSessionStore.getState().reject();

        expect(useAgentSessionStore.getState().phase).toBe('idle');
        expect(rootNodeCount()).toBe(before);
    });

    it('an error event reverts work applied before the failure', async () => {
        const script: AgentEvent[] = [
            { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
            { kind: 'error', message: 'provider rejected the request' },
        ];
        const backend = new MockAgentBackend({ script });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'x' });

        expect(useAgentSessionStore.getState().phase).toBe('error');
        expect(useAgentSessionStore.getState().error).toContain('provider rejected');
        expect(rootNodeCount()).toBe(before); // reverted
    });

    it('author_dsp_node registers a palette command; reject unregisters it', async () => {
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: {
                    name: 'author_dsp_node',
                    args: { name: 'Tape Echo', faustSource: 'process = _;', compiled: false },
                },
            },
            { kind: 'result', summary: 'Authored Tape Echo.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'make a tape echo' });
        expect(getCommand('ai.dsp.tape-echo')).toBeDefined();

        useAgentSessionStore.getState().reject();
        expect(getCommand('ai.dsp.tape-echo')).toBeUndefined();
    });

    it('author_dsp_node also registers an OPEN dynamic plugin (M5); reject unregisters BOTH', async () => {
        const faustSource = 'process = _ : *(0.7);';
        const pluginId = dspPluginIdFor(faustSource);
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: { name: 'author_dsp_node', args: { name: 'Tremolo', faustSource, compiled: false } },
            },
            { kind: 'result', summary: 'Authored Tremolo.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'make a tremolo' });
        // Both the action AND the dynamic plugin identity are registered.
        expect(getCommand('ai.dsp.tremolo')).toBeDefined();
        expect(hasDynamicPlugin(pluginId)).toBe(true);

        useAgentSessionStore.getState().reject();
        // Reject tears down BOTH — no orphaned identity left behind.
        expect(getCommand('ai.dsp.tremolo')).toBeUndefined();
        expect(hasDynamicPlugin(pluginId)).toBe(false);
    });

    it('approve keeps the authored open dynamic plugin (M5)', async () => {
        const faustSource = 'process = _ : *(1.5);';
        const pluginId = dspPluginIdFor(faustSource);
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: { name: 'author_dsp_node', args: { name: 'Booster', faustSource, compiled: true } },
            },
            { kind: 'result', summary: 'Authored Booster.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'booster' });
        useAgentSessionStore.getState().approve();

        expect(hasDynamicPlugin(pluginId)).toBe(true);
    });

    it('a streamed batch_apply is ONE undo frame — reject reverts every sub-call', async () => {
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: {
                    name: 'batch_apply',
                    args: {
                        calls: [
                            { name: 'add_node', args: { type: 'looper' as NodeType } },
                            { name: 'add_node', args: { type: 'speaker' as NodeType } },
                            { name: 'add_node', args: { type: 'amplifier' as NodeType } },
                        ],
                    },
                },
            },
            { kind: 'result', summary: 'Built a chain in one batch.' },
        ];
        const backend = new MockAgentBackend({ script });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'build a chain' });
        expect(useAgentSessionStore.getState().phase).toBe('awaiting-approval');
        // All three sub-calls applied as one frame.
        expect(rootNodeCount()).toBe(before + 3);

        // The batch lands as a SINGLE transcript entry carrying per-sub-call children.
        const batchEntry = useAgentSessionStore
            .getState()
            .transcript.find((e) => e.event.kind === 'tool-call');
        expect(batchEntry?.children).toHaveLength(3);
        expect(batchEntry?.children?.every((c) => c.ok)).toBe(true);

        // ONE reject reverts the WHOLE frame.
        useAgentSessionStore.getState().reject();
        expect(rootNodeCount()).toBe(before);
    });

    it('emit_plan (M7) lands as ONE frame against the real registry — reject reverts it', async () => {
        // A whole workflow described by ref + port NAME, lowered + applied as one
        // reversible frame through the real plan env (registry-backed).
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: {
                    name: 'emit_plan',
                    args: {
                        nodes: [
                            { ref: 'lp', type: 'looper' },
                            { ref: 'out', type: 'speaker' },
                        ],
                        wires: [
                            {
                                from: { ref: 'lp', port: 'Audio Out' },
                                to: { ref: 'out', port: 'Audio In' },
                            },
                        ],
                    },
                },
            },
            { kind: 'result', summary: 'Built a looper -> speaker chain.' },
        ];
        const backend = new MockAgentBackend({ script });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'loop into a speaker' });
        expect(useAgentSessionStore.getState().phase).toBe('awaiting-approval');
        // Two nodes added as one frame, plus the wire between them.
        expect(rootNodeCount()).toBe(before + 2);
        expect(useGraphStore.getState().connections.size).toBe(1);

        // emit_plan renders as a SINGLE grouped transcript entry (like batch_apply).
        const planEntry = useAgentSessionStore
            .getState()
            .transcript.find((e) => e.event.kind === 'tool-call');
        expect(planEntry?.children && planEntry.children.length).toBeGreaterThanOrEqual(3);
        expect(planEntry?.children?.every((c) => c.ok)).toBe(true);

        // ONE reject reverts the whole plan frame.
        useAgentSessionStore.getState().reject();
        expect(rootNodeCount()).toBe(before);
        expect(useGraphStore.getState().connections.size).toBe(0);
    });

    it('a read tool call carries its inspection result into the transcript', async () => {
        // Seed the graph so get_graph has something to report. (A node type may add
        // internal child nodes, so assert against the store's flat node map, which
        // get_graph mirrors exactly, rather than a hard-coded count.)
        useGraphStore.getState().addNode('amplifier', { x: 0, y: 0 }, null);
        const expectedNodes = useGraphStore.getState().nodes.size;
        const script: AgentEvent[] = [
            { kind: 'tool-call', id: 'r1', call: { name: 'get_graph', args: {} } },
            { kind: 'result', summary: 'Inspected the graph.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'what is on the canvas?' });

        const readEntry = useAgentSessionStore
            .getState()
            .transcript.find((e) => e.event.kind === 'tool-call');
        // The read APPLIED with a no-op undo and surfaced the live graph unchanged.
        expect(readEntry?.applied).toBe(true);
        const data = readEntry?.resultData as { nodes: unknown[]; connections: unknown[] };
        expect(data.nodes).toHaveLength(expectedNodes);
        expect(expectedNodes).toBeGreaterThan(0);
    });

    it('a streamed batch_apply that FAILS is fully reverted and reports per-sub-call status', async () => {
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: {
                    name: 'batch_apply',
                    args: {
                        calls: [
                            { name: 'add_node', args: { type: 'looper' as NodeType } },
                            // Fails: no such node to update -> aborts + reverts the frame.
                            { name: 'update_node_data', args: { nodeId: 'nope', data: { gain: 1 } } },
                            { name: 'add_node', args: { type: 'speaker' as NodeType } },
                        ],
                    },
                },
            },
            { kind: 'result', summary: 'Attempted a batch.' },
        ];
        const backend = new MockAgentBackend({ script });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().start(backend, { prompt: 'build a chain' });

        // Fail-closed: the whole frame reverted, so the graph is unchanged.
        expect(rootNodeCount()).toBe(before);

        const batchEntry = useAgentSessionStore
            .getState()
            .transcript.find((e) => e.event.kind === 'tool-call');
        // The grouped line shows the first sub-call ok, the second failed, and the
        // third never ran (fail-closed stops at the first failure).
        expect(batchEntry?.applied).toBe(false);
        expect(batchEntry?.children).toEqual([
            expect.objectContaining({ name: 'add_node', ok: true }),
            expect.objectContaining({ name: 'update_node_data', ok: false }),
        ]);
        // The batch's data carries the per-sub-call status AND the post-revert graph
        // summary for the agent to reason on. After fail-closed revert the post-state
        // is back to the pre-run graph (no nodes added).
        const data = batchEntry?.resultData as {
            status: { ok: boolean }[];
            postState: { nodes: unknown[] };
        };
        expect(data.status.map((s) => s.ok)).toEqual([true, false]);
        expect(data.postState.nodes).toHaveLength(0);
    });

    it('a tool-result event lands in the transcript', async () => {
        const script: AgentEvent[] = [
            { kind: 'tool-result', toolCallId: 'read-1', data: { nodes: [], connections: [] } },
            { kind: 'result', summary: 'Inspected the graph.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'what is on the canvas?' });

        const transcript = useAgentSessionStore.getState().transcript;
        const resultEntry = transcript.find((e) => e.event.kind === 'tool-result');
        expect(resultEntry).toBeDefined();
        expect(resultEntry?.resultData).toEqual({ nodes: [], connections: [] });
    });

    it('author_code_node registers a FIRST-CLASS dynamic plugin; reject unregisters it (M6)', async () => {
        // No Tauri in the test env, so the registrar uses the browser source-fallback
        // path: key the node `ai.dsp.<sourceHash>` and register it first-class.
        const source = 'process = _ : *(0.5);';
        const pluginId = dspPluginIdFor(source);
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: { name: 'author_code_node', args: { name: 'Halver', source, lang: 'faust' } },
            },
            { kind: 'result', summary: 'Authored Halver.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'halve the signal' });
        // First-class: a dynamic plugin AND a palette command are registered.
        expect(hasDynamicPlugin(pluginId)).toBe(true);
        expect(getCommand('ai.dsp.halver')).toBeDefined();
        // The dynamic def carries the (empty, source-only) manifest params slot so
        // AutoParamPanel can render once a native compile supplies real params.
        const def = getDynamicPlugin(pluginId)!;
        expect((def.defaultData as Record<string, unknown>)[AI_MANIFEST_PARAMS_KEY]).toEqual([]);

        // Reversible: reject tears down BOTH.
        useAgentSessionStore.getState().reject();
        expect(hasDynamicPlugin(pluginId)).toBe(false);
        expect(getCommand('ai.dsp.halver')).toBeUndefined();
    });

    it('approve keeps an author_code_node dynamic plugin (M6)', async () => {
        const source = 'process = _ : *(2.0);';
        const pluginId = dspPluginIdFor(source);
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: { name: 'author_code_node', args: { name: 'Doubler', source } },
            },
            { kind: 'result', summary: 'Authored Doubler.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'double it' });
        useAgentSessionStore.getState().approve();
        expect(hasDynamicPlugin(pluginId)).toBe(true);
    });

    it('approve keeps an authored DSP command available', async () => {
        const script: AgentEvent[] = [
            {
                kind: 'tool-call',
                id: 't1',
                call: {
                    name: 'author_dsp_node',
                    args: { name: 'Bitcrusher', faustSource: 'process = _;', compiled: true, nIn: 1, nOut: 1 },
                },
            },
            { kind: 'result', summary: 'Authored Bitcrusher.' },
        ];
        const backend = new MockAgentBackend({ script });

        await useAgentSessionStore.getState().start(backend, { prompt: 'bitcrusher' });
        useAgentSessionStore.getState().approve();

        expect(getCommand('ai.dsp.bitcrusher')).toBeDefined();
    });
});

// ----------------------------------------------------------------------------
// G2 (M3) — store <-> collab AI-frame wiring.
//
// The store calls the collab free functions, which dispatch to whatever bridge
// is REGISTERED. These tests register a spy `AiCollabFrameTarget` and prove the
// store actually drives begin/commit/discard end-to-end (a regression that
// dropped beginAiFrame() from start() would fail here). They are the missing
// integration link between the in-isolation store tests and the bridge tests.
// ----------------------------------------------------------------------------

describe('agentSessionStore <-> collab AI frame (G2)', () => {
    function makeFrameSpy() {
        const calls: string[] = [];
        const target: AiCollabFrameTarget = {
            beginAiFrame: () => calls.push('begin'),
            commitAiFrame: () => calls.push('commit'),
            discardAiFrame: () => calls.push('discard'),
        };
        return { target, calls };
    }

    beforeEach(() => {
        resetGraph();
        resetCommands();
        _resetAgentSessionForTests();
    });

    it('drives begin then COMMIT on approve', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            const script: AgentEvent[] = [
                { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
                { kind: 'result', summary: 'done' },
            ];
            await useAgentSessionStore.getState().start(new MockAgentBackend({ script }), { prompt: 'x' });
            expect(calls).toEqual(['begin']); // frame held open until the turn boundary
            useAgentSessionStore.getState().approve();
            expect(calls).toEqual(['begin', 'commit']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });

    it('drives begin then DISCARD on reject', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            const script: AgentEvent[] = [
                { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
                { kind: 'result', summary: 'done' },
            ];
            await useAgentSessionStore.getState().start(new MockAgentBackend({ script }), { prompt: 'x' });
            useAgentSessionStore.getState().reject();
            expect(calls).toEqual(['begin', 'discard']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });

    it('drives begin then DISCARD when the run errors', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            const script: AgentEvent[] = [
                { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
                { kind: 'error', message: 'boom' },
            ];
            await useAgentSessionStore.getState().start(new MockAgentBackend({ script }), { prompt: 'x' });
            expect(calls).toEqual(['begin', 'discard']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });

    it('drives begin then DISCARD on an empty-stream run', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            // No tool-calls and no terminal result: the stream just ends.
            await useAgentSessionStore.getState().start(new MockAgentBackend({ script: [] }), { prompt: 'x' });
            expect(calls).toEqual(['begin', 'discard']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });
});
