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
