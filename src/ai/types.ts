/**
 * AI agent backend — shared types (U20).
 *
 * OpenJammer's Ctrl/Cmd+K command bar has a SEARCH half (U19) and an AI half
 * (U20). The AI half hands a natural-language task to an "agent" — modelled on
 * Pi (github.com/earendil-works/pi) — which proposes a sequence of graph edits
 * and/or DSP-node authoring steps. This module defines the transport-agnostic
 * contract between the UI and whichever backend actually drives the agent.
 *
 * DESIGN PRINCIPLES (from the project plan):
 * - The agent is an UNTRUSTED GENERATOR, never a trusted runner. It only ever
 *   EMITS {@link AgentToolCall}s — declarative descriptions of graph mutations
 *   or Faust authoring. NOTHING here executes anything; applying a tool call is
 *   a separate, reviewable step (see {@link applyToolCall} in `./tools`).
 * - Every run is TRANSACTIONAL/REVERSIBLE: the session snapshots the graph
 *   before applying, streams a transcript, and gates the result behind an
 *   explicit Approve / Reject (see `../store/agentSessionStore`).
 * - AI is NATIVE/HYBRID ONLY. In a plain browser the Tab->AI path is disabled
 *   ("AI requires the desktop app"); only inside Tauri does the Rust backend
 *   spawn Pi. {@link AgentBackend.available} reports which we're in.
 */

import type { NodeType, Position } from '../engine/types';

// ============================================================================
// Tool calls — the ONLY thing an agent is allowed to emit
// ============================================================================

/**
 * The v1 tool surface. HARD-CUT scope (project plan):
 *   (a) GRAPH-MUTATION tools that emit the SAME graphStore verbs the UI uses
 *       (`addNode` / `addConnection` / `updateNodeData` — each reversible), and
 *   (b) DSP-NODE AUTHORING: generate Faust source and register an `ai-dsp` node.
 * NO app-code self-modify, NO raw WASM, NO running untrusted code on the RT path.
 */
export type AgentToolName =
    | 'add_node'
    | 'remove_node'
    | 'update_node_data'
    | 'add_connection'
    | 'remove_connection'
    | 'author_dsp_node';

/** Arguments for {@link AgentToolName} `add_node`. Mirrors `graphStore.addNode`. */
export interface AddNodeArgs {
    type: NodeType;
    /** Optional canvas position; defaults to the current viewport centre. */
    position?: Position;
    /** Optional parent node id (the canvas level to add into). */
    parentId?: string | null;
    /** Optional initial `data` overrides merged over the definition defaults. */
    initialData?: Record<string, unknown>;
}

/** Arguments for `remove_node`. */
export interface RemoveNodeArgs {
    nodeId: string;
}

/** Arguments for `update_node_data`. Mirrors `graphStore.updateNodeData`. */
export interface UpdateNodeDataArgs {
    nodeId: string;
    data: Record<string, unknown>;
}

/** Arguments for `add_connection`. Mirrors `graphStore.addConnection`. */
export interface AddConnectionArgs {
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
}

/** Arguments for `remove_connection`. */
export interface RemoveConnectionArgs {
    connectionId: string;
}

/**
 * Arguments for `author_dsp_node`: the agent authored Faust source for a new
 * effect/DSP node. The Tauri backend (when libfaust is present) compiles it via
 * the `ojfaust` crate; otherwise the source is stored and a node definition is
 * registered for later compilation. Reversible by deleting the node.
 */
export interface AuthorDspNodeArgs {
    /** Human-readable node name (becomes the registered command title). */
    name: string;
    /** The Faust DSP source the agent wrote. */
    faustSource: string;
    /** Short description for the command palette / node tooltip. */
    description?: string;
    /** Whether the backend reported a successful compile (false when stored only). */
    compiled?: boolean;
    /** Number of audio inputs the DSP reports (from the compiler, if known). */
    nIn?: number;
    /** Number of audio outputs the DSP reports (from the compiler, if known). */
    nOut?: number;
}

/** Discriminated union of every concrete tool call an agent may emit. */
export type AgentToolCall =
    | { name: 'add_node'; args: AddNodeArgs }
    | { name: 'remove_node'; args: RemoveNodeArgs }
    | { name: 'update_node_data'; args: UpdateNodeDataArgs }
    | { name: 'add_connection'; args: AddConnectionArgs }
    | { name: 'remove_connection'; args: RemoveConnectionArgs }
    | { name: 'author_dsp_node'; args: AuthorDspNodeArgs };

// ============================================================================
// Streamed transcript events
// ============================================================================

/**
 * One streamed event from a running agent. The backend yields these as the
 * model "thinks", calls tools, and finishes. The UI renders them as a live
 * transcript; tool-call events are also collected so Approve can apply them.
 */
export type AgentEvent =
    /** Free-form reasoning / narration text from the model. */
    | { kind: 'thought'; text: string }
    /** A proposed tool call. NOT yet applied — staged for Approve/Reject. */
    | { kind: 'tool-call'; call: AgentToolCall; id: string }
    /** A terminal success: the agent finished proposing its plan. */
    | { kind: 'result'; summary: string }
    /** A terminal failure (transport error, no backend, model error, ...). */
    | { kind: 'error'; message: string };

// ============================================================================
// The backend contract
// ============================================================================

/** A task handed to the agent: the user's natural-language prompt + context. */
export interface AgentTask {
    /** The raw text the user typed into the command bar. */
    prompt: string;
    /**
     * The user's configured provider API key, if the UI collected one. The
     * backend forwards ONLY this one key (env allowlist) to Pi and never stores
     * it. Omitted when the user relies on their `~/.pi` config / env instead.
     */
    providerKey?: string;
}

/**
 * Transport-agnostic agent backend. {@link PiAgentBackend} talks to the Tauri
 * command(s) that drive Pi; {@link MockAgentBackend} replays a canned stream so
 * the whole tool-call -> graphStore-verb path is testable without Pi installed.
 */
export interface AgentBackend {
    /** Stable id for diagnostics / store labelling. */
    readonly id: string;

    /**
     * Whether this backend can actually run here. The Pi backend is only
     * available inside the Tauri desktop shell; in a browser it returns false
     * and the UI shows the "AI requires the desktop app" state.
     */
    available(): boolean;

    /**
     * Run a task, yielding {@link AgentEvent}s as they stream in. Implementations
     * MUST end the stream with exactly one terminal event (`result` or `error`)
     * and must surface "no backend" as an `error` event rather than throwing.
     */
    run(task: AgentTask): AsyncIterable<AgentEvent>;
}
