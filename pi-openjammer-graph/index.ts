/**
 * pi-openjammer-graph (D5, M7) — a BUNDLED Pi extension SKELETON.
 *
 * This package registers OpenJammer's graph verbs as Pi tools so a Pi agent can
 * build/edit the canvas natively. Each tool's `execute` ROUND-TRIPS post-state
 * (per D5): it forwards the tool call to the OpenJammer host (which applies it
 * through the SAME reversible store verb the UI uses, behind Approve / Reject)
 * and returns the resulting graph summary, so the model reasons on the live graph
 * it just changed — never on a guess.
 *
 * ── FOUNDER-GATED ──────────────────────────────────────────────────────────
 * This file is a SKELETON. The live mounting — installing it into the Pi worktree,
 * the host RPC the `forward(...)` below stands in for, and the
 * persistent-intelligence install — is the founder build's job (see README.md in
 * this folder). It is deliberately kept OUT of the OpenJammer app build (a Pi
 * resource folder), so it never affects `tsc` / `vitest` / `eslint`.
 *
 * The tool list + the reuse-first guidance MIRROR `src/ai/tools.ts`'s
 * `TOOL_CATALOGUE` and `docs/agent-tools.md`; keep them in sync when the surface
 * changes. (The drift guard lives on the app side: `agentToolsDoc.test.ts`.)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The minimal Pi host surface this skeleton uses (kept loose on purpose). */
interface PiHost {
    /** Register a tool the agent may call. */
    registerTool(tool: PiTool): void;
}

/** One Pi tool: a name, a human description, and an async execute. */
interface PiTool {
    name: string;
    description: string;
    /**
     * Apply the tool call against the OpenJammer host and return the post-state
     * graph summary (D5 round-trip). `args` is the tool's argument object.
     */
    execute(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Forward a tool call to the OpenJammer host and resolve with the post-state.
 *
 * FOUNDER-GATED STUB: the real implementation is the host RPC bridge (Tauri
 * command / stdio channel) that hands the call to `applyToolCall` on the app side
 * and returns the graph summary. Here it throws a clear "not wired" error so a
 * misconfigured install fails loudly rather than silently no-opping.
 */
async function forward(name: string, args: Record<string, unknown>): Promise<unknown> {
    void args;
    throw new Error(
        `pi-openjammer-graph: tool "${name}" is a founder-gated skeleton — ` +
            'wire forward() to the OpenJammer host RPC bridge (see README.md).',
    );
}

/** The graph-verb tool surface, mirroring `src/ai/tools.ts` TOOL_CATALOGUE. */
const TOOLS: ReadonlyArray<Pick<PiTool, 'name' | 'description'>> = [
    { name: 'add_node', description: 'Add a node of the given registry `type` to the canvas.' },
    { name: 'remove_node', description: 'Remove the node with the given `nodeId`.' },
    { name: 'update_node_data', description: "Shallow-merge `data` into a node's data." },
    { name: 'add_connection', description: 'Connect a source port to a target port.' },
    { name: 'remove_connection', description: 'Remove the connection with the given `connectionId`.' },
    { name: 'get_graph', description: 'Read the whole graph (side-effect-free). Reuse before adding.' },
    { name: 'list_node_types', description: 'List the addable node types (side-effect-free).' },
    { name: 'find_nodes', description: 'Find nodes by `type` (side-effect-free). Reuse, do not duplicate.' },
    { name: 'batch_apply', description: 'Apply an ordered list of mutations as ONE atomic frame.' },
    { name: 'validate_plan', description: 'Pre-flight a WorkflowPlan without applying it (side-effect-free).' },
    { name: 'emit_plan', description: 'Build a whole WorkflowPlan in ONE reversible frame.' },
    { name: 'author_dsp_node', description: 'Author a new DSP effect from Faust source — a fallback, not the first move.' },
    { name: 'author_code_node', description: 'Author a new DSP node from source — a fallback, not the first move.' },
];

/**
 * The Pi extension entry point. Registers every graph verb as a Pi tool whose
 * `execute` round-trips post-state through {@link forward}.
 */
export default function register(pi: PiHost): void {
    for (const tool of TOOLS) {
        pi.registerTool({
            name: tool.name,
            description: tool.description,
            execute: (args) => forward(tool.name, args),
        });
    }
}
