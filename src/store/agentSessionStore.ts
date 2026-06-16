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
 */

import { create } from 'zustand';
import { register as registerCommand } from './commandRegistry';
import { useGraphStore } from './graphStore';
import { useCanvasStore } from './canvasStore';
import { useCanvasNavigationStore } from './canvasNavigationStore';
import type {
    AgentBackend,
    AgentEvent,
    AgentTask,
    AgentToolCall,
    AuthorDspNodeArgs,
} from '../ai/types';
import { applyToolCall, type AppliedToolResult, type DspNodeRegistrar } from '../ai/tools';
import { createGraphStoreApi } from '../ai/graphAdapter';
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
 * as a command-palette "Add …" entry. `NodeType` is a closed union owned by the
 * read-only engine lane, so until the native ojfaust path promotes the source to
 * a first-class plugin id, the authored node is added as a reversible `effect`
 * node carrying its Faust source in `data`. Reverting unregisters the command.
 */
const dspRegistrar: DspNodeRegistrar = {
    registerDspNode(args: AuthorDspNodeArgs): () => void {
        const commandId = `ai.dsp.${slug(args.name)}`;
        const unregister = registerCommand({
            id: commandId,
            title: `Add ${args.name}`,
            group: 'AI DSP',
            keywords: ['ai', 'dsp', 'faust', 'effect', args.name, ...(args.description ? [args.description] : [])],
            run: () => {
                const center = viewportCenter();
                const parentId = useCanvasNavigationStore.getState().currentViewNodeId;
                useGraphStore.getState().addNode('effect', center, parentId, {
                    aiDsp: true,
                    aiDspName: args.name,
                    faustSource: args.faustSource,
                    description: args.description ?? '',
                    compiled: args.compiled ?? false,
                    nIn: args.nIn ?? 1,
                    nOut: args.nOut ?? 1,
                });
            },
        });
        return unregister;
    },
};

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

/** Apply one streamed tool call and record its undo + a transcript summary. */
function applyStreamedToolCall(call: AgentToolCall): TranscriptEntry {
    const store = createGraphStoreApi();
    const result = applyToolCall(call, store, dspRegistrar);
    appliedResults.push(result);
    return {
        id: nextEntryId(),
        event: { kind: 'tool-call', call, id: nextEntryId() },
        appliedSummary: result.summary,
        applied: result.ok,
    };
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

    start: async (backend, task) => {
        // Clean slate for this run.
        appliedResults = [];
        set({ phase: 'running', prompt: task.prompt, transcript: [], error: null });

        try {
            for await (const event of backend.run(task)) {
                if (event.kind === 'tool-call') {
                    const entry = applyStreamedToolCall(event.call);
                    set((s) => ({ transcript: [...s.transcript, entry] }));
                    continue;
                }

                const entry: TranscriptEntry = { id: nextEntryId(), event };
                set((s) => ({ transcript: [...s.transcript, entry] }));

                if (event.kind === 'error') {
                    // Revert anything applied before the failure; surface the error.
                    revertApplied();
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
            set({ phase: get().transcript.length > 0 ? 'awaiting-approval' : 'idle' });
        } catch (err) {
            revertApplied();
            const message = err instanceof Error ? err.message : String(err);
            set({ phase: 'error', error: message });
        }
    },

    approve: () => {
        // Keep the changes; just drop the undo closures and reset session UI.
        appliedResults = [];
        set({ phase: 'idle', transcript: [], prompt: '', error: null });
    },

    reject: () => {
        revertApplied();
        set({ phase: 'idle', transcript: [], prompt: '', error: null });
    },

    reset: () => {
        // If a run is mid-flight or awaiting approval, reverting is the safe reset.
        revertApplied();
        set({ phase: 'idle', transcript: [], prompt: '', error: null });
    },
}));

/** Test-only: hard reset, including the module-level undo log. */
export function _resetAgentSessionForTests(): void {
    appliedResults = [];
    entryCounter = 0;
    useAgentSessionStore.setState({
        phase: 'idle',
        prompt: '',
        transcript: [],
        error: null,
    });
}
