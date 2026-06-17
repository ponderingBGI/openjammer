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
 * Forward a tool call to the OpenJammer host and resolve with the post-state
 * (D5 round-trip). The host runs a loopback HTTP bridge — its URL + a one-time
 * token are handed to this extension via env at spawn (`OJ_BRIDGE_URL` /
 * `OJ_BRIDGE_TOKEN`). The host applies the call through the SAME reversible
 * graphStore verb the UI drives (optimistically, behind the single turn-end
 * Approve/Reject) and returns `{ ok, data }`, where `data` is the real
 * post-mutation graph summary (or the read result) so Pi reasons on ground truth.
 *
 * If the bridge env is absent the call fails loudly rather than silently
 * no-opping, so a misconfigured install is obvious.
 */
async function forward(name: string, args: Record<string, unknown>): Promise<unknown> {
    const env = (globalThis as any).process?.env ?? {};
    const addr: string | undefined = env.OJ_BRIDGE_ADDR;
    const token: string = env.OJ_BRIDGE_TOKEN ?? '';
    if (!addr) {
        throw new Error(
            `pi-openjammer-graph: tool "${name}" cannot reach the host — ` +
                'OJ_BRIDGE_ADDR is not set (the OpenJammer host bridge is unavailable).',
        );
    }
    const lastColon = addr.lastIndexOf(':');
    const host = addr.slice(0, lastColon);
    const port = Number(addr.slice(lastColon + 1));

    const net: any = await import('node:net');
    return await new Promise((resolve, reject) => {
        const sock = net.connect({ host, port }, () => {
            sock.write(JSON.stringify({ token, name, args }) + '\n');
        });
        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (chunk: string) => {
            buf += chunk;
            const nl = buf.indexOf('\n');
            if (nl < 0) return; // wait for the full line
            sock.end();
            try {
                const payload = JSON.parse(buf.slice(0, nl));
                if (payload && payload.ok === false) {
                    reject(
                        new Error(
                            typeof payload.error === 'string'
                                ? payload.error
                                : `tool "${name}" failed`,
                        ),
                    );
                } else {
                    // `data` is the real post-state the host computed.
                    resolve(payload && 'data' in payload ? payload.data : payload);
                }
            } catch (e) {
                reject(e);
            }
        });
        sock.on('error', reject);
    });
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
