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
import type { ParamDecl } from '../engine/manifest';
import type { WorkflowPlan } from './plan';

// ============================================================================
// Tool calls — the ONLY thing an agent is allowed to emit
// ============================================================================

/**
 * The v1 tool surface. HARD-CUT scope (project plan):
 *   (a) GRAPH-MUTATION tools that emit the SAME graphStore verbs the UI uses
 *       (`addNode` / `addConnection` / `updateNodeData` — each reversible), and
 *   (b) DSP-NODE AUTHORING: generate Faust source and register an `ai-dsp` node,
 *   (c) READ / INTROSPECTION tools (M3): `get_graph` / `list_node_types` /
 *       `find_nodes` let the agent GROUND its plan in the live graph + registry
 *       before mutating. Reads are SIDE-EFFECT-FREE — their applied undo is a
 *       no-op — so the agent can REUSE existing nodes instead of blindly adding,
 *   (d) `batch_apply` (M3): an ordered list of MUTATION sub-calls executed as ONE
 *       reversible frame — all-or-nothing — so a whole connected workflow lands
 *       (and reverts) atomically.
 * NO app-code self-modify, NO raw WASM, NO running untrusted code on the RT path.
 */
export type AgentToolName =
    | 'add_node'
    | 'remove_node'
    | 'update_node_data'
    | 'add_connection'
    | 'remove_connection'
    | 'author_dsp_node'
    | 'author_code_node'
    | 'get_graph'
    | 'list_node_types'
    | 'find_nodes'
    | 'batch_apply'
    | 'validate_plan'
    | 'emit_plan';

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
    /**
     * The REAL manifest params the native compile reported (M6), so the dynamic
     * plugin carries them and `AutoParamPanel` renders the node's true controls.
     * Optional + back-compat: absent when only source was stored.
     */
    params?: ParamDecl[];
    /**
     * The content-addressed wasm hash from the native author step (M6). When
     * present the dynamic id is keyed `ai.wasm.<hash>`; absent → the legacy
     * `ai.dsp.<sourceHash>` keying (faust unavailable / browser).
     */
    wasmHash?: string;
}

/**
 * Arguments for `author_code_node` (M6): author a BRAND-NEW DSP code node from
 * `source` in language `lang` (defaults `'faust'`).
 *
 * The registrar invokes the native `author_wasm_node` command (Tauri) which
 * compiles `source` to a `.wasm` + a validated v1 manifest; in a browser / when
 * no Tauri is present it stores the source like `author_dsp_node` does today.
 * Either way the result is a FIRST-CLASS dynamic plugin (M5 dynamicRegistry)
 * carrying the node's REAL manifest params, so `AutoParamPanel` renders them.
 * Reversible by unregistering the node + the dynamic plugin.
 */
export interface AuthorCodeNodeArgs {
    /** Human-readable node name (becomes the registered command title). */
    name: string;
    /** The DSP source the agent wrote. */
    source: string;
    /** Source language; defaults to `'faust'`. */
    lang?: string;
    /** Short description for the command palette / node tooltip. */
    description?: string;
}

/**
 * Arguments for the READ tool `get_graph` (M3): none. Returns a compact summary
 * of the WHOLE graph (every node + connection, all levels). SIDE-EFFECT-FREE —
 * applying it never mutates the store and its undo is a no-op.
 */
export type GetGraphArgs = Record<string, never>;

/**
 * Arguments for the READ tool `list_node_types` (M3): none. Returns the set of
 * node types the user can ADD (the registry's user-facing menu set) with their
 * names + descriptions, so the agent picks real types. SIDE-EFFECT-FREE.
 */
export type ListNodeTypesArgs = Record<string, never>;

/**
 * Arguments for the READ tool `find_nodes` (M3): optionally filter the live graph
 * by node `type`; omit to return every node. SIDE-EFFECT-FREE. The agent uses
 * this to REUSE an existing node (e.g. the single speaker) before adding one.
 */
export interface FindNodesArgs {
    /** Restrict results to this node type; omit for all nodes. */
    type?: NodeType;
}

/**
 * Arguments for `batch_apply` (M3): an ORDERED list of MUTATION sub-calls applied
 * as ONE reversible frame. ALL-OR-NOTHING (D3-A1 fail-closed): if any sub-call
 * fails, the whole frame is reverted. A nested `batch_apply` is rejected (no
 * recursion). The single frame is ONE undo on Reject.
 */
export interface BatchApplyArgs {
    /** The sub-calls to run in order (each a normal {@link AgentToolCall}). */
    calls: AgentToolCall[];
}

/**
 * Arguments for the READ tool `validate_plan` (D3, M7): a whole {@link WorkflowPlan}
 * to pre-flight. SIDE-EFFECT-FREE — applying it runs {@link validatePlan} and
 * returns the {@link PlanError}s as `data`, mutating NOTHING (its undo is a no-op).
 * The agent calls it to repair a plan before committing it with `emit_plan`.
 */
export type ValidatePlanArgs = WorkflowPlan;

/**
 * Arguments for `emit_plan` (D3, M7): a whole {@link WorkflowPlan} to BUILD. The
 * tool runs {@link validatePlan} for diagnostics, then LOWERS the plan to
 * `add_node` / `update_node_data` / `add_connection` calls and applies them
 * through the EXISTING `batch_apply` path — so the whole workflow lands (and
 * reverts) as ONE reversible frame. The batch runtime result is authoritative: if
 * the validator passed but a sub-call still fails, that divergence is surfaced in
 * the returned data, never swallowed.
 */
export type EmitPlanArgs = WorkflowPlan;

/** Discriminated union of every concrete tool call an agent may emit. */
export type AgentToolCall =
    | { name: 'add_node'; args: AddNodeArgs }
    | { name: 'remove_node'; args: RemoveNodeArgs }
    | { name: 'update_node_data'; args: UpdateNodeDataArgs }
    | { name: 'add_connection'; args: AddConnectionArgs }
    | { name: 'remove_connection'; args: RemoveConnectionArgs }
    | { name: 'author_dsp_node'; args: AuthorDspNodeArgs }
    | { name: 'author_code_node'; args: AuthorCodeNodeArgs }
    | { name: 'get_graph'; args: GetGraphArgs }
    | { name: 'list_node_types'; args: ListNodeTypesArgs }
    | { name: 'find_nodes'; args: FindNodesArgs }
    | { name: 'batch_apply'; args: BatchApplyArgs }
    | { name: 'validate_plan'; args: ValidatePlanArgs }
    | { name: 'emit_plan'; args: EmitPlanArgs };

// ============================================================================
// Streamed transcript events
// ============================================================================

/**
 * One streamed event from a running agent. The backend yields these as the
 * model "thinks", calls tools, and finishes. The UI renders them as a live
 * transcript; tool-call events are also collected so Approve can apply them.
 */
/**
 * A UI request surfaced from a Pi extension dialog (`extension_ui_request`):
 * `confirm` / `select` / `input` / `editor` / `notify` / … `method` selects the
 * kind; the remaining fields (title, options, message, …) are passed through
 * verbatim. M1 SURFACES these; driving an interactive reply is later work (the
 * native backend auto-cancels blocking dialogs so a run never hangs).
 */
export interface AgentUiRequest {
    method: string;
    [key: string]: unknown;
}

export type AgentEvent =
    /** Free-form reasoning / narration text from the model. */
    | { kind: 'thought'; text: string }
    /** A proposed tool call. NOT yet applied — staged for Approve/Reject. */
    | { kind: 'tool-call'; call: AgentToolCall; id: string }
    /** A terminal success: the agent finished proposing its plan. */
    | { kind: 'result'; summary: string }
    /** A terminal failure (transport error, no backend, model error, ...). */
    | { kind: 'error'; message: string }
    /**
     * The DATA produced by a READ or `batch_apply` tool call (M3), keyed to the
     * originating tool-call id. The session surfaces this in the transcript and
     * (M7) relays it back to Pi over stdin so the model can reason on the live
     * graph it just inspected. NOT a terminal event.
     */
    | { kind: 'tool-result'; toolCallId: string; data: unknown }
    /** A Pi extension UI request (surfaced, not yet interactively answered). */
    | { kind: 'ui-request'; request: AgentUiRequest; id: string };

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
