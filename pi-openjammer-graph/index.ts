/**
 * pi-openjammer-graph — OpenJammer's bundled Pi graph-tool package.
 *
 * The desktop app loads this extension into Pi's persistent agent home so the
 * model sees OpenJammer canvas verbs as first-class tools. Every tool execution
 * round-trips through the host loopback bridge (`OJ_BRIDGE_ADDR` + token). The
 * host/UI applies the same reversible graph-store verbs the user drives by hand
 * and returns read/post-state data so Pi reasons on the live canvas, not guesses.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/* eslint-disable @typescript-eslint/no-explicit-any */

type JsonObject = Record<string, unknown>;

const Position = Type.Object({
    x: Type.Number({ description: 'Canvas x coordinate.' }),
    y: Type.Number({ description: 'Canvas y coordinate.' }),
});

const JsonRecord = Type.Object({}, { additionalProperties: true });
const EmptyArgs = Type.Object({});
const PlanObject = Type.Object({}, { additionalProperties: true });

async function forward(name: string, args: JsonObject): Promise<unknown> {
    const env = (globalThis as any).process?.env ?? {};
    const addr: string | undefined = env.OJ_BRIDGE_ADDR;
    const token: string = env.OJ_BRIDGE_TOKEN ?? '';
    if (!addr) {
        throw new Error(
            `pi-openjammer-graph: tool "${name}" cannot reach OpenJammer — ` +
                'OJ_BRIDGE_ADDR is not set.',
        );
    }

    const lastColon = addr.lastIndexOf(':');
    const host = addr.slice(0, lastColon);
    const port = Number(addr.slice(lastColon + 1));
    if (lastColon <= 0 || !host || !Number.isInteger(port) || port <= 0) {
        throw new Error(`pi-openjammer-graph: invalid OJ_BRIDGE_ADDR "${addr}".`);
    }
    const net: any = await import('node:net');

    return await new Promise((resolve, reject) => {
        const sock = net.connect({ host, port }, () => {
            sock.write(JSON.stringify({ token, name, args }) + '\n');
        });

        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            fn();
        };
        const fail = (err: unknown) => {
            settle(() => {
                sock.destroy();
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        };
        const succeed = (value: unknown) => {
            settle(() => {
                sock.end();
                resolve(value);
            });
        };

        timeout = setTimeout(() => {
            fail(new Error(`tool "${name}" timed out waiting for OpenJammer host bridge`));
        }, 10_000);

        sock.setEncoding('utf8');
        let buf = '';
        sock.on('data', (chunk: string) => {
            buf += chunk;
            const nl = buf.indexOf('\n');
            if (nl < 0) return;
            try {
                const payload = JSON.parse(buf.slice(0, nl));
                if (payload && payload.ok === false) {
                    fail(
                        new Error(
                            typeof payload.error === 'string'
                                ? payload.error
                                : `tool "${name}" failed`,
                        ),
                    );
                } else {
                    succeed(payload && 'data' in payload ? payload.data : payload);
                }
            } catch (e) {
                fail(e);
            }
        });
        sock.on('close', () => {
            fail(new Error(`tool "${name}" bridge closed before returning a full response`));
        });
        sock.on('error', fail);
    });
}

function toolResultText(data: unknown): string {
    if (data === undefined) return 'OpenJammer accepted the canvas edit.';
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
}

function registerGraphTool(
    pi: ExtensionAPI,
    opts: {
        name: string;
        label: string;
        description: string;
        parameters: unknown;
        promptSnippet: string;
        promptGuidelines?: string[];
    },
): void {
    pi.registerTool({
        name: opts.name,
        label: opts.label,
        description: opts.description,
        promptSnippet: opts.promptSnippet,
        promptGuidelines: opts.promptGuidelines,
        parameters: opts.parameters as never,
        async execute(_toolCallId: string, params: JsonObject) {
            const data = await forward(opts.name, params ?? {});
            return {
                content: [{ type: 'text', text: toolResultText(data) }],
                details: { data },
            };
        },
    });
}

const REUSE_FIRST = [
    'Use get_graph or find_nodes before mutating an existing OpenJammer canvas; reuse existing keyboard/speaker nodes instead of duplicating them.',
    'Use emit_plan or batch_apply for multi-step OpenJammer builds so the whole patch lands as one coherent edit.',
    'OpenJammer graph tools are the only tools that change the canvas; do not use file-editing tools to build a musical patch.',
    'Never ask the user something a read (get_graph, find_nodes, list_node_types) could answer — investigate first; ask only as a genuine last resort.',
];

/**
 * The OpenJammer copilot identity. Appended (chained, never replacing) to Pi's
 * system prompt on every turn via {@link before_agent_start}, so the agent is THE
 * OpenJammer professional from byte one — not a generic coding CLI that asks
 * "an echo node for what?". The reversible-verb + sandbox boundary is named as
 * the LICENSE to be bold; the hard rule (investigate first, ask only as a last
 * resort) is the antidote to needless clarifying questions.
 */
const PERSONA = [
    "You are OpenJammer's in-instrument copilot — the expert on this node-graph MUSIC instrument that people play live (keyboards, instruments, samplers, loopers, effects and speakers wired into sound). You are NOT a generic coding CLI: \"make an echo node\" means add an echo effect to the canvas, never write a program.",
    'You change the canvas ONLY through OpenJammer\'s reversible graph verbs (add_node, add_connection, update_node_data, author_code_node, …). Every edit is one plain Ctrl+Z step for the player and runs inside an OS/Pi sandbox — so be BOLD: design the patch and build it, do not ask permission to act.',
    "Investigate before you ask. Call get_graph / find_nodes / list_node_types and infer the musician's intent from what is already on the canvas. Figure out everything you can on your own; ask the user ONLY when you genuinely cannot resolve it after investigating, and make every question feel necessary. Never ask what a read could answer.",
    'Prefer musical defaults and a held, believable result over a clarifying question. Reuse existing nodes instead of duplicating them. Ports: audio = blue (sound), technical = grey (numbers/triggers). When no built-in node can do the job, author_code_node is the last resort.',
].join('\n\n');

/** Race a host bridge read against a short cap so the first turn never stalls on
 * a slow/absent bridge — the agent can still call get_graph itself. */
async function quickGraph(): Promise<unknown | null> {
    try {
        return await Promise.race([
            forward('get_graph', {}),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
    } catch {
        return null;
    }
}

/** A compact, cheap canvas summary so the agent is never blind on turn one.
 * Returns null for an empty canvas (nothing to ground — build from scratch). */
function buildCanvasDigest(graph: unknown): string | null {
    const g = graph as { nodes?: unknown; connections?: unknown } | null;
    const nodes = Array.isArray(g?.nodes) ? (g!.nodes as Array<{ id?: unknown; type?: unknown }>) : [];
    if (nodes.length === 0) return null;
    const connections = Array.isArray(g?.connections) ? g!.connections : [];
    const counts = new Map<string, number>();
    for (const n of nodes) {
        const t = typeof n?.type === 'string' ? n.type : 'unknown';
        counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const typeSummary = Array.from(counts.entries()).map(([t, c]) => `${t}×${c}`).join(', ');
    const list = nodes
        .slice(0, 24)
        .map((n) => `${typeof n?.id === 'string' ? n.id : '?'}(${typeof n?.type === 'string' ? n.type : '?'})`)
        .join(', ');
    const more = nodes.length > 24 ? `, …(+${nodes.length - 24} more)` : '';
    return [
        `Live OpenJammer canvas right now: ${nodes.length} node(s) — ${typeSummary}; ${connections.length} connection(s).`,
        `Nodes: ${list}${more}.`,
        'Build on these existing nodes and ids; call get_graph or find_nodes for full detail before editing.',
    ].join('\n');
}

export default function register(pi: ExtensionAPI): void {
    registerGraphTool(pi, {
        name: 'add_node',
        label: 'Add OpenJammer Node',
        description: 'Add a node of the given registry type to the OpenJammer canvas.',
        promptSnippet: 'Add an OpenJammer canvas node by registry type',
        promptGuidelines: REUSE_FIRST,
        parameters: Type.Object({
            type: Type.String({ description: 'OpenJammer registry node type, e.g. keyboard, instrument, effect, speaker.' }),
            position: Type.Optional(Position),
            parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            initialData: Type.Optional(JsonRecord),
        }),
    });

    registerGraphTool(pi, {
        name: 'remove_node',
        label: 'Remove OpenJammer Node',
        description: 'Remove a node from the OpenJammer canvas by id.',
        promptSnippet: 'Remove an OpenJammer canvas node by id',
        parameters: Type.Object({ nodeId: Type.String() }),
    });

    registerGraphTool(pi, {
        name: 'update_node_data',
        label: 'Update OpenJammer Node Data',
        description: 'Shallow-merge data into an existing OpenJammer node.',
        promptSnippet: 'Update settings/data on an OpenJammer canvas node',
        parameters: Type.Object({ nodeId: Type.String(), data: JsonRecord }),
    });

    registerGraphTool(pi, {
        name: 'add_connection',
        label: 'Connect OpenJammer Ports',
        description: 'Connect a source port to a target port on the OpenJammer canvas.',
        promptSnippet: 'Connect two OpenJammer canvas ports',
        promptGuidelines: REUSE_FIRST,
        parameters: Type.Object({
            sourceNodeId: Type.String(),
            sourcePortId: Type.String(),
            targetNodeId: Type.String(),
            targetPortId: Type.String(),
        }),
    });

    registerGraphTool(pi, {
        name: 'remove_connection',
        label: 'Remove OpenJammer Connection',
        description: 'Remove a connection from the OpenJammer canvas by id.',
        promptSnippet: 'Remove an OpenJammer canvas cable by id',
        parameters: Type.Object({ connectionId: Type.String() }),
    });

    registerGraphTool(pi, {
        name: 'get_graph',
        label: 'Read OpenJammer Graph',
        description: 'Read the whole OpenJammer graph. Side-effect-free.',
        promptSnippet: 'Read the live OpenJammer graph before planning edits',
        promptGuidelines: REUSE_FIRST,
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'list_node_types',
        label: 'List OpenJammer Node Types',
        description: 'List addable OpenJammer node types. Side-effect-free.',
        promptSnippet: 'List OpenJammer node types available to add',
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'find_nodes',
        label: 'Find OpenJammer Nodes',
        description: 'Find OpenJammer nodes by type, or all nodes when type is omitted. Side-effect-free.',
        promptSnippet: 'Find existing OpenJammer nodes by type',
        promptGuidelines: REUSE_FIRST,
        parameters: Type.Object({ type: Type.Optional(Type.String()) }),
    });

    registerGraphTool(pi, {
        name: 'batch_apply',
        label: 'Batch OpenJammer Edits',
        description: 'Apply ordered OpenJammer mutation calls as one atomic frame.',
        promptSnippet: 'Apply several OpenJammer canvas edits as one frame',
        promptGuidelines: REUSE_FIRST,
        parameters: Type.Object({ calls: Type.Array(Type.Object({}, { additionalProperties: true })) }),
    });

    registerGraphTool(pi, {
        name: 'validate_plan',
        label: 'Validate OpenJammer Plan',
        description: 'Pre-flight an OpenJammer WorkflowPlan without applying it. Side-effect-free.',
        promptSnippet: 'Validate an OpenJammer WorkflowPlan before building it',
        parameters: PlanObject,
    });

    registerGraphTool(pi, {
        name: 'emit_plan',
        label: 'Emit OpenJammer Plan',
        description: 'Build a whole OpenJammer WorkflowPlan in one reversible frame.',
        promptSnippet: 'Build an OpenJammer WorkflowPlan on the live canvas',
        promptGuidelines: REUSE_FIRST,
        parameters: PlanObject,
    });

    registerGraphTool(pi, {
        name: 'author_dsp_node',
        label: 'Author OpenJammer DSP Node',
        description: 'Author a new Faust DSP node for OpenJammer. Use only when built-in nodes cannot do the job.',
        promptSnippet: 'Author a Faust DSP node for OpenJammer when no built-in node fits',
        parameters: Type.Object({
            name: Type.String(),
            faustSource: Type.String(),
            description: Type.Optional(Type.String()),
            compiled: Type.Optional(Type.Boolean()),
            nIn: Type.Optional(Type.Number()),
            nOut: Type.Optional(Type.Number()),
            params: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }))),
            wasmHash: Type.Optional(Type.String()),
        }),
    });

    registerGraphTool(pi, {
        name: 'author_code_node',
        label: 'Author OpenJammer Code Node',
        description: 'Author a new DSP code node for OpenJammer. Use only when built-in nodes cannot do the job.',
        promptSnippet: 'Author a source-code DSP node for OpenJammer when no built-in node fits',
        parameters: Type.Object({
            name: Type.String(),
            source: Type.String(),
            lang: Type.Optional(Type.String()),
            description: Type.Optional(Type.String()),
        }),
    });

    registerGraphTool(pi, {
        name: 'get_logs',
        label: 'Read OpenJammer Logs',
        description: 'Read the on-device OpenJammer DevLog tail. Side-effect-free.',
        promptSnippet: 'Read OpenJammer logs when diagnosing silence, clicks, MIDI, or engine issues',
        parameters: Type.Object({
            levels: Type.Optional(Type.Array(Type.String())),
            scope: Type.Optional(Type.String()),
            search: Type.Optional(Type.String()),
            limit: Type.Optional(Type.Number()),
        }),
    });

    registerGraphTool(pi, {
        name: 'get_diagnostics',
        label: 'Read OpenJammer Diagnostics',
        description: 'Read OpenJammer environment and live audio diagnostics. Side-effect-free.',
        promptSnippet: 'Read OpenJammer diagnostics before fixing audio or MIDI setup',
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'get_settings',
        label: 'Read OpenJammer Settings',
        description: 'Read user-facing OpenJammer settings the agent may inspect/change. Side-effect-free.',
        promptSnippet: 'Read OpenJammer audio/UI settings before proposing a settings change',
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'update_settings',
        label: 'Update OpenJammer Settings',
        description: 'Apply an allowlisted, reversible OpenJammer settings patch.',
        promptSnippet: 'Change safe OpenJammer settings to fix setup issues',
        parameters: Type.Object({ patch: JsonRecord }),
    });

    // Re-ground on the first turn of every session. session_start fires for
    // startup / new / resume / fork — a resumed or forked session may show a
    // different canvas, so each is treated as a fresh "first turn".
    let pendingDigest = true;
    pi.on('session_start', () => {
        pendingDigest = true;
    });

    // Make the agent THE OpenJammer professional from byte one: append the
    // persona to Pi's system prompt every turn (chained — Pi keeps owning the
    // prompt), and inject a compact live-canvas digest ONCE per session so it is
    // never blind on turn one. Both are invisible (system-prompt only), so the
    // transcript stays clean — "report without stealing focus".
    pi.on('before_agent_start', async (event) => {
        let digest: string | null = null;
        if (pendingDigest) {
            pendingDigest = false;
            const graph = await quickGraph();
            digest = buildCanvasDigest(graph);
        }
        const additions = digest ? `${PERSONA}\n\n${digest}` : PERSONA;
        const systemPrompt = `${event.systemPrompt}\n\n${additions}`;

        // Dev-only self-check: the founder-gated preamble (docs/agent-tools.md §7)
        // can't be CI-asserted, so when OJ_AGENT_DEBUG is set we surface — on
        // stderr, never the JSONL stdout protocol — that the append actually
        // landed, with how many chars it added.
        const env = (globalThis as any).process?.env ?? {};
        if (env.OJ_AGENT_DEBUG) {
            console.error(
                `[pi-openjammer-graph] system prompt +${systemPrompt.length - event.systemPrompt.length} chars` +
                    ` (persona${digest ? ' + canvas digest' : ''})`,
            );
        }

        return { systemPrompt };
    });
}
