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
 *   or Faust authoring. NOTHING here executes arbitrary code; applying a tool
 *   call is centralized in {@link applyToolCall} in `./tools`.
 * - Every run is LIVE/REVERSIBLE: the session applies allowlisted graph verbs as
 *   they stream, records them through normal graph history, and the player can
 *   undo with plain Ctrl+Z (see `../store/agentSessionStore`).
 * - AI is NATIVE/HYBRID ONLY. In a plain browser the Tab->AI path is disabled
 *   ("AI requires the desktop app"); only inside Tauri does the Rust backend
 *   spawn Pi. {@link AgentBackend.available} reports which we're in.
 */

import type { NodeType, PortDefinition, Position } from '../engine/types';
import type { ParamDecl } from '../engine/manifest';
import type { WorkflowPlan } from './plan';
import type { Verb } from '../song/verbs';
import type { Severity } from '@openjammer/oj-protocol';

// ============================================================================
// Port summaries — the lean port shape the read tools relay to the agent
// ============================================================================

/**
 * A node's port as relayed to the agent by the read tools — the LEAN slice of
 * {@link PortDefinition} the model needs to WIRE correctly: the human NAME (what
 * `add_connection` and a plan wire reference), the direction, and the signal
 * type. We never relay ids, positions, or layout, so the per-node payload stays
 * small even for nodes with dozens of ports. This is the keystone that ends the
 * guess→reject→retry loop: a read now tells the agent the legal port names.
 */
export interface PortSummary {
    /** The human port NAME shown on the canvas (what a wire references). */
    name: string;
    /** Whether the signal flows IN or OUT. */
    direction: 'input' | 'output';
    /** The signal type: 'audio' (blue), 'control' (grey), or 'universal'. */
    type: PortDefinition['type'];
}

/** Reduce a full {@link PortDefinition} to the lean {@link PortSummary}. */
export function toPortSummary(p: PortDefinition): PortSummary {
    return { name: p.name, direction: p.direction, type: p.type };
}

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
export const AGENT_TOOL_NAMES = [
    'add_node',
    'remove_node',
    'update_node_data',
    'add_connection',
    'remove_connection',
    'author_dsp_node',
    'author_code_node',
    'get_graph',
    'list_node_types',
    'find_nodes',
    'batch_apply',
    'validate_plan',
    'emit_plan',
    // Diagnostics & settings (the "help me get it working" surface): the agent
    // can READ the on-device logs + environment and READ/WRITE the safe-allowlist
    // settings, so "why is there no sound?" becomes an answerable, fixable question.
    'get_logs',
    'get_diagnostics',
    'get_signal',
    'get_settings',
    'update_settings',
    'describe_arrangement',
    'edit_timeline',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const AGENT_TOOL_NAME_SET: ReadonlySet<string> = new Set(AGENT_TOOL_NAMES);

/** Runtime guard for Pi JSON: never trust a streamed tool name just because TS says so. */
export function isAgentToolName(name: unknown): name is AgentToolName {
    return typeof name === 'string' && AGENT_TOOL_NAME_SET.has(name);
}

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
     * present the dynamic id is keyed `ai.wasm.<hash>`; absent → the
     * `ai.dsp.<sourceHash>` source-keyed id (faust unavailable / browser).
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
 * recursion). The single frame is one coherent undoable edit.
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

/**
 * Arguments for the READ tool `get_logs`: tail the on-device DevLog ring,
 * optionally filtered. SIDE-EFFECT-FREE. This is how the agent SEES what the app
 * has been doing — engine xruns, node faults, MIDI, asset/plugin events, and
 * every captured `console.*` line — so it can diagnose "there's no sound" from
 * evidence instead of guessing.
 */
export interface GetLogsArgs {
    /** Keep only these severities (omit = all levels). */
    levels?: Severity[];
    /** Keep only this scope tag, e.g. "audio" | "engine" | "midi" | "console" (omit = all). */
    scope?: string;
    /** Case-insensitive substring over message + scope (omit = no text filter). */
    search?: string;
    /** Max entries to return, NEWEST first. Defaults to 50; capped server-side. */
    limit?: number;
}

/**
 * Arguments for the READ tool `get_diagnostics`. With NO `nodeId` it returns the
 * environment + live audio snapshot (version/channel/executor/isolation/platform,
 * plus whether the AudioContext is running, the measured round-trip latency,
 * sample rate, and the selected output device). With a `nodeId` it returns a
 * NODE-scoped debug snapshot — the node's identity (type / plugin id), its ports,
 * its data keys (params AS LAST PUSHED, not a live engine read), a best-effort
 * `degraded` flag, and the recent logs that mention the node — the "why is THIS
 * node silent?" facet for debugging a custom plugin. SIDE-EFFECT-FREE.
 */
export interface GetDiagnosticsArgs {
    /** A canvas node id to diagnose; omit for the environment-wide snapshot. */
    nodeId?: string;
}

/**
 * Arguments for the READ tool `get_signal`: the `nodeId` whose live output peak to
 * probe. SIDE-EFFECT-FREE. The one live RT value that catches a node which compiles
 * and wires correctly yet outputs pure silence (a stuck custom plugin) — reachability
 * and the degraded flag can't see that; only a real meter read can.
 */
export interface GetSignalArgs {
    /** The canvas node id to probe. */
    nodeId: string;
}

/** A node's output level above which we call it "producing sound" (below = silent). */
export const SIGNAL_SILENCE_FLOOR = 1e-3;

/**
 * Result of `get_signal`: an INSTANTANEOUS peak read (0–1), or `null` when no live
 * meter reading is available (the node isn't metered, or audio isn't running). A
 * single sample — if it reads ~0 once, probe again, since a note may simply be
 * between transients.
 */
export interface SignalProbeResult {
    nodeId: string;
    /** Instantaneous output peak in 0–1, or null when no live reading is available. */
    peak: number | null;
    /** True when `peak` is present and above {@link SIGNAL_SILENCE_FLOOR}. */
    hasSignal: boolean;
}

/**
 * Arguments for the READ tool `get_settings`: none. Returns the current
 * user-facing settings the agent is allowed to inspect/change (audio sample
 * rate, latency hint, low-latency mode, input/output device, theme, default
 * velocity). SIDE-EFFECT-FREE.
 */
export type GetSettingsArgs = Record<string, never>;

/**
 * Arguments for `update_settings`: a partial patch over the SAFE ALLOWLIST of
 * settings keys (see {@link GetSettingsArgs}). Unknown keys are ignored (never
 * an error), and the change is REVERSIBLE — applying it returns an undo that
 * restores the previous values, so the agent's "let me try 48 kHz" is as
 * undoable as every graph edit.
 */
export interface UpdateSettingsArgs {
    /** Settings keys to change; only known, safe keys are honoured. */
    patch: SettingsPatch;
}

/** The safe-allowlist settings the agent may read and write. All optional. */
export interface SettingsPatch {
    /** AudioContext sample rate in Hz (e.g. 44100 | 48000 | 96000). */
    sampleRate?: number;
    /** AudioContext latency hint: 'interactive' | 'balanced' | 'playback' | a seconds number. */
    latencyHint?: AudioContextLatencyCategory | number;
    /** Disable echo-cancellation/noise-suppression/AGC for lowest input latency. */
    lowLatencyMode?: boolean;
    /** Selected output device id (`setSinkId`), or null for the system default. */
    outputDeviceId?: string | null;
    /** Selected input device id, or null for the system default. */
    inputDeviceId?: string | null;
    /** UI theme id (e.g. 'cream' | 'cyberpunk' | 'midnight'). */
    themeId?: string;
    /** Default note velocity, 0..1. */
    defaultVelocity?: number;
}

/**
 * Arguments for the READ tool `describe_arrangement`: none. Returns a readable
 * summary of the current SONG TIMELINE — tracks (by stable id), clips, notes (count +
 * pitch range), sections, tempo, and automation, all at bar.beat. SIDE-EFFECT-FREE.
 * The agent calls it to GROUND itself in the arrangement before editing it (the same
 * "read the canvas first" discipline `get_graph` serves for the node graph).
 */
export type DescribeArrangementArgs = Record<string, never>;

/**
 * Arguments for `edit_timeline`: an ORDERED list of reversible timeline {@link Verb}s
 * — the SAME vocabulary a human GUI drag emits — applied live to the ONE Arrangement
 * and undoable with Ctrl+Z (they ride the shared command-log). Ids for ADDED entities
 * may be omitted; they are minted for you. Times are PPQN ticks (read `ppq` + bar
 * positions from `describe_arrangement`). This is how the agent AUTHORS the timeline.
 */
export interface EditTimelineArgs {
    /** The reversible timeline edits to apply, in order, as one undoable step. */
    verbs: Verb[];
}

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
    | { name: 'emit_plan'; args: EmitPlanArgs }
    | { name: 'get_logs'; args: GetLogsArgs }
    | { name: 'get_diagnostics'; args: GetDiagnosticsArgs }
    | { name: 'get_signal'; args: GetSignalArgs }
    | { name: 'get_settings'; args: GetSettingsArgs }
    | { name: 'update_settings'; args: UpdateSettingsArgs }
    | { name: 'describe_arrangement'; args: DescribeArrangementArgs }
    | { name: 'edit_timeline'; args: EditTimelineArgs };

// ============================================================================
// Streamed transcript events
// ============================================================================

/**
 * One streamed event from a running agent. The backend yields these as the
 * model "thinks", calls tools, and finishes. The UI renders them as a live
 * transcript; tool-call events are applied immediately through the allowlisted
 * graph-tool path.
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
    /** Operational status from the Pi runtime; rendered as chrome, not transcript prose. */
    | { kind: 'status'; message: string }
    /** An allowlisted OpenJammer tool call to apply through the reversible graph path. */
    | { kind: 'tool-call'; call: AgentToolCall; id: string }
    /**
     * A SELF-EDIT: Philia editing its OWN memory/skills (writing pi-memory, learning
     * a skill, remembering you) — NOT a canvas tool and NOT an "unsupported" line.
     * It reads as "you editing you": a distinct quiet chip, reversible via Ctrl+K
     * forget rather than a canvas Ctrl+Z. NOT a terminal event.
     */
    | { kind: 'self-edit'; summary: string; id: string }
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
    /**
     * The agent's ACTIVE Pi session id, reported by the native backend so the
     * conversation store can persist it and auto-reattach to the same session on
     * the next run / after a restart. NOT a terminal event.
     */
    | { kind: 'session'; sessionId: string }
    /**
     * A Pi extension UI request, surfaced to the transcript. Blocking dialogs are
     * auto-cancelled in the Tauri backend so a run never hangs; driving an
     * interactive reply is a deferred milestone.
     */
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
    /**
     * All provider API keys configured for this app session, keyed by provider id.
     * Forwarded transiently so Pi can list/select models across configured providers.
     */
    providerKeys?: Record<string, string>;
    /** OpenAI-compatible base URLs configured for this app session, keyed by provider id. */
    providerBaseUrls?: Record<string, string>;
    /** Custom model ids configured/typed for this app session, keyed by provider id. */
    providerCustomModels?: Record<string, string[]>;
    /**
     * The active provider id (e.g. `'opencode'`). Selects the env var the key is
     * forwarded under (see `ai.rs` `provider_env_var`); omitted → Pi's own config.
     */
    provider?: string;
    /**
     * Optional model id to pin for this run via `set_model`; omitted means Pi's
     * configured default for the provider is used.
     */
    modelId?: string;
    /** Desired Pi thinking/reasoning level for the next turn. Updated locally by Shift+Tab. */
    thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    /**
     * YOLO mode (Phase 6): when true the native host drops the OS jail + in-Pi
     * permission-gate and forwards the full shell environment (the real Pi
     * experience). Omitted/false = the default sandbox. Toggling it respawns the
     * warm child. The OpenJammer graph-tool allowlist and undoable apply path are
     * unaffected either way.
     */
    yolo?: boolean;
    /**
     * Resume this Pi session so the run continues that conversation's context.
     * Omitted/undefined means "use Pi's current session"; the backend reports the
     * resolved active id back via a `session` event so the store can persist it.
     */
    sessionId?: string;
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
