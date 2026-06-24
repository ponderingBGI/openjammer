// src/song/conduct.ts — the ONE pure timeline lowering. The temporal sibling of
// `emitOjGraph`: it turns an Arrangement into the flat {OjGraph, schedule} the
// engine ALREADY plays, reusing emitWithIndex + remapForBackend (graph) and plain
// tempo arithmetic (time). No kernel changes; a headless bounce is bit-identical to
// a live take by construction (BOUNDARY §9). Automation lowers to STEPPED setParam
// events that ride the engine's per-sample smoothers (block-quantized for now; the
// at-frame ring is a later quality upgrade, not a prerequisite).

import { emitWithIndex } from '../audio/ojgraph/emit';
import { remapForBackend } from '../audio/ojgraph';
import { clampMidi } from '../music/note';
import { specToGraph } from './spec';
import type { Arrangement, CodeNode, ScheduleEvent } from './types';
import type { IrNode, OjGraph } from '../../packages/oj-protocol-ts/src/index';

export interface ConductResult {
    /** The flat IR, backend-remapped for native — exactly what `oj render` loads. */
    graph: OjGraph;
    /** The note/param schedule in seconds — exactly the render bin's SchedEvent shape. */
    events: ScheduleEvent[];
    /** Total render length in seconds (last event + a release tail). */
    seconds: number;
    /** Surviving track ref -> IR NodeIdx (the agent's read surface / debugging). */
    trackIndex: Record<string, number>;
    /** Agent-authored code nodes that were spliced into the IR — `oj song` writes
     * each source to a .dsp and passes `--code-node id=path` to the render bin. */
    codeNodes: CodeNode[];
}

const DEFAULTS = { ppq: 960, sampleRate: 48_000, blockSize: 256 } as const;

/** setParam settles, then old notes release, then new notes start (same instant). */
function kindRank(cmd: ScheduleEvent['cmd']): number {
    return cmd === 'setParam' ? 0 : cmd === 'noteOff' ? 1 : 2;
}

/** A deterministic per-kind tiebreak (a setParam by its param id, a note by its
 * pitch) so two events at the same tick/kind/node still order stably. */
function evDetail(ev: ScheduleEvent): number {
    if (ev.cmd === 'setParam') return ev.param;
    if (ev.cmd === 'noteOn' || ev.cmd === 'noteOff') return ev.note;
    return 0;
}

function clampVel(v: number | undefined): number {
    return Math.max(0, Math.min(127, Math.round(v ?? 100)));
}

export function conduct(arr: Arrangement): ConductResult {
    const { nodes, connections } = specToGraph(arr.graph);
    const sampleRate = arr.sampleRate ?? DEFAULTS.sampleRate;
    const blockSize = arr.blockSize ?? DEFAULTS.blockSize;

    // Lower the graph EXACTLY as the canvas does, and grab the ref -> NodeIdx map so
    // a track can address its instrument's RtCommands at the right node.
    const { graph, index } = emitWithIndex(nodes, connections, { sampleRate, blockSize });
    const remapped = remapForBackend(graph, 'native');

    const ppq = arr.ppq ?? DEFAULTS.ppq;
    const secPerTick = 60 / (arr.tempoBpm * ppq);
    const tickToSec = (tick: number) => tick * secPerTick;

    const idxOf = (ref: string): number => {
        const idx = index.get(ref);
        if (idx === undefined) {
            throw new Error(
                `conduct: track/automation references node "${ref}" that did not survive ` +
                    `lowering — is it an instrument/effect that makes sound (not a structural/IO node)?`,
            );
        }
        return idx as number;
    };

    // Build events carrying their INTEGER tick, so we can sort on a total integer
    // order (not the post-conversion float `at`) — the bit-identical bounce must hold
    // by construction, never by V8 stable-sort accident.
    const timed: { tick: number; ev: ScheduleEvent }[] = [];
    const trackIndex: Record<string, number> = {};
    let lastTick = 0;

    for (const track of arr.tracks) {
        const node = idxOf(track.ref);
        trackIndex[track.ref] = node;

        if (!track.mute) {
            for (const clip of track.clips) {
                for (const n of clip.notes) {
                    const onTick = clip.startTick + n.tick;
                    const offTick = onTick + Math.max(1, n.durTick);
                    lastTick = Math.max(lastTick, offTick);
                    const note = clampMidi(n.pitch);
                    timed.push({ tick: onTick, ev: { at: tickToSec(onTick), cmd: 'noteOn', node, note, vel: clampVel(n.vel) } });
                    timed.push({ tick: offTick, ev: { at: tickToSec(offTick), cmd: 'noteOff', node, note } });
                }
            }
        }

        for (const lane of track.automation ?? []) {
            const anode = idxOf(lane.ref);
            for (const pt of lane.points) {
                lastTick = Math.max(lastTick, pt.tick);
                timed.push({ tick: pt.tick, ev: { at: tickToSec(pt.tick), cmd: 'setParam', node: anode, param: lane.param, value: pt.value } });
            }
        }
    }

    // Total integer-tick order: tick, then kind (params settle -> notes release ->
    // notes start), then node, then a per-kind detail — fully deterministic.
    timed.sort(
        (a, b) =>
            a.tick - b.tick ||
            kindRank(a.ev.cmd) - kindRank(b.ev.cmd) ||
            a.ev.node - b.ev.node ||
            evDetail(a.ev) - evDetail(b.ev),
    );
    const events = timed.map((t) => t.ev);

    // Splice each agent-AUTHORED code node into its track's signal path as a mono
    // effect: instrument -> cn0 -> cn1 -> ... -> [the instrument's former consumers],
    // chained in DECLARED order per track. Pure IR rewiring — events untouched (the
    // instrument keeps its NodeIdx; only edges move). The render bin compiles each
    // faust source to a native .dll and hosts it (--code-node), reconciling each
    // WasmHost node's REAL audio arity from the .dll at LOAD (conduct is pure TS and
    // cannot know it) — so the 1-in/1-out here is the mono-effect topology hint.
    const codeNodes = arr.codeNodes ?? [];
    if (codeNodes.length > 0) {
        // remapForBackend now returns a FULLY-OWNED graph, so we rewire its edges in
        // place without aliasing the emit output (no defensive clone needed).
        let nextId = remapped.nodes.reduce((m, n) => Math.max(m, n.id), -1) + 1;

        // Group by target track, preserving declared order, so several nodes on one
        // track chain correctly (the previous per-node rewrite reversed/broke them).
        const byTrack = new Map<string, CodeNode[]>();
        for (const cn of codeNodes) {
            const list = byTrack.get(cn.onTrack) ?? [];
            list.push(cn);
            byTrack.set(cn.onTrack, list);
        }

        for (const [ref, chain] of byTrack) {
            const instIdx = idxOf(ref);
            // Snapshot the instrument's CURRENT consumers BEFORE rewiring, and the
            // output port that feeds them — carry the REAL from_port (never a
            // hardcoded 0 that would mis-route a multi-output source).
            const consumerEdges = remapped.edges.filter((e) => e.from_node === instIdx);
            const fromPort = consumerEdges.length > 0 ? consumerEdges[0]!.from_port : 0;

            let upstream = instIdx;
            let upstreamPort = fromPort;
            for (const cn of chain) {
                const newIdx = nextId++;
                const authored: IrNode = {
                    id: newIdx,
                    manifest_id: cn.id,
                    kind: 'WasmHost',
                    params: [],
                    assets: [],
                    n_in: 1,
                    n_out: 1,
                };
                remapped.nodes.push(authored);
                remapped.edges.push({
                    from_node: upstream,
                    from_port: upstreamPort,
                    to_node: newIdx,
                    to_port: 0,
                    kind: 'Audio',
                });
                upstream = newIdx;
                upstreamPort = 0; // a code node has a single output port
            }

            // Redirect the instrument's former consumers to read from the LAST node.
            for (const e of consumerEdges) {
                e.from_node = upstream;
                e.from_port = 0;
            }
        }
    }

    // A release tail (one bar, >= 1s) so final notes + reverb/delay ring out.
    const beatsPerBar = arr.timeSignature?.[0] ?? 4;
    const tailSec = Math.max(1, ppq * beatsPerBar * secPerTick);
    const seconds = tickToSec(lastTick) + tailSec;

    return { graph: remapped, events, seconds, trackIndex, codeNodes };
}
