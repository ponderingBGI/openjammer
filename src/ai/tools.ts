/**
 * Agent tools — the bridge from an {@link AgentToolCall} to a REAL graphStore
 * mutation (U20).
 *
 * This is the trust boundary in code form. An agent (Pi) only ever EMITS tool
 * calls; this module is the single place that turns one into an actual edit, and
 * it does so EXCLUSIVELY through the same store verbs the UI uses — `addNode`,
 * `addConnection`, `updateNodeData`, `removeNode`, `removeConnection`. There is
 * no eval, no code injection, no RT-path access: the worst an agent can do is
 * the worst a user clicking around the canvas can do, and every step is undoable.
 *
 * Each {@link applyToolCall} returns an {@link AppliedToolResult} carrying an
 * `undo()` closure. Batch/plan tools use those closures internally for
 * all-or-nothing rollback, while normal live edits also enter the graph history
 * so the player can revert with plain Ctrl+Z.
 *
 * The DSP-authoring tool (`author_dsp_node`) is the one tool that does NOT add a
 * node directly: it registers a command-palette entry for the authored DSP node
 * and records the Faust source in the agent session. `NodeType` is a closed
 * union owned by the read-only engine lane, so an authored DSP node is surfaced
 * as a reversible `effect` node carrying its Faust source in `data` until the
 * native ojfaust path promotes it to a first-class plugin id.
 */

import type { GraphStoreApi } from './graphAdapter';
import type { Connection, GraphNode } from '../engine/types';
import type { Severity, Source } from '@openjammer/oj-protocol';
import type {
    AddConnectionArgs,
    AddNodeArgs,
    AgentToolCall,
    AuthorCodeNodeArgs,
    AuthorDspNodeArgs,
    BatchApplyArgs,
    EmitPlanArgs,
    FindNodesArgs,
    GetLogsArgs,
    RemoveConnectionArgs,
    RemoveNodeArgs,
    SettingsPatch,
    UpdateNodeDataArgs,
    UpdateSettingsArgs,
    ValidatePlanArgs,
} from './types';
import { planToToolCalls, type PlanPortResolver, type RefToId } from './plan';
import { validatePlan, type PlanError, type PlanLookups } from './planValidator';

// ============================================================================
// Tool descriptors (the catalogue Pi is told about)
// ============================================================================

/** One tool's name + description, for building the agent's system prompt. */
export interface ToolDescriptor {
    name: AgentToolCall['name'];
    description: string;
}

/**
 * The catalogue of tools the agent may call, in a model-friendly form. The
 * Tauri backend forwards these to Pi as its tool definitions; the descriptions
 * double as documentation for the founder.
 */
export const TOOL_CATALOGUE: readonly ToolDescriptor[] = [
    {
        name: 'add_node',
        description:
            'Add a node of the given registry `type` to the canvas (e.g. "looper", ' +
            '"multiplier", "sampler", "speaker"). Mirrors the UI add-node action.',
    },
    {
        name: 'remove_node',
        description: 'Remove the node with the given `nodeId` (and its dangling connections).',
    },
    {
        name: 'update_node_data',
        description:
            "Shallow-merge `data` into an existing node's data (e.g. set a gain, " +
            'duration, or effect param). Mirrors the UI parameter edits.',
    },
    {
        name: 'add_connection',
        description:
            'Connect `sourceNodeId:sourcePortId` -> `targetNodeId:targetPortId`. ' +
            'Ports must exist and connection rules apply (see registry.canConnect).',
    },
    {
        name: 'remove_connection',
        description: 'Remove the connection with the given `connectionId`.',
    },
    {
        name: 'author_dsp_node',
        description:
            'Author a brand-new DSP effect from Faust source. Registers a ' +
            'command-palette entry; on the desktop build with libfaust present the ' +
            'source is compiled via the ojfaust crate. Reversible by deleting the node.',
    },
    {
        name: 'author_code_node',
        description:
            'author a brand-new DSP node from Faust source — PREFER reusing/stitching ' +
            'existing nodes first. On desktop this compiles the source to a .wasm + a ' +
            'validated manifest and registers a first-class node with its real params; ' +
            'in the browser the source is stored. Reversible by deleting the node.',
    },
    {
        name: 'get_graph',
        description:
            'Read the WHOLE current graph (every node + connection, all levels) as ' +
            'a compact summary. Side-effect-free. Prefer get_graph + find_nodes to ' +
            'REUSE existing nodes before adding new ones.',
    },
    {
        name: 'list_node_types',
        description:
            'List the node types the user can ADD, with names + descriptions, from ' +
            'the registry. Side-effect-free. Call this first so you only ever ' +
            'reference real node types.',
    },
    {
        name: 'find_nodes',
        description:
            'Find nodes in the live graph, optionally filtered by `type` (omit for ' +
            'all). Side-effect-free. Use it to REUSE an existing node (e.g. the ' +
            'single speaker) instead of adding a duplicate.',
    },
    {
        name: 'batch_apply',
        description:
            'Apply an ORDERED list of mutation sub-calls as ONE atomic frame. ' +
            'batch_apply builds a whole connected workflow atomically — ' +
            'all-or-nothing: if any sub-call fails the entire frame is reverted. ' +
            'Applied edits are live and undoable with Ctrl+Z. Cannot be nested.',
    },
    {
        name: 'validate_plan',
        description:
            'Pre-flight a whole WorkflowPlan (nodes by ref, wires by port NAME) ' +
            'WITHOUT applying it. Side-effect-free: returns the structured errors ' +
            '(unknown type/port, bad direction, incompatible ports, feedback cycle, ' +
            'no path to a speaker). Prefer get_graph + find_nodes first to REUSE ' +
            'existing nodes, then validate_plan to repair before emit_plan.',
    },
    {
        name: 'emit_plan',
        description:
            'Build a whole WorkflowPlan in ONE reversible frame: describe nodes by ' +
            'a symbolic ref and wires by port NAME, and emit_plan lowers it to ' +
            'add_node/update_node_data/add_connection applied atomically (each edit ' +
            'undoable with Ctrl+Z). PREFER this for whole workflows; reuse existing ' +
            'nodes via get_graph/find_nodes first, and validate_plan to repair before emitting.',
    },
    {
        name: 'get_logs',
        description:
            'Read the on-device DevLog tail (newest first), optionally filtered by ' +
            '`levels`, `scope`, `search`, and `limit`. Side-effect-free. This is how ' +
            'you SEE engine xruns, node faults, MIDI, asset/plugin events, and every ' +
            'console line — diagnose "no sound" from evidence, not guesses.',
    },
    {
        name: 'get_diagnostics',
        description:
            'Read the environment + live audio snapshot: app version/channel/executor, ' +
            'cross-origin isolation, platform, whether the AudioContext is running, the ' +
            'measured round-trip latency, sample rate, and the selected output device. ' +
            'Side-effect-free. Call it first when the user says something is broken.',
    },
    {
        name: 'get_settings',
        description:
            'Read the user-facing settings you may change: audio sample rate, latency ' +
            'hint, low-latency mode, input/output device, theme, and default velocity. ' +
            'Side-effect-free.',
    },
    {
        name: 'update_settings',
        description:
            'Change settings via a `patch` over the safe allowlist (sampleRate, ' +
            'latencyHint, lowLatencyMode, outputDeviceId, inputDeviceId, themeId, ' +
            'defaultVelocity). Unknown keys are ignored; the change is REVERSIBLE ' +
            '(Ctrl+Z restores the previous values). Use it to FIX a setup — ' +
            'e.g. select the USB interface or switch to the interactive latency hint.',
    },
];

/**
 * Render {@link TOOL_CATALOGUE} to a Markdown list (M7). `docs/agent-tools.md`
 * embeds this so the documented tool surface is GENERATED FROM the catalogue and
 * cannot drift — a test asserts every catalogue name appears in the doc. Each row
 * is `- **<name>** — <description>`.
 */
export function catalogueToMarkdown(): string {
    return TOOL_CATALOGUE.map((t) => `- **${t.name}** — ${t.description}`).join('\n');
}

// ============================================================================
// Applying a tool call
// ============================================================================

/** The outcome of applying one tool call. */
export interface AppliedToolResult {
    /** True if the mutation succeeded. */
    ok: boolean;
    /** Human-readable one-liner for the transcript ("Added Looper node …"). */
    summary: string;
    /** Reverts exactly this mutation. Safe to call once; idempotent thereafter. */
    undo: () => void;
    /**
     * The value relayed back to the agent for READS (`get_graph` / `find_nodes` /
     * `list_node_types`) and for `batch_apply` (per-sub-call status + post-state).
     * Absent for plain mutations. (M3)
     */
    data?: unknown;
    /**
     * The REAL node id assigned by a successful `add_node` (M7). `emit_plan` reads
     * this to map a plan `ref` → its concrete id for wire lowering — a STRUCTURED
     * field, never the summary string, so the plan path is not coupled to summary
     * wording. Absent for every other tool.
     */
    nodeId?: string;
}

/** Per-sub-call status surfaced by {@link applyBatch} so the agent sees WHICH
 * sub-call failed, not just that the frame failed. (D3-A1) */
export interface PerSubCall {
    /** Position of this sub-call in the batch's `calls` array. */
    index: number;
    /** The sub-call's tool name. */
    name: AgentToolCall['name'];
    /** Whether the sub-call applied successfully. */
    ok: boolean;
    /** The sub-call's own one-line summary. */
    summary: string;
}

/** Compact node summary used by the read tools (id/type/data keys). */
export interface NodeSummary {
    id: string;
    type: string;
    /** The KEYS of the node's `data` (not values — keeps the relay small). */
    dataKeys: string[];
}

/** Compact connection summary (id + endpoints) used by the read tools. */
export interface ConnectionSummary {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
}

/** Hook the DSP-authoring tool calls into a registrar (the session store). */
export interface DspNodeRegistrar {
    /**
     * Register an authored DSP node so it appears in the command palette and is
     * persisted in the agent session. Returns an unregister function used as the
     * `undo` for `author_dsp_node`.
     *
     * M6: `args` may now carry the real manifest `params` + `wasmHash` so the
     * registered dynamic plugin renders the node's true controls in
     * `AutoParamPanel` (both fields are optional + back-compat).
     */
    registerDspNode(args: AuthorDspNodeArgs): () => void;

    /**
     * Register a BRAND-NEW DSP code node from source (M6, `author_code_node`).
     *
     * The implementation authors it: native (Tauri) compiles `source` via
     * `author_wasm_node` to a `.wasm` + validated manifest and registers a
     * first-class `ai.wasm.<hash>` dynamic plugin with the REAL params; browser /
     * no-Tauri stores the source like `author_dsp_node` (`ai.dsp.<sourceHash>`).
     * Returns an unregister used as the reversible `undo`.
     *
     * Optional for back-compat: a registrar that predates M6 only implements
     * {@link registerDspNode}, and {@link applyAuthorCodeNode} adapts to it.
     */
    registerCodeNode?(args: AuthorCodeNodeArgs): () => void;
}

const NO_OP = (): void => {};

/**
 * The registry knowledge the PLAN tools need (D3, M7), injected so {@link
 * applyToolCall} stays pure. {@link createPlanEnv} (in `./planAdapter`) binds it
 * to the live registries; tests pass a fake. Optional: when absent, `validate_plan`
 * / `emit_plan` degrade to a clear "not available" result rather than throwing, so
 * every existing caller (which omits it) keeps compiling + working unchanged.
 */
export interface PlanEnv {
    lookups: PlanLookups;
    resolvePort: PlanPortResolver;
}

// ============================================================================
// Diagnostics & settings port (the "help me get it working" surface)
// ============================================================================

/** One DevLog entry as relayed to the agent by `get_logs` (compact, redaction-safe). */
export interface LogEntrySummary {
    /** Wall-clock capture time, ms since epoch. */
    ts: number;
    /** ojproto severity. */
    level: Severity;
    /** Which side emitted it. */
    source: Source;
    /** Short subsystem tag, e.g. "audio" | "engine" | "midi" | "console". */
    scope: string;
    /** Human-readable message. */
    message: string;
    /** Optional structured fields. */
    fields?: Record<string, unknown>;
    /** Optional correlation id. */
    corr?: number;
}

/** The `get_logs` relay: the filtered tail plus ring accounting. */
export interface LogsReadResult {
    /** Total entries currently in the ring (pre-filter). */
    total: number;
    /** How many entries were dropped because the ring filled. */
    dropped: number;
    /** How many entries this result carries (post-filter, post-limit). */
    returned: number;
    /** The matching entries, NEWEST first. */
    entries: LogEntrySummary[];
}

/** The `get_diagnostics` relay: environment + live audio facts. */
export interface DiagnosticsReadResult {
    /** App version (release SSOT). */
    version: string;
    /** Release channel. */
    channel: 'dev' | 'canary' | 'stable';
    /** Selected audio transport, or "(auto)". */
    executor: string;
    /** Whether the page is cross-origin isolated (SharedArrayBuffer fast path). */
    crossOriginIsolated: boolean;
    /** Coarse OS family (e.g. "Win32", "MacIntel"). */
    platform: string;
    /** Whether the AudioContext has been started/resumed. */
    audioReady: boolean;
    /** Live AudioContext sample rate in Hz, or null when audio is not running. */
    sampleRate: number | null;
    /** Estimated round-trip latency for live playing (ms), or null when unknown. */
    estimatedRoundTripMs: number | null;
    /** Human latency classification (e.g. "excellent" | "high"), or null. */
    latencyClass: string | null;
    /** The selected/active output device label, or null for the system default. */
    outputDeviceLabel: string | null;
    /** True when the active output looks like a USB audio interface. */
    usbAudioInterface: boolean;
}

/** The `get_settings` / `update_settings` relay: the safe-allowlist settings. */
export interface SettingsReadResult {
    /** AudioContext sample rate in Hz. */
    sampleRate: number;
    /** AudioContext latency hint. */
    latencyHint: AudioContextLatencyCategory | number;
    /** Whether low-latency input mode is on (echo-cancel/NS/AGC off). */
    lowLatencyMode: boolean;
    /** Selected output device id, or null for the system default. */
    outputDeviceId: string | null;
    /** Selected input device id, or null for the system default. */
    inputDeviceId: string | null;
    /** Active UI theme id. */
    themeId: string;
    /** Default note velocity, 0..1. */
    defaultVelocity: number;
}

/** The outcome of applying an `update_settings` patch (reversible). */
export interface SettingsUpdateResult {
    /** The settings keys that were actually changed (allowlist ∩ patch, value-different). */
    applied: string[];
    /** The settings AFTER the patch. */
    settings: SettingsReadResult;
    /** Restores the previous values for exactly the changed keys. */
    undo: () => void;
}

/**
 * The diagnostics + settings port, injected into {@link applyToolCall} so the
 * tool module stays PURE and unit-testable with a fake. {@link createEnvPort} (in
 * `./envAdapter`) binds it to the live Zustand stores; tests pass an in-memory
 * fake. OPTIONAL everywhere: when a caller omits it, the four diagnostics/settings
 * tools degrade to a clear "not available in this context" result rather than
 * throwing, so every existing caller keeps working unchanged.
 */
export interface AgentEnvPort {
    /** Read the DevLog tail (newest first), filtered by {@link GetLogsArgs}. */
    getLogs(args: GetLogsArgs): LogsReadResult;
    /** Read the environment + live audio diagnostics snapshot. */
    getDiagnostics(): DiagnosticsReadResult;
    /** Read the current safe-allowlist settings. */
    getSettings(): SettingsReadResult;
    /** Apply a settings patch (allowlisted, reversible). */
    updateSettings(patch: SettingsPatch): SettingsUpdateResult;
}

/**
 * Apply a single {@link AgentToolCall} against the graph store, returning a
 * reversible {@link AppliedToolResult}.
 *
 * `store` and `registrar` are injected (not imported) so this stays pure and
 * unit-testable with a fake store — no Zustand, no React, no DOM required.
 * `planEnv` (D3, M7) supplies the registry lookups the plan tools need; it is
 * OPTIONAL so the verb-only callers from M0–M6 are unchanged.
 */
export function applyToolCall(
    call: AgentToolCall,
    store: GraphStoreApi,
    registrar: DspNodeRegistrar,
    planEnv?: PlanEnv,
    env?: AgentEnvPort,
): AppliedToolResult {
    switch (call.name) {
        case 'add_node':
            return applyAddNode(call.args, store);
        case 'remove_node':
            return applyRemoveNode(call.args, store);
        case 'update_node_data':
            return applyUpdateNodeData(call.args, store);
        case 'add_connection':
            return applyAddConnection(call.args, store);
        case 'remove_connection':
            return applyRemoveConnection(call.args, store);
        case 'author_dsp_node':
            return applyAuthorDspNode(call.args, registrar);
        case 'author_code_node':
            return applyAuthorCodeNode(call.args, registrar);
        // READS (M3): side-effect-free; undo is a no-op.
        case 'get_graph':
            return applyGetGraph(store);
        case 'list_node_types':
            return applyListNodeTypes(store);
        case 'find_nodes':
            return applyFindNodes(call.args, store);
        // BATCH (M3): one reversible frame, all-or-nothing.
        case 'batch_apply':
            return applyBatch(call.args, store, registrar, planEnv, env);
        // PLAN (M7): pure validation + the one-frame plan apply.
        case 'validate_plan':
            return applyValidatePlan(call.args, planEnv);
        case 'emit_plan':
            return applyEmitPlan(call.args, store, registrar, planEnv, env);
        // DIAGNOSTICS & SETTINGS: read logs/env/settings; write allowlisted settings.
        case 'get_logs':
            return applyGetLogs(call.args, env);
        case 'get_diagnostics':
            return applyGetDiagnostics(env);
        case 'get_settings':
            return applyGetSettings(env);
        case 'update_settings':
            return applyUpdateSettings(call.args, env);
        default: {
            const name = (call as { name?: unknown }).name;
            return {
                ok: false,
                summary: `Ignored unsupported AI tool "${typeof name === 'string' ? name : 'unknown'}".`,
                undo: NO_OP,
            };
        }
    }
}

function applyAddNode(args: AddNodeArgs, store: GraphStoreApi): AppliedToolResult {
    const position = args.position ?? store.viewportCenter();
    const id = store.addNode(args.type, position, args.parentId ?? null, args.initialData ?? {});
    return {
        ok: true,
        summary: `Added ${args.type} node (${id}).`,
        undo: once(() => store.removeNode(id)),
        nodeId: id,
    };
}

function applyRemoveNode(args: RemoveNodeArgs, store: GraphStoreApi): AppliedToolResult {
    const node = store.getNode(args.nodeId);
    if (!node) {
        return { ok: false, summary: `No node ${args.nodeId} to remove.`, undo: NO_OP };
    }
    // Snapshot the node + its connections so undo can faithfully recreate it.
    const snapshot = store.snapshotNode(args.nodeId);
    store.removeNode(args.nodeId);
    return {
        ok: true,
        summary: `Removed ${node.type} node (${args.nodeId}).`,
        undo: once(() => store.restoreNode(snapshot)),
    };
}

function applyUpdateNodeData(args: UpdateNodeDataArgs, store: GraphStoreApi): AppliedToolResult {
    const node = store.getNode(args.nodeId);
    if (!node) {
        return { ok: false, summary: `No node ${args.nodeId} to update.`, undo: NO_OP };
    }
    // Capture only the keys we are about to overwrite, for a precise revert.
    const prev: Record<string, unknown> = {};
    for (const key of Object.keys(args.data)) {
        prev[key] = (node.data as Record<string, unknown>)[key];
    }
    store.updateNodeData(args.nodeId, args.data);
    const keys = Object.keys(args.data).join(', ');
    return {
        ok: true,
        summary: `Updated ${node.type} (${args.nodeId}) data: ${keys}.`,
        undo: once(() => store.updateNodeData(args.nodeId, prev)),
    };
}

function applyAddConnection(args: AddConnectionArgs, store: GraphStoreApi): AppliedToolResult {
    const id = store.addConnection(
        args.sourceNodeId,
        args.sourcePortId,
        args.targetNodeId,
        args.targetPortId,
    );
    if (id === null) {
        return {
            ok: false,
            summary:
                `Could not connect ${args.sourceNodeId}:${args.sourcePortId} -> ` +
                `${args.targetNodeId}:${args.targetPortId} (invalid or duplicate).`,
            undo: NO_OP,
        };
    }
    return {
        ok: true,
        summary:
            `Connected ${args.sourceNodeId}:${args.sourcePortId} -> ` +
            `${args.targetNodeId}:${args.targetPortId}.`,
        undo: once(() => store.removeConnection(id)),
    };
}

function applyRemoveConnection(
    args: RemoveConnectionArgs,
    store: GraphStoreApi,
): AppliedToolResult {
    const conn = store.getConnection(args.connectionId);
    if (!conn) {
        return {
            ok: false,
            summary: `No connection ${args.connectionId} to remove.`,
            undo: NO_OP,
        };
    }
    store.removeConnection(args.connectionId);
    return {
        ok: true,
        summary: `Removed connection ${args.connectionId}.`,
        // Re-add by the same endpoints (a new id is assigned; semantically equal).
        undo: once(() => {
            store.addConnection(
                conn.sourceNodeId,
                conn.sourcePortId,
                conn.targetNodeId,
                conn.targetPortId,
            );
        }),
    };
}

function applyAuthorDspNode(
    args: AuthorDspNodeArgs,
    registrar: DspNodeRegistrar,
): AppliedToolResult {
    const unregister = registrar.registerDspNode(args);
    const state = args.compiled ? 'compiled' : 'stored (compile when libfaust available)';
    return {
        ok: true,
        summary: `Authored DSP node "${args.name}" — ${state}.`,
        undo: once(unregister),
    };
}

/**
 * `author_code_node` (M6): author a brand-new DSP code node from `source`.
 *
 * Routes through {@link DspNodeRegistrar.registerCodeNode} when the registrar
 * supports it (native authors Faust→`.wasm` + a validated manifest and registers
 * an `ai.wasm.<hash>` dynamic plugin with the REAL params). A registrar predating
 * M6 (only {@link DspNodeRegistrar.registerDspNode}) is adapted by mapping the
 * code-node args onto the stored-source path — so `author_code_node` is
 * back-compatible with `author_dsp_node` and never silently drops a node.
 */
function applyAuthorCodeNode(
    args: AuthorCodeNodeArgs,
    registrar: DspNodeRegistrar,
): AppliedToolResult {
    const lang = args.lang ?? 'faust';
    const unregister = registrar.registerCodeNode
        ? registrar.registerCodeNode({ ...args, lang })
        : registrar.registerDspNode({
              name: args.name,
              faustSource: args.source,
              description: args.description,
              compiled: false,
          });
    return {
        ok: true,
        summary: `Authored code node "${args.name}" (${lang}).`,
        undo: once(unregister),
    };
}

// ============================================================================
// Reads (M3) — side-effect-free; undo is a NO_OP
// ============================================================================

/** Compact a node to id/type/data-keys (the read tools never leak full data). */
function summarizeNode(node: GraphNode): NodeSummary {
    return {
        id: node.id,
        type: node.type,
        dataKeys: Object.keys((node.data ?? {}) as Record<string, unknown>),
    };
}

/** Compact a connection to id + endpoints. */
function summarizeConnection(conn: Connection): ConnectionSummary {
    return {
        id: conn.id,
        sourceNodeId: conn.sourceNodeId,
        sourcePortId: conn.sourcePortId,
        targetNodeId: conn.targetNodeId,
        targetPortId: conn.targetPortId,
    };
}

/** The whole-graph summary, shared by `get_graph` and `batch_apply` post-state. */
function graphSummary(store: GraphStoreApi): {
    nodes: NodeSummary[];
    connections: ConnectionSummary[];
} {
    return {
        nodes: store.listNodes().map(summarizeNode),
        connections: store.listConnections().map(summarizeConnection),
    };
}

function applyGetGraph(store: GraphStoreApi): AppliedToolResult {
    const data = graphSummary(store);
    return {
        ok: true,
        summary: `Read graph: ${data.nodes.length} node(s), ${data.connections.length} connection(s).`,
        undo: NO_OP,
        data,
    };
}

function applyListNodeTypes(store: GraphStoreApi): AppliedToolResult {
    const types = store.listNodeTypes();
    return {
        ok: true,
        summary: `Listed ${types.length} addable node type(s).`,
        undo: NO_OP,
        data: types,
    };
}

function applyFindNodes(args: FindNodesArgs, store: GraphStoreApi): AppliedToolResult {
    const matches = (args.type ? store.findNodesByType(args.type) : store.listNodes()).map(
        summarizeNode,
    );
    const scope = args.type ? `"${args.type}"` : 'any type';
    return {
        ok: true,
        summary: `Found ${matches.length} node(s) of ${scope}.`,
        undo: NO_OP,
        data: matches,
    };
}

// ============================================================================
// batch_apply (M3) — one reversible frame, ALL-OR-NOTHING (D3-A1 fail-closed)
// ============================================================================

/**
 * Apply an ordered list of mutation sub-calls as ONE frame.
 *
 * RECURSION GUARD: a nested `batch_apply` sub-call is rejected (ok:false) — a
 * batch is a flat list of mutations, never a tree.
 *
 * FAIL-CLOSED: sub-calls run in order; the first `ok===false` aborts the frame.
 * Every already-applied sub-undo is then run in REVERSE (reverting the whole
 * frame) and we return ok:false with per-sub-call status (so the agent sees
 * WHICH sub-call failed) plus the graph summary AFTER the revert.
 *
 * On full success: undo() runs all sub-undos in reverse exactly once.
 */
function applyBatch(
    args: BatchApplyArgs,
    store: GraphStoreApi,
    registrar: DspNodeRegistrar,
    planEnv?: PlanEnv,
    env?: AgentEnvPort,
): AppliedToolResult {
    const subUndos: Array<() => void> = [];
    const status: PerSubCall[] = [];
    let failed = false;

    for (let i = 0; i < args.calls.length; i++) {
        const sub = args.calls[i];

        // Recursion guard: a batch may not contain another batch — nor a plan
        // tool (emit_plan itself lowers TO a batch, so it must never be a member).
        if (sub.name === 'batch_apply' || sub.name === 'emit_plan') {
            status.push({
                index: i,
                name: sub.name,
                ok: false,
                summary: `Nested ${sub.name} is not allowed inside batch_apply.`,
            });
            failed = true;
            break;
        }

        const res = applyToolCall(sub, store, registrar, planEnv, env);
        status.push({ index: i, name: sub.name, ok: res.ok, summary: res.summary });
        if (res.ok) {
            subUndos.push(res.undo);
        } else {
            failed = true;
            break;
        }
    }

    if (failed) {
        // Revert the already-collected sub-undos in REVERSE — the whole frame.
        for (let i = subUndos.length - 1; i >= 0; i--) {
            subUndos[i]();
        }
        const okCount = status.filter((s) => s.ok).length;
        return {
            ok: false,
            summary: `batch_apply failed: reverted ${okCount} applied sub-call(s) of ${args.calls.length}.`,
            undo: NO_OP, // already reverted; nothing left to undo
            data: { status, postState: graphSummary(store) },
        };
    }

    return {
        ok: true,
        summary: `batch_apply applied ${args.calls.length} sub-call(s).`,
        undo: once(() => {
            for (let i = subUndos.length - 1; i >= 0; i--) {
                subUndos[i]();
            }
        }),
        data: { status, postState: graphSummary(store) },
    };
}

// ============================================================================
// validate_plan / emit_plan (M7) — the higher-altitude PLAN path (D3)
// ============================================================================

/** The "plan tools need their registry env" message, shared by both plan tools. */
const PLAN_ENV_MISSING =
    'plan tools require the registry environment; this caller did not provide it';

/**
 * `validate_plan` (D3-A?): run {@link validatePlan} and RELAY its
 * {@link PlanError}[] as data. SIDE-EFFECT-FREE — mutates nothing, undo is a
 * no-op. Without a {@link PlanEnv} it cannot resolve types/ports, so it returns a
 * single advisory error rather than throwing.
 */
function applyValidatePlan(args: ValidatePlanArgs, planEnv?: PlanEnv): AppliedToolResult {
    if (!planEnv) {
        const errors: PlanError[] = [
            { code: 'UNKNOWN_TYPE', message: PLAN_ENV_MISSING },
        ];
        return { ok: true, summary: 'validate_plan: registry unavailable.', undo: NO_OP, data: errors };
    }
    const errors = validatePlan(args, planEnv.lookups);
    return {
        ok: true,
        summary:
            errors.length === 0
                ? 'validate_plan: plan is valid.'
                : `validate_plan: ${errors.length} issue(s) found.`,
        undo: NO_OP,
        data: errors,
    };
}

/**
 * `emit_plan` (D3-A2): build a whole {@link WorkflowPlan} as ONE reversible frame.
 *
 * Pipeline:
 *   1. run {@link validatePlan} for DIAGNOSTICS (advisory — the apply is still
 *      attempted so the runtime is authoritative, and a validator/runtime
 *      divergence is surfaced, never swallowed);
 *   2. apply each node's `add_node` in plan order, capturing the REAL id into a
 *      {@link RefToId} map;
 *   3. lower the param-updates + wires via {@link planToToolCalls} (now that refs
 *      resolve to ids + port names resolve to ids) and apply them in order;
 *   4. fail-closed — the first failing sub-call reverts the WHOLE frame; success
 *      yields ONE undo that reverts everything in reverse.
 *
 * The result carries `{ status, postState, validatorErrors, divergence }` so the
 * caller (and the relayed transcript) sees both the validator's view and the
 * runtime truth. `divergence` is true when the validator passed but a sub-call
 * still failed (or vice-versa) — the honest "the validator and runtime disagree"
 * signal.
 */
function applyEmitPlan(
    args: EmitPlanArgs,
    store: GraphStoreApi,
    registrar: DspNodeRegistrar,
    planEnv?: PlanEnv,
    env?: AgentEnvPort,
): AppliedToolResult {
    if (!planEnv) {
        return {
            ok: false,
            summary: `emit_plan failed: ${PLAN_ENV_MISSING}.`,
            undo: NO_OP,
            data: { status: [], postState: graphSummary(store), validatorErrors: [], divergence: false },
        };
    }

    // 1) Diagnostics (advisory — we still attempt the apply; runtime is truth).
    const validatorErrors = validatePlan(args, planEnv.lookups);

    const subUndos: Array<() => void> = [];
    const status: PerSubCall[] = [];
    const refToId: RefToId = {};
    let failed = false;
    let index = 0;

    const runSub = (call: AgentToolCall, name: AgentToolCall['name']): AppliedToolResult => {
        const res = applyToolCall(call, store, registrar, planEnv, env);
        status.push({ index: index++, name, ok: res.ok, summary: res.summary });
        if (res.ok) subUndos.push(res.undo);
        else failed = true;
        return res;
    };

    // 2) Create nodes first, capturing each ref's real id for wire resolution.
    for (const node of args.nodes) {
        const lowered = planToToolCalls(
            { nodes: [node], wires: [] },
            refToId,
            planEnv.resolvePort,
        );
        // For a single node with no params, planToToolCalls yields ONE add_node.
        const addCall = lowered[0];
        const res = runSub(addCall, 'add_node');
        if (!res.ok) break;
        // Map the plan ref to the REAL id from the structured result field (not the
        // summary string) so wire lowering resolves it to a concrete node id.
        if (res.nodeId) refToId[node.ref] = res.nodeId;
    }

    // 3) Lower the remaining steps (param updates + wires) now refs resolve, and
    //    apply them in order. Skipped entirely if node creation already failed.
    if (!failed) {
        const rest = planToToolCalls(args, refToId, planEnv.resolvePort).filter(
            (c) => c.name !== 'add_node',
        );
        for (const call of rest) {
            const res = runSub(call, call.name);
            if (!res.ok) break;
        }
    }

    if (failed) {
        for (let i = subUndos.length - 1; i >= 0; i--) subUndos[i]();
        const okCount = status.filter((s) => s.ok).length;
        // Divergence: the validator said "valid" but the runtime still failed.
        const divergence = validatorErrors.length === 0;
        return {
            ok: false,
            summary: `emit_plan failed: reverted ${okCount} applied step(s) of ${status.length}.`,
            undo: NO_OP,
            data: { status, postState: graphSummary(store), validatorErrors, divergence },
        };
    }

    // Divergence: the runtime applied cleanly but the validator had flagged it.
    const divergence = validatorErrors.length > 0;
    return {
        ok: true,
        summary: `emit_plan applied ${status.length} step(s) for ${args.nodes.length} node(s).`,
        undo: once(() => {
            for (let i = subUndos.length - 1; i >= 0; i--) subUndos[i]();
        }),
        data: { status, postState: graphSummary(store), validatorErrors, divergence },
    };
}

// ============================================================================
// Diagnostics & settings handlers — the "help me get it working" surface
// ============================================================================

/** The shared "this caller didn't wire the diagnostics/settings port" message. */
const ENV_MISSING =
    'diagnostics/settings are not available in this context (no environment port wired)';

/**
 * `get_logs`: relay the on-device DevLog tail (newest first). SIDE-EFFECT-FREE.
 * Without an {@link AgentEnvPort} it returns an empty, clearly-labelled result
 * rather than throwing, so a caller that omits the port still gets a valid shape.
 */
function applyGetLogs(args: GetLogsArgs, env?: AgentEnvPort): AppliedToolResult {
    if (!env) {
        return {
            ok: true,
            summary: `get_logs: ${ENV_MISSING}.`,
            undo: NO_OP,
            data: { total: 0, dropped: 0, returned: 0, entries: [] } satisfies LogsReadResult,
        };
    }
    const result = env.getLogs(args);
    const filt = args.search || args.scope || args.levels ? ' (filtered)' : '';
    return {
        ok: true,
        summary: `Read ${result.returned} of ${result.total} log entr${result.total === 1 ? 'y' : 'ies'}${filt}${result.dropped ? `, ${result.dropped} dropped` : ''}.`,
        undo: NO_OP,
        data: result,
    };
}

/** `get_diagnostics`: relay the environment + live audio snapshot. SIDE-EFFECT-FREE. */
function applyGetDiagnostics(env?: AgentEnvPort): AppliedToolResult {
    if (!env) {
        return { ok: true, summary: `get_diagnostics: ${ENV_MISSING}.`, undo: NO_OP, data: null };
    }
    const d = env.getDiagnostics();
    const audio = d.audioReady
        ? `audio running @ ${d.sampleRate ?? '?'} Hz${d.estimatedRoundTripMs != null ? `, ~${Math.round(d.estimatedRoundTripMs)} ms round-trip` : ''}`
        : 'audio NOT started';
    return {
        ok: true,
        summary: `OpenJammer ${d.version} (${d.channel}) — ${audio}.`,
        undo: NO_OP,
        data: d,
    };
}

/** `get_settings`: relay the current safe-allowlist settings. SIDE-EFFECT-FREE. */
function applyGetSettings(env?: AgentEnvPort): AppliedToolResult {
    if (!env) {
        return { ok: true, summary: `get_settings: ${ENV_MISSING}.`, undo: NO_OP, data: null };
    }
    const s = env.getSettings();
    return {
        ok: true,
        summary: `Settings: ${s.sampleRate} Hz, latency "${String(s.latencyHint)}", low-latency ${s.lowLatencyMode ? 'on' : 'off'}, theme "${s.themeId}".`,
        undo: NO_OP,
        data: s,
    };
}

/**
 * `update_settings`: apply an allowlisted, REVERSIBLE settings patch.
 *
 * The port validates the patch against the safe allowlist and returns the
 * applied keys + the post-patch settings + an `undo` that restores the previous
 * values — so this tool is exactly as reversible as a graph edit (Ctrl+Z).
 * A patch that changes nothing is a successful no-op.
 */
function applyUpdateSettings(args: UpdateSettingsArgs, env?: AgentEnvPort): AppliedToolResult {
    if (!env) {
        return { ok: false, summary: `update_settings failed: ${ENV_MISSING}.`, undo: NO_OP };
    }
    const patch: SettingsPatch = args.patch ?? {};
    const { applied, settings, undo } = env.updateSettings(patch);
    if (applied.length === 0) {
        return {
            ok: true,
            summary: 'update_settings: no allowlisted changes to apply (no-op).',
            undo: NO_OP,
            data: { applied, settings },
        };
    }
    return {
        ok: true,
        summary: `Updated settings: ${applied.join(', ')}.`,
        undo: once(undo),
        data: { applied, settings },
    };
}

/** Wrap a side-effecting closure so it runs at most once (idempotent undo). */
function once(fn: () => void): () => void {
    let done = false;
    return () => {
        if (done) return;
        done = true;
        fn();
    };
}
