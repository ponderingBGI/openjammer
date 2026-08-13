/**
 * Host tool-bridge listener (Phase 3) — the frontend half of the loopback bridge.
 *
 * When Pi's `pi-openjammer-graph` extension calls a tool, it round-trips to the
 * native host, which relays it to us as an `oj-bridge-call` event. For READ tools
 * (`get_graph` / `list_node_types` / `find_nodes` / `validate_plan`) we compute the
 * REAL result with the same {@link applyToolCall} the agent uses — reads carry a
 * NO-OP undo and mutate nothing — so Pi reasons on ground truth. WRITE verbs are
 * applied by the streamed `tool-call` path (live, undoable graph verbs with the
 * collab AI-frame guard intact), so here we only ACK them. That split keeps a
 * single verified mutation path and avoids a double-apply.
 *
 * In a plain browser `listen` resolves to null (no Tauri), so this is a no-op.
 */

import { listen, getInvoke } from './tauri';
import { applyToolCall, applyGetSignal, type DspNodeRegistrar } from './tools';
import { createGraphStoreApi } from './graphAdapter';
import { createPlanEnv } from './planAdapter';
import { createEnvPort } from './envAdapter';
import { createArrangementPort } from './arrangementAdapter';
import {
    isAgentToolName,
    type AgentToolCall,
    type AgentToolName,
    type GetSignalArgs,
} from './types';

/** Tools that only READ — safe to run here to return real state to Pi. */
const READ_TOOLS = new Set<AgentToolName>([
    'get_graph',
    'list_node_types',
    'find_nodes',
    'validate_plan',
    // Diagnostics/settings READS: ground-truth env + logs + current settings.
    'get_logs',
    'get_diagnostics',
    'get_settings',
    // Timeline READ: the song summary the agent grounds itself in before editing.
    'describe_arrangement',
]);

/** Reads never register a node; a no-op registrar satisfies the signature. */
const NOOP_REGISTRAR: DspNodeRegistrar = {
    registerDspNode: () => () => {},
    registerCodeNode: () => () => {},
};

interface BridgeCall {
    reqId: number;
    name: string;
    args: Record<string, unknown>;
}

/**
 * Begin answering host bridge calls. Resolves to an unlisten fn (or null in the
 * browser). Safe to call once at app root for the session.
 */
export async function startBridgeListener(): Promise<(() => void) | null> {
    return listen<BridgeCall>('oj-bridge-call', async (payload) => {
        const invoke = getInvoke();
        if (!invoke) return;

        let result: { ok: boolean; data?: unknown; error?: string };
        try {
            if (payload.name === 'save_self_package') {
                // SHAPE-SELF: host-mediated self-modification, NOT a graph tool (so it
                // is not in AGENT_TOOL_NAMES) — handled before the agent-tool guard.
                // The Rust command writes the package + registers it cold-start-deferred.
                const slug = await invoke('ai_save_self_package', payload.args ?? {});
                result = { ok: true, data: { slug } };
            } else if (!isAgentToolName(payload.name)) {
                throw new Error(`Unsupported OpenJammer bridge tool: ${payload.name}`);
            } else if (payload.name === 'get_signal') {
                // The one ASYNC read: a transient meter probe needs a poll tick to
                // settle, so it is handled outside the synchronous applyToolCall.
                const applied = await applyGetSignal(
                    payload.args as unknown as GetSignalArgs,
                    createEnvPort(),
                );
                result = { ok: applied.ok, data: applied.data };
            } else if (READ_TOOLS.has(payload.name)) {
                // The read tool's args ARE its fields; mirror the streamed shape.
                const call = { name: payload.name, args: payload.args } as AgentToolCall;
                const applied = applyToolCall(
                    call,
                    createGraphStoreApi(),
                    NOOP_REGISTRAR,
                    createPlanEnv(),
                    createEnvPort(),
                    createArrangementPort(),
                );
                result = { ok: applied.ok, data: applied.data };
            } else {
                // A write verb — already applied by the streamed tool-call path.
                result = { ok: true };
            }
        } catch (e) {
            result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }

        void invoke('ai_tool_result', { reqId: payload.reqId, result });
    });
}
