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
        }, name === 'export_song' ? 3_600_000 : 10_000);

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

/**
 * Philia — OpenJammer's in-instrument bandmate. Appended (chained, never replacing)
 * to Pi's system prompt on every turn via {@link before_agent_start}, so the agent
 * is Philia from byte one — not a generic coding CLI that asks "an echo node for
 * what?". Three hands, named by what they touch: BUILD the canvas (reversible
 * verbs), SEE everything (logs + node diagnosis), SHAPE-SELF (memory + skills).
 * The reversible-verb + sandbox boundary is the LICENSE to be bold; the hard rule
 * (investigate first, ask only as a last resort) is the antidote to needless
 * clarifying questions. The reuse-first guidance lives here now (one statement),
 * not duplicated across every tool's promptGuidelines.
 */
const PERSONA = [
    "You're Philia — the bandmate inside OpenJammer, a node-graph MUSIC instrument people play LIVE, no second take. Someone may be playing right now. You know this rig cold: keyboards, samplers, loopers, effects and speakers wired into sound. You are NOT a coding CLI — \"make an echo node\" means drop an echo onto the canvas, never write a program about it.",
    "Play like a friend in the room: warm, low-ego, rooting for the take. But the music comes first — say little, build much, never a wall of text while someone's playing. One line when their hands are on the keys; a few short lines when it's quiet. No emoji, no exclamation spam — warmth is in the words.",
    "You work with three hands, named by what they touch. You BUILD the instrument only through OpenJammer's reversible graph verbs (add_node, add_connection, update_node_data, and emit_plan to land a whole patch in one undoable frame) — every edit is one plain Ctrl+Z for the player, so be bold: design the patch and build it, don't ask permission; act, then say what you did in a line. You SEE everything — read the logs and diagnose any node, even a silent custom plugin, from evidence, never a guess; when a silence is tricky, read your debugging skill (pi-memory/debugging.md) first, and OFFER the fix rather than rewiring someone's live set. And you SHAPE YOURSELF — remember the player, teach yourself a skill or a tool, keep what you learn: a preference is a memory, a procedure is a skill, a reusable tool is a package — and keep an about-you.md in memory with what you learn about this player. That's you editing you, not a Ctrl+Z canvas edit, so say so plainly.",
    "Look before you reach: get_graph / find_nodes / list_node_types, and infer intent from what is already wired. Reuse the speaker and the nodes that exist — never add a second of anything. Ask a real question only when a read genuinely can't answer it.",
    'Ports: audio = blue (sound), technical = grey (numbers, triggers). When no built-in node can do the job, authoring a code node is the last resort.',
    'A held note beats a glitch.',
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
        promptSnippet: 'Add an OpenJammer canvas node by registry type',        parameters: Type.Object({
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
        promptSnippet: 'Connect two OpenJammer canvas ports',        parameters: Type.Object({
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
        promptSnippet: 'Read the live OpenJammer graph before planning edits',        parameters: EmptyArgs,
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
        promptSnippet: 'Find existing OpenJammer nodes by type',        parameters: Type.Object({ type: Type.Optional(Type.String()) }),
    });

    registerGraphTool(pi, {
        name: 'batch_apply',
        label: 'Batch OpenJammer Edits',
        description: 'Apply ordered OpenJammer mutation calls as one atomic frame.',
        promptSnippet: 'Apply several OpenJammer canvas edits as one frame',        parameters: Type.Object({ calls: Type.Array(Type.Object({}, { additionalProperties: true })) }),
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
        promptSnippet: 'Build an OpenJammer WorkflowPlan on the live canvas',        parameters: PlanObject,
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
        description:
            'Read OpenJammer environment + live audio diagnostics, or — with a nodeId — ' +
            'a node-scoped debug snapshot (identity, ports, data keys, a degraded flag, ' +
            'and the logs that mention the node) to find why ONE node is silent. Side-effect-free.',
        promptSnippet: 'Read OpenJammer diagnostics; pass a nodeId to debug one node',
        parameters: Type.Object({ nodeId: Type.Optional(Type.String()) }),
    });

    registerGraphTool(pi, {
        name: 'get_signal',
        label: 'Probe OpenJammer Node Signal',
        description:
            "Probe a node's LIVE output peak (0–1) by nodeId, or null when nothing is " +
            'metered / audio is stopped. Side-effect-free. The one live read that catches ' +
            'a node which wires correctly yet outputs silence — if it reads ~0, probe again.',
        promptSnippet: "Probe a node's live output level to tell a wired-but-silent node from a working one",
        parameters: Type.Object({ nodeId: Type.String() }),
    });

    registerGraphTool(pi, {
        name: 'get_settings',
        label: 'Read OpenJammer Settings',
        description: 'Read user-facing OpenJammer settings the agent may inspect/change. Side-effect-free.',
        promptSnippet: 'Read OpenJammer audio/UI settings before proposing a settings change',
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'save_self_package',
        label: 'Save a Self-Authored Tool',
        description:
            'SHAPE-SELF (this is you editing YOU, not the canvas): author yourself a ' +
            'reusable Pi package from `name` + `source` (an index.mjs Pi extension). The ' +
            'host writes it into your brain and registers it; it loads on your NEXT start, ' +
            'never mid-session. Use it when a procedure deserves to be a permanent tool, ' +
            'not just a one-off — a preference is memory, a procedure is a skill, a ' +
            'reusable tool is a package.',
        promptSnippet: 'Author yourself a reusable Pi tool/package (loads on your next start)',
        parameters: Type.Object({
            name: Type.String({ description: 'A short name for the tool; slugified to a package id.' }),
            source: Type.String({ description: 'The package index.mjs source (a Pi extension).' }),
            description: Type.Optional(Type.String()),
        }),
    });

    registerGraphTool(pi, {
        name: 'update_settings',
        label: 'Update OpenJammer Settings',
        description: 'Apply an allowlisted, reversible OpenJammer settings patch.',
        promptSnippet: 'Change safe OpenJammer settings to fix setup issues',
        parameters: Type.Object({ patch: JsonRecord }),
    });

    registerGraphTool(pi, {
        name: 'describe_arrangement',
        label: 'Read OpenJammer Song Timeline',
        description:
            'Read the OpenJammer SONG TIMELINE (the on-canvas DAW arrangement) as a ' +
            'readable summary — tracks (by stable id), clips, addressable note details ' +
            '(id/pitch/tick/duration/velocity, capped per clip), ' +
            'sections, tempo, and automation, all at bar.beat. Side-effect-free. ALWAYS ' +
            'read this before editing the timeline so you target real ids + know the ppq.',
        promptSnippet: 'Read the OpenJammer song timeline before authoring it',
        parameters: EmptyArgs,
    });

    registerGraphTool(pi, {
        name: 'export_song',
        label: 'Export OpenJammer Song',
        description:
            'Native-only: export the current arrangement with the same BounceSpec as the ' +
            'Export dialog. Returns the final path, peak/clipping stats, frames, sample rate, and channels.',
        promptSnippet: 'Export the current OpenJammer song to a native WAV or FLAC file',
        parameters: Type.Object({
            outPath: Type.String({ description: 'Absolute destination file path, including extension.' }),
            sampleRate: Type.Union([Type.Literal(44100), Type.Literal(48000), Type.Literal(88200), Type.Literal(96000)]),
            bitDepth: Type.Union([Type.Literal('16'), Type.Literal('24'), Type.Literal('32f')]),
            format: Type.Union([Type.Literal('wav'), Type.Literal('flac')]),
            tail: Type.Union([
                Type.Object({ mode: Type.Literal('auto') }),
                Type.Object({ mode: Type.Literal('fixed'), seconds: Type.Number({ minimum: 0 }) }),
            ]),
        }),
    });

    registerGraphTool(pi, {
        name: 'edit_timeline',
        label: 'Author OpenJammer Song Timeline',
        description:
            'Author the OpenJammer SONG TIMELINE with an ordered list of reversible ' +
            '`verbs` or shared higher-level `ops`, applied live and undoable with Ctrl+Z. ' +
            'Operation names include armTrack, setClick, setCountIn, and record (start/stop), plus the timeline edit operations. Each verb is `{kind, ...}`. ' +
            'Times are PPQN ticks (read ppq + bar positions from describe_arrangement ' +
            'FIRST). Common verbs: {kind:"setTempo", tempoBpm}; {kind:"setTrackMute", ' +
            'trackId, mute}; {kind:"addClip", trackId, index, clip:{startTick, notes:' +
            '[{tick,durTick,pitch,vel?}]}}; {kind:"moveClip", clipId, startTick}; ' +
            '{kind:"addNote", clipId, index, note:{tick,durTick,pitch,vel?}}; ' +
            '{kind:"editNote", noteId, patch:{tick?,durTick?,pitch?,vel?}}; ' +
            '{kind:"removeClip"|"removeNote"|"removeTrack", ...Id}; {kind:"addSection", ' +
            'index, section:{name, startBar}}; {kind:"addAutomationLane", trackId, index, ' +
            'lane:{ref, param, points:[{tick,value}]}}; {kind:"setAutomationPoint", ' +
            'laneId, point:{tick,value}}; {kind:"setTrackGain",trackId,gainDb}; ' +
            '{kind:"setTrackPan",trackId,pan}; {kind:"setAutomationLaneState",laneId,state:"Off"|"Play"}. Ids for ADDED entities are minted for you — omit them.',
        promptSnippet:
            'Author the OpenJammer song timeline with reversible verbs (read describe_arrangement first)',
        parameters: Type.Object({
            verbs: Type.Optional(Type.Array(Type.Object({ kind: Type.String() }, { additionalProperties: true }))),
            ops: Type.Optional(Type.Array(Type.Union([
                Type.Object({ op: Type.Union([
                    Type.Literal('moveClips'), Type.Literal('trimClip'), Type.Literal('splitAt'),
                    Type.Literal('duplicateClips'), Type.Literal('deleteClips'), Type.Literal('setGrid'),
                    Type.Literal('nudge'), Type.Literal('cutSelection'), Type.Literal('copySelection'),
                    Type.Literal('paste'), Type.Literal('pasteRepeat'), Type.Literal('selectRange'),
                    Type.Literal('deleteRange'), Type.Literal('slipClip'), Type.Literal('splitRange'),
                    Type.Literal('duplicateRange'), Type.Literal('deleteTime'), Type.Literal('insertTime'),
                    Type.Literal('moveNotes'), Type.Literal('copyNotes'), Type.Literal('resizeNotes'),
                    Type.Literal('eraseNotes'),
                ]) }, { additionalProperties: true }),
                Type.Object({
                    op: Type.Literal('drawNote'),
                    clipId: Type.String(),
                    note: Type.Object({
                        tick: Type.Number(), durTick: Type.Number(), pitch: Type.Number(),
                        vel: Type.Optional(Type.Number()),
                    }),
                    overlap: Type.Optional(Type.Union([
                        Type.Literal('relax'), Type.Literal('reject'), Type.Literal('replace'),
                        Type.Literal('truncate-existing'), Type.Literal('truncate-addition'), Type.Literal('extend'),
                    ])),
                }),
                Type.Object({
                    op: Type.Literal('setVelocity'),
                    noteIds: Type.Array(Type.String()),
                    mode: Type.Union([Type.Literal('delta'), Type.Literal('set'), Type.Literal('ramp')]),
                    amount: Type.Optional(Type.Number()), from: Type.Optional(Type.Number()),
                    to: Type.Optional(Type.Number()), smush: Type.Optional(Type.Boolean()),
                }),
                Type.Object({
                    op: Type.Literal('transposeNotes'), noteIds: Type.Array(Type.String()),
                    semitones: Type.Number(),
                }),
                Type.Object({
                    op: Type.Literal('quantizeNotes'), targets: Type.Array(Type.String()), grid: Type.Number(),
                    endGrid: Type.Optional(Type.Number()), snapStart: Type.Optional(Type.Boolean()),
                    snapEnd: Type.Optional(Type.Boolean()), strength: Type.Optional(Type.Number()),
                    swing: Type.Optional(Type.Number()), threshold: Type.Optional(Type.Number()),
                    position: Type.Optional(Type.Number()),
                }),
                Type.Object({
                    op: Type.Literal('setAutomationPoints'), laneId: Type.String(),
                    points: Type.Array(Type.Object({ tick: Type.Number(), value: Type.Number() })),
                }),
                Type.Object({
                    op: Type.Literal('moveAutomationPoints'), laneId: Type.String(),
                    ticks: Type.Array(Type.Number()), deltaTick: Type.Optional(Type.Number()),
                    deltaValue: Type.Optional(Type.Number()), push: Type.Optional(Type.Boolean()),
                }),
                Type.Object({
                    op: Type.Literal('setAutomationRange'), laneId: Type.String(),
                    fromTick: Type.Number(), toTick: Type.Number(),
                    points: Type.Array(Type.Object({ tick: Type.Number(), value: Type.Number() })),
                    factor: Type.Optional(Type.Number()),
                }),
                Type.Object({
                    op: Type.Literal('thinAutomation'), laneId: Type.String(), factor: Type.Optional(Type.Number()),
                }),
                Type.Object({ op: Type.Literal('setTrackGain'), trackId: Type.String(), gainDb: Type.Number() }),
                Type.Object({ op: Type.Literal('setTrackPan'), trackId: Type.String(), pan: Type.Number() }),
                Type.Object({ op: Type.Literal('addAutomationPoint'), laneId: Type.String(), point: Type.Object({ tick: Type.Number(), value: Type.Number() }) }),
                Type.Object({ op: Type.Literal('addAutomationPoints'), laneId: Type.String(), points: Type.Array(Type.Object({ tick: Type.Number(), value: Type.Number() })) }),
                Type.Object({ op: Type.Literal('setLaneState'), laneId: Type.String(), state: Type.Union([Type.Literal('Off'), Type.Literal('Play')]) }),
                Type.Object({ op: Type.Literal('armTrack'), trackId: Type.String(), armed: Type.Boolean() }),
                Type.Object({ op: Type.Literal('setClick'), on: Type.Boolean() }),
                Type.Object({ op: Type.Literal('setCountIn'), bars: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]) }),
                Type.Object({ op: Type.Literal('record'), action: Type.Union([Type.Literal('start'), Type.Literal('stop')]) }),
            ]))),
        }),
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
