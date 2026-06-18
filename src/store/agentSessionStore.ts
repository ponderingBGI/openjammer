/**
 * Agent session store — the PERSISTENT, multi-turn conversation behind the
 * Ctrl/Cmd+K AI command bar (redesign).
 *
 * This is a chat, not a one-shot transcript. The whole conversation + the active
 * Pi session id are PERSISTED (localStorage), so closing the bar — or the app —
 * and reopening Ctrl+K drops you exactly where you were, and the next prompt
 * AUTO-REATTACHES to the same Pi session (its history lives in
 * `~/.openjammer/agent`, so "come back three months later" just works).
 *
 * LIFECYCLE of one turn:
 *   idle --send()--> running  (a user entry + a streaming assistant entry are
 *                              appended; thought deltas coalesce into the
 *                              assistant's markdown; each tool call is APPLIED
 *                              IMMEDIATELY against the live graph)
 *        --(terminal result/error)--> idle / error
 *
 * NO Approve/Reject. The agent is still an UNTRUSTED GENERATOR — it only ever
 * emits the SAME reversible graph verbs a user drives by hand — but its edits now
 * apply live and are reverted with plain **Ctrl+Z** (each edit its own undo step,
 * recorded by the graph store like any manual edit). A held, believable result
 * beats a modal: on error we keep what was built (it's undoable) rather than
 * yanking it away.
 *
 * Sessions: `newSession()` starts a fresh Pi session (the `/new` verb);
 * `resumeSession(id)` loads a prior session's history and continues it (`/resume`);
 * `listSessions()` feeds the resume picker.
 *
 * Collab (G2): a turn is wrapped in the collab AI frame ({@link beginAiFrame} on
 * send, {@link commitAiFrame} on every terminal) so the turn's edits land as ONE
 * CRDT commit. No-op with no active session, so single-user is unaffected.
 *
 * This store is the {@link DspNodeRegistrar}: `author_dsp_node` / `author_code_node`
 * tool calls register an addable command-palette entry, remembered for the session.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { register as registerCommand } from './commandRegistry';
import type { ActionCtx } from './commandRegistry';
import {
    dspPluginIdFor,
    wasmPluginIdFor,
    makeDspNodeDefinition,
    registerDynamicPlugin,
} from '../engine/dynamicRegistry';
import { getInvoke } from '../ai/tauri';
import { authorCodeNode, type AuthoredNodeResult } from '../ai/codeNodeAuthor';
import type { ParamDecl } from '../engine/manifest';
import { useGraphStore } from './graphStore';
import { useCanvasStore } from './canvasStore';
import { useCanvasNavigationStore } from './canvasNavigationStore';
import { beginAiFrame, commitAiFrame } from '../collab';
import type {
    AgentBackend,
    AgentTask,
    AgentToolCall,
    AuthorDspNodeArgs,
} from '../ai/types';
import { applyToolCall, type DspNodeRegistrar } from '../ai/tools';
import {
    listSessions as piListSessions,
    loadSessionMessages,
    runCommand,
    type DisplayMessage,
    type SessionInfo,
} from '../ai/piSessions';
import { createGraphStoreApi } from '../ai/graphAdapter';
import { createPlanEnv } from '../ai/planAdapter';
import { createEnvPort } from '../ai/envAdapter';
import type { Position } from '../engine/types';

// ============================================================================
// Types
// ============================================================================

/** Run phase, driving which controls the chat shows. */
export type AgentPhase = 'idle' | 'running' | 'error';

/** A quiet "what the agent did" chip under an assistant turn. */
export interface ActionChip {
    /** The tool name (e.g. `add_node`, `add_connection`). */
    name: string;
    /** The human summary of what happened (e.g. "added looper"). */
    summary: string;
    /** Whether the mutation succeeded. */
    ok: boolean;
}

/** A user's prompt turn. */
export interface UserEntry {
    id: string;
    role: 'user';
    text: string;
}

/** An assistant turn: streamed markdown prose + the actions it took. */
export interface AssistantEntry {
    id: string;
    role: 'assistant';
    /** Coalesced assistant text (markdown). */
    markdown: string;
    /** The graph actions taken during this turn (quiet chips). */
    actions: ActionChip[];
    /** True while the turn is still streaming. */
    streaming: boolean;
    /** True if the turn ended in an error. */
    errored?: boolean;
}

/** One rendered conversation entry. */
export type ConversationEntry = UserEntry | AssistantEntry;

interface AgentSessionStore {
    // --- State ---
    /** The active Pi session id (persisted), or null for "a fresh session". */
    sessionId: string | null;
    /** The whole conversation (persisted). */
    messages: ConversationEntry[];
    /** Run phase of the in-flight turn. */
    phase: AgentPhase;
    /** Terminal error message, if the last turn failed. */
    error: string | null;
    /**
     * The graph node ids that existed BEFORE the in-flight turn (snapshot at
     * {@link send}). A node NOT in this set while a turn is live is one the agent
     * just added — the canvas highlights it so you watch the build. `null` when
     * idle.
     */
    runBaseline: ReadonlySet<string> | null;

    // --- Actions ---
    /** Send a prompt: append the turn, stream it, apply edits live. */
    send: (backend: AgentBackend, task: AgentTask) => Promise<void>;
    /** Start a fresh Pi session (`/new`): clears the conversation. */
    newSession: () => Promise<void>;
    /** Resume a prior session by id (`/resume`): loads its history + continues it. */
    resumeSession: (id: string) => Promise<{ incomplete: boolean }>;
    /** List persisted sessions (newest first) for the resume picker. */
    listSessions: () => Promise<SessionInfo[]>;
    /** Hard reset (tests + "start over"): clears conversation + session. */
    reset: () => void;
}

// ============================================================================
// Internals (not part of the public store state)
// ============================================================================

/** Read tools are introspection, not actions — they get no chip (keeps a chat
 * answer clean; the real read round-trip to Pi is the host bridge's job). */
const SILENT_TOOLS = new Set([
    'get_graph',
    'list_node_types',
    'find_nodes',
    'validate_plan',
    'get_logs',
    'get_diagnostics',
    'get_settings',
]);

/** Max conversation entries kept in localStorage (older history still lives in
 * Pi's session and is reloadable via `/resume`). */
const MAX_PERSISTED = 120;

let entryCounter = 0;
function nextEntryId(): string {
    entryCounter += 1;
    return `ase-${entryCounter}`;
}

/**
 * Register a dynamic plugin (carrying its REAL params, M6) AND its palette/menu
 * Action under the open `pluginId`, returning a combined unregister. Shared by
 * `author_dsp_node` and the `author_code_node` authoring bridge so both surface
 * an "Add …" entry and stamp the open identity on the node they create.
 *
 * `params` (M6) flow into the dynamic def's manifest so AutoParamPanel renders the
 * node's true controls; empty for the stored-source path. The returned undo
 * unregisters BOTH the palette/menu Action AND the dynamic plugin, so removing the
 * node leaves no orphaned identity behind.
 */
function registerAuthoredNode(opts: {
    pluginId: string;
    name: string;
    faustSource: string;
    description?: string;
    compiled?: boolean;
    nIn?: number;
    nOut?: number;
    params?: ParamDecl[];
}): () => void {
    const commandId = `ai.dsp.${slug(opts.name)}`;
    const unregisterPlugin = registerDynamicPlugin(
        opts.pluginId,
        makeDspNodeDefinition({
            name: opts.name,
            faustSource: opts.faustSource,
            description: opts.description,
            params: opts.params,
        }),
    );
    const unregisterCommand = registerCommand({
        id: commandId,
        title: `Add ${opts.name}`,
        group: 'AI DSP',
        path: ['AI DSP'],
        keywords: ['ai', 'dsp', 'faust', 'effect', opts.name, ...(opts.description ? [opts.description] : [])],
        targets: ['global', 'canvasPoint', 'selection'],
        surfaces: ['palette', 'menu'],
        run: (ctx?: ActionCtx) => {
            const pos = ctx?.point ?? viewportCenter();
            const parentId = ctx?.node?.id ?? useCanvasNavigationStore.getState().currentViewNodeId;
            const nodeId = useGraphStore.getState().addNode('effect', pos, parentId, {
                aiDsp: true,
                aiDspName: opts.name,
                faustSource: opts.faustSource,
                description: opts.description ?? '',
                compiled: opts.compiled ?? false,
                nIn: opts.nIn ?? 1,
                nOut: opts.nOut ?? 1,
            });
            // Stamp the OPEN identity on the added node (type stays 'effect').
            useGraphStore.getState().setNodePluginId(nodeId, opts.pluginId);
        },
    });
    // Reverting unregisters BOTH the action AND the dynamic plugin.
    return () => {
        unregisterCommand();
        unregisterPlugin();
    };
}

const dspRegistrar: DspNodeRegistrar = {
    registerDspNode(args: AuthorDspNodeArgs): () => void {
        // Open identity follows the kernel: a compiled wasm hash keys
        // `ai.wasm.<hash>`, else the stored Faust source keys `ai.dsp.<srcHash>`.
        const pluginId = args.wasmHash
            ? wasmPluginIdFor(args.wasmHash)
            : dspPluginIdFor(args.faustSource);
        return registerAuthoredNode({
            pluginId,
            name: args.name,
            faustSource: args.faustSource,
            description: args.description,
            compiled: args.compiled,
            nIn: args.nIn,
            nOut: args.nOut,
            params: args.params,
        });
    },

    registerCodeNode(args): () => void {
        // Author reversibly: register the source-fallback synchronously, then (on
        // native) upgrade in place to the compiled `ai.wasm.<hash>` node carrying
        // the real validated params. `dispose` tears down whatever is registered.
        const invoke = getInvoke();
        const { dispose } = authorCodeNode(args, {
            register: (id, name, source, params, description) => ({
                unregister: registerAuthoredNode({
                    pluginId: id,
                    name,
                    faustSource: source,
                    description,
                    compiled: id.startsWith('ai.wasm.'),
                    params,
                }),
            }),
            sourcePluginId: (source) => dspPluginIdFor(source),
            wasmPluginId: (hash) => wasmPluginIdFor(hash),
            invokeAuthor: invoke
                ? async (source, lang) =>
                      (await invoke('author_wasm_node', { source, lang })) as AuthoredNodeResult
                : null,
            parseManifestParams: parseManifestParams,
        });
        return dispose;
    },
};

/** Lift the `params` out of a serialized v1 manifest JSON (native author result). */
function parseManifestParams(manifestJson: string): ParamDecl[] {
    try {
        const parsed = JSON.parse(manifestJson) as { params?: ParamDecl[] };
        return Array.isArray(parsed.params) ? parsed.params : [];
    } catch {
        return [];
    }
}

function viewportCenter(): Position {
    const screenCenter: Position = {
        x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
        y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    };
    return useCanvasStore.getState().screenToCanvas(screenCenter);
}

/** Slugify a node name for a stable command id. */
function slug(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

/**
 * Apply one streamed tool call against the live graph and return its action chip.
 *
 * The mutation flows through the SAME reversible graph-store verbs the UI uses
 * (via {@link applyToolCall}), so it is recorded in the graph's undo history —
 * plain Ctrl+Z reverts it. We don't keep our own undo log anymore (no Reject).
 */
function applyStreamedToolCall(call: AgentToolCall): ActionChip {
    try {
        const store = createGraphStoreApi();
        const result = applyToolCall(
            call,
            store,
            dspRegistrar,
            createPlanEnv(),
            createEnvPort(),
        );
        return { name: call.name, summary: result.summary, ok: result.ok };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            name: call.name,
            summary: `Ignored ${call.name}: ${message}`,
            ok: false,
        };
    }
}

/** Map a loaded session's display messages into renderable conversation entries. */
function toConversationEntries(msgs: DisplayMessage[]): ConversationEntry[] {
    const out: ConversationEntry[] = [];
    for (const m of msgs) {
        if (m.role === 'user') {
            out.push({ id: nextEntryId(), role: 'user', text: m.text });
        } else if (m.role === 'assistant') {
            out.push({
                id: nextEntryId(),
                role: 'assistant',
                markdown: m.text,
                actions: m.tool ? [{ name: m.tool, summary: '', ok: true }] : [],
                streaming: false,
            });
        } else if (m.role === 'tool') {
            // Hang a tool result on the previous assistant turn as a quiet chip.
            const last = out[out.length - 1];
            if (last && last.role === 'assistant') {
                last.actions.push({ name: m.tool ?? 'tool', summary: m.text, ok: true });
            }
        }
        // 'system' messages are not rendered in the chat.
    }
    return out;
}

// ============================================================================
// Store
// ============================================================================

export const useAgentSessionStore = create<AgentSessionStore>()(
    persist(
        (set, get) => ({
            sessionId: null,
            messages: [],
            phase: 'idle',
            error: null,
            runBaseline: null,

            send: async (backend, task) => {
                const userEntry: UserEntry = { id: nextEntryId(), role: 'user', text: task.prompt };
                const assistantId = nextEntryId();
                const assistantEntry: AssistantEntry = {
                    id: assistantId,
                    role: 'assistant',
                    markdown: '',
                    actions: [],
                    streaming: true,
                };
                // Snapshot the pre-run graph so the canvas highlights what's added.
                const runBaseline = new Set(useGraphStore.getState().nodes.keys());
                // G2: open the collab AI frame so the turn lands as one CRDT delta.
                beginAiFrame();
                set((s) => ({
                    messages: [...s.messages, userEntry, assistantEntry],
                    phase: 'running',
                    error: null,
                    runBaseline,
                }));

                // Patch just the in-flight assistant entry.
                const patch = (fn: (a: AssistantEntry) => AssistantEntry) =>
                    set((s) => ({
                        messages: s.messages.map((m) =>
                            m.id === assistantId && m.role === 'assistant' ? fn(m) : m,
                        ),
                    }));

                const finish = (next: Partial<AgentSessionStore>) => {
                    patch((a) => ({ ...a, streaming: false }));
                    commitAiFrame();
                    set({ runBaseline: null, ...next });
                };

                try {
                    for await (const event of backend.run({
                        ...task,
                        sessionId: get().sessionId ?? undefined,
                    })) {
                        switch (event.kind) {
                            case 'thought':
                                patch((a) => ({ ...a, markdown: a.markdown + event.text }));
                                break;
                            case 'tool-call': {
                                const chip = applyStreamedToolCall(event.call);
                                if (!SILENT_TOOLS.has(event.call.name)) {
                                    patch((a) => ({ ...a, actions: [...a.actions, chip] }));
                                }
                                break;
                            }
                            case 'session':
                                set({ sessionId: event.sessionId });
                                break;
                            case 'error':
                                patch((a) => ({ ...a, errored: true }));
                                finish({ phase: 'error', error: event.message });
                                return;
                            case 'result':
                                finish({ phase: 'idle' });
                                return;
                            // tool-result / ui-request carry no chat signal here.
                            case 'tool-result':
                            case 'ui-request':
                                break;
                        }
                    }
                    // Stream ended without a terminal event: settle to idle.
                    finish({ phase: 'idle' });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    patch((a) => ({ ...a, errored: true }));
                    finish({ phase: 'error', error: message });
                }
            },

            newSession: async () => {
                set({ messages: [], phase: 'idle', error: null, runBaseline: null });
                // Reset the live child if one is warm; capture the fresh id. With no
                // warm child this no-ops and the next send spawns a fresh session.
                const res = await runCommand({ type: 'new_session' });
                set({ sessionId: res.sessionId ?? null });
            },

            resumeSession: async (id) => {
                const transcript = await loadSessionMessages(id);
                set({
                    sessionId: id,
                    messages: toConversationEntries(transcript.messages),
                    phase: 'idle',
                    error: null,
                    runBaseline: null,
                });
                return { incomplete: transcript.incomplete };
            },

            listSessions: () => piListSessions(),

            reset: () => {
                set({
                    sessionId: null,
                    messages: [],
                    phase: 'idle',
                    error: null,
                    runBaseline: null,
                });
            },
        }),
        {
            name: 'openjammer-agent-chat',
            version: 1,
            // Persist only the durable conversation + session; never the transient
            // phase/error/baseline. Cap history and freeze any mid-stream entry so
            // a reload never resurrects a "streaming" turn.
            partialize: (s) => ({
                sessionId: s.sessionId,
                messages: s.messages.slice(-MAX_PERSISTED).map((m) =>
                    m.role === 'assistant' ? { ...m, streaming: false } : m,
                ),
            }),
        },
    ),
);

/**
 * Whether `nodeId` is a node the AGENT just added in the live turn — so the
 * canvas can highlight it as it builds. Stays a stable boolean per node so a node
 * only re-renders when its own pending state flips.
 */
export function useIsAgentPending(nodeId: string): boolean {
    return useAgentSessionStore(
        (s) =>
            s.phase === 'running' &&
            s.runBaseline != null &&
            !s.runBaseline.has(nodeId),
    );
}

/** Test-only: hard reset, including the module-level entry counter. */
export function _resetAgentSessionForTests(): void {
    entryCounter = 0;
    useAgentSessionStore.setState({
        sessionId: null,
        messages: [],
        phase: 'idle',
        error: null,
        runBaseline: null,
    });
}
