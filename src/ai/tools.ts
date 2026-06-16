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
import type {
    AddConnectionArgs,
    AddNodeArgs,
    AgentToolCall,
    AuthorDspNodeArgs,
    RemoveConnectionArgs,
    RemoveNodeArgs,
    UpdateNodeDataArgs,
} from './types';

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
];

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
}

/** Hook the DSP-authoring tool calls into a registrar (the session store). */
export interface DspNodeRegistrar {
    /**
     * Register an authored DSP node so it appears in the command palette and is
     * persisted in the agent session. Returns an unregister function used as the
     * `undo` for `author_dsp_node`.
     */
    registerDspNode(args: AuthorDspNodeArgs): () => void;
}

const NO_OP = (): void => {};

/**
 * Apply a single {@link AgentToolCall} against the graph store, returning a
 * reversible {@link AppliedToolResult}.
 *
 * `store` and `registrar` are injected (not imported) so this stays pure and
 * unit-testable with a fake store — no Zustand, no React, no DOM required.
 */
export function applyToolCall(
    call: AgentToolCall,
    store: GraphStoreApi,
    registrar: DspNodeRegistrar,
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
    }
}

function applyAddNode(args: AddNodeArgs, store: GraphStoreApi): AppliedToolResult {
    const position = args.position ?? store.viewportCenter();
    const id = store.addNode(args.type, position, args.parentId ?? null, args.initialData ?? {});
    return {
        ok: true,
        summary: `Added ${args.type} node (${id}).`,
        undo: once(() => store.removeNode(id)),
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

/** Wrap a side-effecting closure so it runs at most once (idempotent undo). */
function once(fn: () => void): () => void {
    let done = false;
    return () => {
        if (done) return;
        done = true;
        fn();
    };
}
