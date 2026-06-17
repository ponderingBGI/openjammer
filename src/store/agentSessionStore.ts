/**
 * Agent session store (U20) — the streaming transcript + Approve/Reject
 * transaction behind the Ctrl/Cmd+K AI command bar.
 *
 * LIFECYCLE of one run:
 *   idle --start()--> running  (events stream into `transcript`; each proposed
 *                               tool call is APPLIED IMMEDIATELY against the live
 *                               graph so the user sees the result, but its undo
 *                               closure is recorded)
 *        --(terminal result)--> awaiting-approval
 *   awaiting-approval --approve()--> idle   (keep the changes; discard undos)
 *                     --reject()---> idle   (run every undo in reverse; revert)
 *   running/any --cancel()--> reverts + idle
 *
 * WHY apply-then-revert (optimistic), not stage-then-apply: the agent is an
 * untrusted GENERATOR but the operations are the SAME reversible verbs the user
 * already drives by hand, and showing the proposed graph live is the whole point
 * of a "build what I asked" bar. Reject is a precise, local revert (each
 * applied tool returns its own `undo`), so the transaction stays deterministic
 * regardless of what else touched the graph history meanwhile.
 *
 * This store is the {@link DspNodeRegistrar}: `author_dsp_node` tool calls
 * register a command-palette entry (so the authored DSP node is addable) and are
 * remembered here for the session; rejecting unregisters them.
 *
 * APPROVAL SEMANTICS (G1 / D3-A3 — confirm + comment): tool calls APPLY
 * OPTIMISTICALLY on arrival (the user watches the graph build live), and the
 * SINGLE Approve / Reject fires at the TERMINAL result — i.e. the TURN boundary,
 * not per call. This is intentional: per-call confirmation would stall the stream
 * and defeat "build what I asked". A `batch_apply` is itself ONE undo frame, so
 * the whole connected workflow approves or rejects as a unit.
 *
 * G2 (collab): an AI run is wrapped in a collab "AI frame" ({@link beginAiFrame}
 * on start, {@link commitAiFrame} on approve, {@link discardAiFrame} on
 * reject/error/reset) so the optimistic edits accumulate as ONE CRDT commit (or
 * none) at the turn boundary instead of broadcasting each speculative verb. All
 * frame calls are no-ops with no active session, so single-user is unaffected.
 */

import { create } from 'zustand';
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
import { beginAiFrame, commitAiFrame, discardAiFrame } from '../collab';
import type {
    AgentBackend,
    AgentEvent,
    AgentTask,
    AgentToolCall,
    AuthorDspNodeArgs,
} from '../ai/types';
import {
    applyToolCall,
    type AppliedToolResult,
    type DspNodeRegistrar,
    type PerSubCall,
} from '../ai/tools';
import { createGraphStoreApi } from '../ai/graphAdapter';
import { createPlanEnv } from '../ai/planAdapter';
import type { Position } from '../engine/types';

// ============================================================================
// Types
// ============================================================================

/** Run phase, driving which controls the UI shows. */
export type AgentPhase = 'idle' | 'running' | 'awaiting-approval' | 'error';

/** One rendered transcript line (mirrors {@link AgentEvent} plus a local id). */
export interface TranscriptEntry {
    id: string;
    event: AgentEvent;
    /** For applied tool calls: the human summary of what actually happened. */
    appliedSummary?: string;
    /** For applied tool calls: whether the mutation succeeded. */
    applied?: boolean;
    /**
     * For a `batch_apply` entry (M3): the per-sub-call status, so the line can
     * render as one GROUP summarizing N sub-calls + their individual ok/summary.
     */
    children?: { name: string; ok: boolean; summary: string }[];
    /**
     * For READ tool calls and `batch_apply` (M3): the DATA the tool produced
     * (graph summary / node list / per-sub-call status), surfaced in the
     * transcript so an inspection's result is visible.
     */
    resultData?: unknown;
}

interface AgentSessionStore {
    // --- State ---
    phase: AgentPhase;
    /** The prompt of the in-flight / last run. */
    prompt: string;
    /** The streamed, rendered transcript. */
    transcript: TranscriptEntry[];
    /** Terminal error message, if the run failed. */
    error: string | null;
    /**
     * The graph node ids that existed BEFORE this run started (snapshot taken at
     * {@link start}). Any node NOT in this set while a run is live is one the
     * agent just added — the canvas highlights it so you watch the build happen.
     * `null` when no run is active.
     */
    runBaseline: ReadonlySet<string> | null;

    // --- Actions ---
    /** Start a run with `backend` for `task`. Resolves when the stream ends. */
    start: (backend: AgentBackend, task: AgentTask) => Promise<void>;
    /** Keep all applied changes; clear the session back to idle. */
    approve: () => void;
    /** Revert every applied change (DSP registrations + graph edits); go idle. */
    reject: () => void;
    /** Reset to a clean idle state (used by tests + closing the bar). */
    reset: () => void;
}

// ============================================================================
// Internals (not part of the public store state)
// ============================================================================

/** Undo closures for every applied tool call, in application order. */
let appliedResults: AppliedToolResult[] = [];

let entryCounter = 0;
function nextEntryId(): string {
    entryCounter += 1;
    return `ase-${entryCounter}`;
}

/**
 * Registrar implementation for `author_dsp_node`: surface the authored DSP node
 * as an "Add …" entry on BOTH surfaces (M4) AND give it a FIRST-CLASS OPEN
 * identity (M5).
 *
 * M5: an AI-authored node gets a stable open `pluginId` (`"ai.dsp." +
 * shortHash(faustSource)`) registered in the dynamic registry as an effect-shaped
 * definition, so its display/params/name resolve from that dynamic def. The added
 * node still has `type: 'effect'` (a valid closed NodeType) carrying the Faust
 * source in `data`, so EXECUTION is UNCHANGED — only the identity is now open.
 * (M6 will swap the kernel from stored source to compiled wasm.)
 *
 * Registered as a real {@link Action} (not a legacy zero-arg Command) with
 * `surfaces: ['palette','menu']` and `path: ['AI DSP']`, so an AI-authored node
 * appears in the Ctrl+K palette AND the right-click context menu for free.
 * `run(ctx)` spawns at the menu's clicked `ctx.point` (inside `ctx.node` when a
 * node was right-clicked), else at the viewport centre / current view, and stamps
 * the new node's `pluginId` with the open id.
 *
 * REVERSIBILITY: the returned undo unregisters BOTH the palette/menu Action AND
 * the dynamic plugin, so Reject leaves no orphaned identity behind.
 */
/**
 * Register a dynamic plugin (carrying its REAL params, M6) AND its palette/menu
 * Action under the open `pluginId`, returning a combined unregister. Shared by
 * `author_dsp_node` and the `author_code_node` authoring bridge so both surface
 * an "Add …" entry and stamp the open identity on the node they create.
 *
 * `params` (M6) flow into the dynamic def's manifest so AutoParamPanel renders the
 * node's true controls; empty for the stored-source path.
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
            // Native path: author_faust_native compiles the source to a runnable
            // native .dll AND registers it in the live engine, so the upgraded
            // ai.wasm.<hash> node plays the REAL DSP (the wasm sandbox can't host
            // faust's exception wasm — see docs/code-node-abi.md). Same result shape
            // as author_wasm_node, so the upgrade flow is unchanged. faust is the
            // only code-node language today, so `lang` is implied.
            invokeAuthor: invoke
                ? async (source, _lang) =>
                      (await invoke('author_faust_native', { source })) as AuthoredNodeResult
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
 * Apply one streamed tool call and record its undo + a transcript summary.
 *
 * A `batch_apply` lands as ONE {@link appliedResults} entry — its single undo
 * reverts the whole frame — and its per-sub-call status is hung on the transcript
 * entry's `children` so the UI renders it as one grouped line (M3). READS apply
 * with a NO-OP undo (the result's undo) and carry their `data` into the entry.
 *
 * `toolCallId` is the backend's own id for this tool call (from the streamed
 * `tool-call` event), threaded through so the transcript event keeps the real
 * backend id — the same id a relayed `tool-result` is keyed to (M7) — instead of
 * minting a throwaway counter value.
 */
function applyStreamedToolCall(call: AgentToolCall, toolCallId: string): TranscriptEntry {
    const store = createGraphStoreApi();
    // M7: pass the plan registry env so `validate_plan` / `emit_plan` resolve real
    // types + ports. (Verb-only tool calls ignore it.)
    const result = applyToolCall(call, store, dspRegistrar, createPlanEnv());
    appliedResults.push(result);

    const entry: TranscriptEntry = {
        id: nextEntryId(),
        event: { kind: 'tool-call', call, id: toolCallId },
        appliedSummary: result.summary,
        applied: result.ok,
    };

    // batch_apply AND emit_plan land as ONE appliedResults entry whose single
    // undo reverts the whole frame; their per-sub-call status renders as a grouped
    // line (M3 grouping reused for M7's emit_plan).
    if (call.name === 'batch_apply' || call.name === 'emit_plan') {
        const status = (result.data as { status?: PerSubCall[] } | undefined)?.status ?? [];
        entry.children = status.map((s) => ({ name: s.name, ok: s.ok, summary: s.summary }));
        // Keep the FULL data (status + post-state + validator diagnostics) on the
        // entry so the state the agent must reason on survives into the transcript
        // (and the M7 relay), not just the rendered per-sub-call lines.
        entry.resultData = result.data;
    }
    // Reads (get_graph / list_node_types / find_nodes) and validate_plan carry
    // their inspection result so it is visible in the transcript.
    if (
        call.name === 'get_graph' ||
        call.name === 'list_node_types' ||
        call.name === 'find_nodes' ||
        call.name === 'validate_plan'
    ) {
        entry.resultData = result.data;
    }

    return entry;
}

/** Run every recorded undo in REVERSE order, then clear them. */
function revertApplied(): void {
    for (let i = appliedResults.length - 1; i >= 0; i--) {
        appliedResults[i].undo();
    }
    appliedResults = [];
}

// ============================================================================
// Store
// ============================================================================

export const useAgentSessionStore = create<AgentSessionStore>((set, get) => ({
    phase: 'idle',
    prompt: '',
    transcript: [],
    error: null,
    runBaseline: null,

    start: async (backend, task) => {
        // Clean slate for this run.
        appliedResults = [];
        // G2 (M3): open the collab AI frame BEFORE applying anything so the whole
        // optimistic run accumulates as one CRDT delta (no-op single-user).
        beginAiFrame();
        // Snapshot the pre-run graph so the canvas can highlight what the agent adds.
        const runBaseline = new Set(useGraphStore.getState().nodes.keys());
        set({ phase: 'running', prompt: task.prompt, transcript: [], error: null, runBaseline });

        try {
            for await (const event of backend.run(task)) {
                if (event.kind === 'tool-call') {
                    const entry = applyStreamedToolCall(event.call, event.id);
                    set((s) => ({ transcript: [...s.transcript, entry] }));
                    continue;
                }

                if (event.kind === 'tool-result') {
                    // A read/batch result the backend relayed (e.g. after Pi asked
                    // for the live graph). Surface it as a subtle "↳ result" line so
                    // its data is visible. (M7 owns the real relay back to Pi over
                    // stdin; here we only render what arrived.)
                    const entry: TranscriptEntry = {
                        id: nextEntryId(),
                        event,
                        resultData: event.data,
                    };
                    set((s) => ({ transcript: [...s.transcript, entry] }));
                    continue;
                }

                const entry: TranscriptEntry = { id: nextEntryId(), event };
                set((s) => ({ transcript: [...s.transcript, entry] }));

                if (event.kind === 'error') {
                    // Revert anything applied before the failure; surface the error.
                    revertApplied();
                    discardAiFrame(); // store == pre-run == CRDT; emit nothing
                    set({ phase: 'error', error: event.message });
                    return;
                }
                if (event.kind === 'result') {
                    set({ phase: 'awaiting-approval' });
                    return;
                }
            }
            // Stream ended without a terminal event: treat as completed-for-approval
            // if anything was applied, else idle.
            if (get().transcript.length > 0) {
                set({ phase: 'awaiting-approval' });
            } else {
                // Nothing applied: close the (empty) frame so we don't leave it open.
                discardAiFrame();
                set({ phase: 'idle' });
            }
        } catch (err) {
            revertApplied();
            discardAiFrame();
            const message = err instanceof Error ? err.message : String(err);
            set({ phase: 'error', error: message });
        }
    },

    approve: () => {
        // Keep the changes; just drop the undo closures and reset session UI.
        // G2: commit the accumulated AI delta as ONE collab commit.
        appliedResults = [];
        commitAiFrame();
        set({ phase: 'idle', transcript: [], prompt: '', error: null, runBaseline: null });
    },

    reject: () => {
        revertApplied();
        // G2: store is now back to pre-run (== CRDT) — discard emits nothing.
        discardAiFrame();
        set({ phase: 'idle', transcript: [], prompt: '', error: null, runBaseline: null });
    },

    reset: () => {
        // If a run is mid-flight or awaiting approval, reverting is the safe reset.
        revertApplied();
        discardAiFrame();
        set({ phase: 'idle', transcript: [], prompt: '', error: null, runBaseline: null });
    },
}));

/**
 * Whether `nodeId` is a node the AGENT just added in the live (not-yet-approved)
 * run — so the canvas can highlight it as it builds. Stays a stable boolean per
 * node so a node only re-renders when its own pending state flips.
 */
export function useIsAgentPending(nodeId: string): boolean {
    return useAgentSessionStore(
        (s) =>
            (s.phase === 'running' || s.phase === 'awaiting-approval') &&
            s.runBaseline != null &&
            !s.runBaseline.has(nodeId),
    );
}

/** Test-only: hard reset, including the module-level undo log. */
export function _resetAgentSessionForTests(): void {
    appliedResults = [];
    entryCounter = 0;
    useAgentSessionStore.setState({
        phase: 'idle',
        prompt: '',
        transcript: [],
        error: null,
        runBaseline: null,
    });
}
