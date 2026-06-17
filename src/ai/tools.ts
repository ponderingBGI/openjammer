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
 * `undo()` closure, so the session can REVERT the whole batch on Reject without
 * relying on the global history stack. (Graph history is also pushed by the
 * verbs themselves; the explicit undo keeps Reject deterministic and local.)
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
import type {
    AddConnectionArgs,
    AddNodeArgs,
    AgentToolCall,
    AuthorCodeNodeArgs,
    AuthorDspNodeArgs,
    BatchApplyArgs,
    EmitPlanArgs,
    FindNodesArgs,
    RemoveConnectionArgs,
    RemoveNodeArgs,
    UpdateNodeDataArgs,
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
            '"amplifier", "sampler", "speaker"). Mirrors the UI add-node action.',
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
            return applyBatch(call.args, store, registrar, planEnv);
        // PLAN (M7): pure validation + the one-frame plan apply.
        case 'validate_plan':
            return applyValidatePlan(call.args, planEnv);
        case 'emit_plan':
            return applyEmitPlan(call.args, store, registrar, planEnv);
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
 * code-node args onto the legacy stored-source path — so `author_code_node` is
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

        const res = applyToolCall(sub, store, registrar, planEnv);
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
        const res = applyToolCall(call, store, registrar, planEnv);
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

/** Wrap a side-effecting closure so it runs at most once (idempotent undo). */
function once(fn: () => void): () => void {
    let done = false;
    return () => {
        if (done) return;
        done = true;
        fn();
    };
}
