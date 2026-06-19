/**
 * Agent session store (chat redesign).
 *
 * Drives the FULL path with Pi mocked: a {@link MockAgentBackend} streams a
 * scripted turn; the store appends a user + assistant turn, coalesces thought
 * deltas into markdown, applies each tool call against the REAL graph store (the
 * same verbs the UI uses), and proves:
 *   - edits apply LIVE and are reverted with plain graph-store undo (Ctrl+Z),
 *   - an `error` keeps what was built (a held note over a glitch),
 *   - a `session` event captures the active id,
 *   - `author_dsp_node` registers an addable command + open dynamic plugin,
 *   - `/new` clears the conversation,
 *   - the conversation persists to localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    useAgentSessionStore,
    _resetAgentSessionForTests,
    type AssistantEntry,
} from '../agentSessionStore';
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
    hasDynamicPlugin,
    _resetDynamicRegistryForTests,
} from '../../engine/dynamicRegistry';
import type { AgentEvent } from '../../ai/types';
import type { NodeType } from '../../engine/types';

const STORAGE_KEY = 'openjammer-graph-v2';
const CHAT_KEY = 'openjammer-agent-chat';

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

/** Count root-level nodes (derived from the node map, so it survives undo, which
 * restores `nodes` but not the `rootNodeIds` cache). */
function rootNodeCount(): number {
    return useGraphStore.getState().getRootNodes().length;
}

/** The most recent assistant turn in the conversation. */
function lastAssistant(): AssistantEntry {
    const msgs = useAgentSessionStore.getState().messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return msgs[i] as AssistantEntry;
    }
    throw new Error('no assistant turn');
}

describe('agentSessionStore chat', () => {
    beforeEach(() => {
        resetGraph();
        resetCommands();
        _resetDynamicRegistryForTests();
        _resetAgentSessionForTests();
        localStorage.removeItem(CHAT_KEY);
    });

    const addTwoNodesScript: AgentEvent[] = [
        { kind: 'thought', text: 'I will add a looper and a speaker.' },
        { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
        { kind: 'tool-call', id: 't2', call: { name: 'add_node', args: { type: 'speaker' as NodeType } } },
        { kind: 'result', summary: 'Added a looper and a speaker.' },
    ];

    it('appends a user + assistant turn and applies tool calls live', async () => {
        const backend = new MockAgentBackend({ script: addTwoNodesScript });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().send(backend, { prompt: 'add a looper' });

        expect(useAgentSessionStore.getState().phase).toBe('idle');
        expect(rootNodeCount()).toBe(before + 2);

        const msgs = useAgentSessionStore.getState().messages;
        expect(msgs[0]).toMatchObject({ role: 'user', text: 'add a looper' });

        const assistant = lastAssistant();
        // Thought deltas coalesce into the assistant's markdown.
        expect(assistant.markdown).toContain('looper and a speaker');
        // Two non-silent tool calls => two action chips.
        expect(assistant.actions).toHaveLength(2);
        expect(assistant.streaming).toBe(false);
    });

    it('applied edits are reverted per-edit by graph-store undo (Ctrl+Z)', async () => {
        const backend = new MockAgentBackend({ script: addTwoNodesScript });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().send(backend, { prompt: 'x' });
        expect(rootNodeCount()).toBe(before + 2);

        // Each agent edit is its own undo step.
        useGraphStore.getState().undo();
        expect(rootNodeCount()).toBe(before + 1);
        useGraphStore.getState().undo();
        expect(rootNodeCount()).toBe(before);
    });

    it('keeps runtime status out of assistant markdown', async () => {
        const script: AgentEvent[] = [
            { kind: 'status', message: 'Starting Pi in C:/agent/workspace' },
            { kind: 'thought', text: 'Hello!' },
            { kind: 'result', summary: 'done' },
        ];
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'q' });
        expect(lastAssistant().markdown).toBe('Hello!');
        expect(useAgentSessionStore.getState().runtimeStatus).toBeNull();
    });

    it('coalesces multiple thought deltas into one assistant markdown', async () => {
        const script: AgentEvent[] = [
            { kind: 'thought', text: 'Step one. ' },
            { kind: 'thought', text: 'Step two.' },
            { kind: 'result', summary: 'done' },
        ];
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'q' });
        expect(lastAssistant().markdown).toBe('Step one. Step two.');
    });

    it('captures the active session id from a session event', async () => {
        const script: AgentEvent[] = [
            { kind: 'thought', text: 'hi' },
            { kind: 'session', sessionId: 'sess-42' },
            { kind: 'result', summary: 'done' },
        ];
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'q' });
        expect(useAgentSessionStore.getState().sessionId).toBe('sess-42');
    });

    it('an error keeps what was built (a held note over a glitch)', async () => {
        const script: AgentEvent[] = [
            { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
            { kind: 'error', message: 'provider rejected the request' },
        ];
        const backend = new MockAgentBackend({ script });
        const before = rootNodeCount();

        await useAgentSessionStore.getState().send(backend, { prompt: 'x' });

        expect(useAgentSessionStore.getState().phase).toBe('error');
        expect(useAgentSessionStore.getState().error).toContain('provider rejected');
        // Kept (and undoable), not yanked away.
        expect(rootNodeCount()).toBe(before + 1);
        expect(lastAssistant().errored).toBe(true);
    });

    it('a silent read tool produces no action chip', async () => {
        useGraphStore.getState().addNode('amplifier', { x: 0, y: 0 }, null);
        const script: AgentEvent[] = [
            { kind: 'tool-call', id: 'r1', call: { name: 'get_graph', args: {} } },
            { kind: 'result', summary: 'Inspected the graph.' },
        ];
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'whats here?' });
        // Reads are introspection — no chip clutters a plain answer.
        expect(lastAssistant().actions).toHaveLength(0);
    });

    it('batch_apply applies every sub-call live; each is undoable', async () => {
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

        await useAgentSessionStore.getState().send(backend, { prompt: 'build a chain' });
        expect(rootNodeCount()).toBe(before + 3);
        // The batch lands as a single action chip.
        expect(lastAssistant().actions).toHaveLength(1);
        expect(lastAssistant().actions[0].name).toBe('batch_apply');
    });

    it('author_dsp_node registers an addable command + open dynamic plugin (no reject; it stays)', async () => {
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
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'tremolo' });

        expect(getCommand('ai.dsp.tremolo')).toBeDefined();
        expect(hasDynamicPlugin(pluginId)).toBe(true);
    });

    it('newSession() clears the conversation', async () => {
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script: addTwoNodesScript }), { prompt: 'x' });
        expect(useAgentSessionStore.getState().messages.length).toBeGreaterThan(0);

        await useAgentSessionStore.getState().newSession();
        expect(useAgentSessionStore.getState().messages).toHaveLength(0);
        // No warm child in the test env, so the next run starts a fresh session.
        expect(useAgentSessionStore.getState().sessionId).toBeNull();
    });

    it('rewindTo() truncates to before a turn and returns its prompt to edit', async () => {
        useAgentSessionStore.setState({
            messages: [
                { id: 'u1', role: 'user', text: 'add a keyboard' },
                { id: 'a1', role: 'assistant', markdown: 'Added.', actions: [], streaming: false },
                { id: 'u2', role: 'user', text: 'add a revrb' },
                { id: 'a2', role: 'assistant', markdown: 'Hmm.', actions: [], streaming: false },
            ],
            sessionId: 'old-session',
        });
        const prompt = await useAgentSessionStore.getState().rewindTo(2);
        expect(prompt).toBe('add a revrb');
        expect(useAgentSessionStore.getState().messages.map((m) => m.id)).toEqual(['u1', 'a1']);
        // A fresh Pi session continues from here (no warm child in tests → null).
        expect(useAgentSessionStore.getState().sessionId).toBeNull();
    });

    it('rewindTo() is conversation-only — the canvas is left untouched', async () => {
        await useAgentSessionStore
            .getState()
            .send(new MockAgentBackend({ script: addTwoNodesScript }), { prompt: 'build' });
        const builtNodes = rootNodeCount();
        expect(builtNodes).toBeGreaterThan(0);

        await useAgentSessionStore.getState().rewindTo(0);
        expect(useAgentSessionStore.getState().messages).toHaveLength(0);
        // The nodes the agent built remain; Ctrl+Z (not rewind) reverts them.
        expect(rootNodeCount()).toBe(builtNodes);
    });

    it('persists the conversation to localStorage', async () => {
        await useAgentSessionStore
            .getState()
            .send(new MockAgentBackend({ script: addTwoNodesScript }), { prompt: 'remember me' });
        const blob = localStorage.getItem(CHAT_KEY);
        expect(blob).toBeTruthy();
        expect(blob).toContain('remember me');
    });

    it('a tool-result / ui-request event is tolerated (no crash, no chip)', async () => {
        const script: AgentEvent[] = [
            { kind: 'tool-result', toolCallId: 'read-1', data: { nodes: [], connections: [] } },
            { kind: 'result', summary: 'ok' },
        ];
        await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'q' });
        expect(useAgentSessionStore.getState().phase).toBe('idle');
        expect(lastAssistant().actions).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------------
// G2 — store <-> collab AI-frame wiring.
//
// The store opens the AI frame on send and COMMITS it on every terminal (result,
// error, or an empty stream), so a turn's edits land as ONE CRDT commit. There is
// no discard path anymore (no Reject). These register a spy target and prove the
// store drives begin/commit end-to-end.
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
        localStorage.removeItem(CHAT_KEY);
    });

    it('drives begin then COMMIT on a successful turn', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            const script: AgentEvent[] = [
                { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
                { kind: 'result', summary: 'done' },
            ];
            await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'x' });
            expect(calls).toEqual(['begin', 'commit']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });

    it('drives begin then COMMIT when the run errors (keep what built)', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            const script: AgentEvent[] = [
                { kind: 'tool-call', id: 't1', call: { name: 'add_node', args: { type: 'looper' as NodeType } } },
                { kind: 'error', message: 'boom' },
            ];
            await useAgentSessionStore.getState().send(new MockAgentBackend({ script }), { prompt: 'x' });
            expect(calls).toEqual(['begin', 'commit']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });

    it('drives begin then COMMIT on an empty-stream run', async () => {
        const { target, calls } = makeFrameSpy();
        registerAiCollabBridge(target);
        try {
            await useAgentSessionStore.getState().send(new MockAgentBackend({ script: [] }), { prompt: 'x' });
            expect(calls).toEqual(['begin', 'commit']);
        } finally {
            unregisterAiCollabBridge(target);
        }
    });
});
