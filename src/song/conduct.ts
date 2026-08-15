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
import { buildTempoMap, tickToSample } from './tempoMap';
import type { Arrangement, CodeNode, ScheduleEvent } from './types';
import { dbToGain, outputStageRefs } from './automation';
import { ENGINE_IDS } from '../audio/ojgraph/backendMap';
import {
    SchedEventKind,
    type IrNode,
    type OjGraph,
    type SchedEvent,
    type TempoMap,
    type Timeline,
} from '../../packages/oj-protocol-ts/src/index';

/** Which engine backend the conduct graph is remapped for. The SCHEDULE (events +
 * trackIndex) is identical across backends — only the graph's per-node manifest/kind
 * mapping differs, exactly as the live canvas graph differs between tiers. So a live
 * browser preview and a headless native bounce play the SAME notes at the SAME ticks
 * (one core, two clocks). */
export type ConductBackend = 'native' | 'wasm';

export interface ConductResult {
    /** The flat IR, backend-remapped — `oj render` loads the native form, the browser
     *  timeline preview loads the wasm form; the schedule below is backend-independent. */
    graph: OjGraph;
    /** The note/param schedule in seconds — exactly the render bin's SchedEvent shape. */
    events: ScheduleEvent[];
    /** The normalized musical clock snapshot published beside the timeline. */
    tempoMap: TempoMap;
    /** The sample-addressed immutable schedule consumed by both live executors. */
    timeline: Timeline;
    /** Total render length in seconds (last event + a release tail). */
    seconds: number;
    /** Surviving track ref -> IR NodeIdx (the agent's read surface / debugging). */
    trackIndex: Record<string, number>;
    /** Stable document/synthetic address -> IR node, used by the existing meter stream. */
    meterIndex: Record<string, number>;
    /** Agent-authored code nodes that were spliced into the IR — `oj song` writes
     * each source to a .dsp and passes `--code-node id=path` to the render bin. */
    codeNodes: CodeNode[];
    /** Track/automation refs that did NOT survive lowering and were SKIPPED — only
     * populated in `lenient` mode (preview), empty otherwise (the strict bounce throws
     * on the first bad ref instead). The caller can warn about exactly what fell out. */
    skipped: string[];
}

/** Options for {@link conduct}. */
export interface ConductOptions {
    /**
     * LENIENT lowering for live preview: a track/automation ref that did not survive
     * lowering is SKIPPED (collected into `skipped`) instead of throwing, so one stale
     * ref silences only its own track, never the whole song (a held note beats a
     * glitch). The headless bounce leaves this false so a bad arrangement fails LOUD
     * (an authoring error the agent/CLI must see).
     */
    lenient?: boolean;
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

export function conduct(
    arr: Arrangement,
    backend: ConductBackend = 'native',
    opts: ConductOptions = {},
): ConductResult {
    const { nodes, connections } = specToGraph(arr.graph);
    const sampleRate = arr.sampleRate ?? DEFAULTS.sampleRate;
    const blockSize = arr.blockSize ?? DEFAULTS.blockSize;

    // Lower the graph EXACTLY as the canvas does, and grab the ref -> NodeIdx map so
    // a track can address its instrument's RtCommands at the right node. The NodeIdx
    // are assigned by emitWithIndex BEFORE the backend remap, so they (and thus the
    // schedule) are identical for 'native' and 'wasm' — only the graph differs.
    const { graph, index } = emitWithIndex(nodes, connections, { sampleRate, blockSize });
    const remapped = remapForBackend(graph, backend);

    // Every arrangement track owns one addressable output stage. Insert it after
    // the track's downstream effect chain and before its master consumer. Unity
    // defaults are golden-equivalent to the pre-mixer graph.
    let nextOutputNode = remapped.nodes.reduce((max, item) => Math.max(max, item.id), -1) + 1;
    const trackOutputIndex: Record<string, number> = {};
    const originalEdges = remapped.edges.map((edge) => ({ ...edge }));
    const trackRoots = new Set(arr.tracks.flatMap((track) => {
        const idx = index.get(track.ref);
        return idx === undefined ? [] : [idx as number];
    }));
    const reachCount = new Map<number, number>();
    for (const root of trackRoots) {
        const reached = new Set<number>();
        const queue = [root];
        while (queue.length) {
            const node = queue.shift()!;
            if (reached.has(node)) continue;
            reached.add(node);
            queue.push(...originalEdges.filter((edge) => edge.kind === 'Audio' && edge.from_node === node).map((edge) => edge.to_node));
        }
        for (const node of reached) reachCount.set(node, (reachCount.get(node) ?? 0) + 1);
    }
    const hasSolo = arr.tracks.some((track) => track.solo === true);
    for (const track of arr.tracks) {
        const root = index.get(track.ref);
        if (root === undefined) continue;
        let tail = root as number;
        const visited = new Set<number>();
        while (!visited.has(tail)) {
            visited.add(tail);
            const outgoing = originalEdges.filter((edge) => edge.kind === 'Audio' && edge.from_node === tail);
            if (outgoing.length !== 1) break;
            const target = remapped.nodes.find((node) => node.id === outgoing[0]!.to_node);
            if (!target || target.kind === 'SpeakerOut' || target.kind === 'GraphOut' || (reachCount.get(target.id) ?? 0) > 1 || (trackRoots.has(target.id) && target.id !== root)) break;
            tail = target.id;
        }
        const consumers = remapped.edges.filter((edge) => edge.kind === 'Audio' && edge.from_node === tail);
        const gainNode = nextOutputNode++;
        const panNode = nextOutputNode++;
        const refs = outputStageRefs(track);
        const audible = !track.mute && (!hasSolo || track.solo === true);
        remapped.nodes.push(
            { id: gainNode, manifest_id: ENGINE_IDS.gain, kind: 'Gain', params: [{ id: 0, value: audible ? dbToGain(track.gainDb ?? 0) : 0 }], assets: [], n_in: 1, n_out: 1 },
            { id: panNode, manifest_id: ENGINE_IDS.pan, kind: 'Pan', params: [{ id: 0, value: track.pan ?? 0 }], assets: [], n_in: 1, n_out: 1 },
        );
        remapped.edges.push(
            { from_node: tail, from_port: consumers[0]?.from_port ?? 0, to_node: gainNode, to_port: 0, kind: 'Audio' },
            { from_node: gainNode, from_port: 0, to_node: panNode, to_port: 0, kind: 'Audio' },
        );
        for (const edge of consumers) {
            edge.from_node = panNode;
            edge.from_port = 0;
        }
        index.set(refs.gain, gainNode);
        index.set(refs.pan, panNode);
        trackOutputIndex[track.ref] = panNode;
    }

    const tempoMap = buildTempoMap({ ...arr, sampleRate });
    const ppq = tempoMap.ppq;
    const secPerTick = 60 / (arr.tempoBpm * ppq);
    const tickToSec = (tick: number) => tick * secPerTick;

    const skipped: string[] = [];
    const idxOf = (ref: string): number | null => {
        const idx = index.get(ref);
        if (idx === undefined) {
            if (opts.lenient) {
                if (!skipped.includes(ref)) skipped.push(ref);
                return null; // skip just this track/lane; the rest of the song plays
            }
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
    const timed: { tick: number; ev: ScheduleEvent; sched?: SchedEvent }[] = [];
    const trackIndex: Record<string, number> = {};
    let lastTick = 0;
    let nextTimelineNode = remapped.nodes.reduce((max, item) => Math.max(max, item.id), -1) + 1;

    for (const track of arr.tracks) {
        const node = idxOf(track.ref);
        if (node === null) continue; // lenient: this track's ref didn't survive — skip it
        trackIndex[track.ref] = node;

        if (!track.mute && (!hasSolo || track.solo === true)) {
            for (const clip of track.clips) {
                if (clip.mute || !(clip.lengthTick > 0)) continue;
                const source = arr.sources?.[clip.sourceId];
                if (!source) continue; // unresolved media is a silent placeholder
                const sourceStart = clip.sourceStart ?? 0;
                if (source.kind === 'midi') for (const n of source.notes) {
                    const noteEnd = n.tick + Math.max(1, n.durTick);
                    const windowEnd = sourceStart + clip.lengthTick;
                    if (noteEnd <= sourceStart || n.tick >= windowEnd) continue;
                    const onTick = clip.startTick + Math.max(0, n.tick - sourceStart);
                    const offTick = clip.startTick + Math.min(clip.lengthTick, noteEnd - sourceStart);
                    if (offTick <= onTick) continue;
                    lastTick = Math.max(lastTick, offTick);
                    const note = clampMidi(n.pitch);
                    const vel = clampVel(n.vel);
                    timed.push({ tick: onTick, ev: { at: tickToSec(onTick), cmd: 'noteOn', node, note, vel }, sched: { at: tickToSample(tempoMap, onTick), node, kind: SchedEventKind.NOTE_ON, a: note, b: vel, value: 0 } });
                    timed.push({ tick: offTick, ev: { at: tickToSec(offTick), cmd: 'noteOff', node, note }, sched: { at: tickToSample(tempoMap, offTick), node, kind: SchedEventKind.NOTE_OFF, a: note, b: 0, value: 0 } });
                } else {
                    // One bound Sampler per audio clip. The current sampler contract can
                    // trigger the immutable asset but cannot yet seek sourceStart or stop
                    // an unpitched one-shot sample-accurately; those executor controls are
                    // the explicit seam retained by Wave 1.
                    const samplerNode = nextTimelineNode++;
                    const consumers = remapped.edges.filter((edge) => edge.from_node === node);
                    const asset = Number.parseInt(source.assetId.replace(/^0x/i, ''), 16);
                    remapped.nodes.push({
                        id: samplerNode,
                        manifest_id: 'builtin.sampler',
                        kind: 'Sampler',
                        params: [{ id: 16, value: 60 }, { id: 0, value: clip.gain ?? 1 }],
                        assets: Number.isFinite(asset) ? [{ slot: 0, asset }] : [],
                        n_in: 0,
                        n_out: 1,
                    });
                    for (const edge of consumers) remapped.edges.push({ ...edge, from_node: samplerNode, from_port: 0 });
                    const onTick = clip.startTick;
                    const offTick = clip.startTick + clip.lengthTick;
                    lastTick = Math.max(lastTick, offTick);
                    const sourceOffset = Math.max(0, Math.floor(sourceStart));
                    timed.push({ tick: onTick, ev: { at: tickToSec(onTick), cmd: 'noteOn', node: samplerNode, note: 60, vel: 127 }, sched: {
                        at: tickToSample(tempoMap, onTick), node: samplerNode,
                        kind: SchedEventKind.SAMPLER_START,
                        a: sourceOffset & 0xff,
                        b: (sourceOffset >>> 8) & 0xff,
                        value: Math.floor(sourceOffset / 65_536),
                    } });
                }
            }
        }

        for (const lane of track.automation ?? []) {
            if ((lane.state ?? 'Play') !== 'Play') continue;
            const anode = idxOf(lane.ref);
            if (anode === null) continue; // lenient: skip an automation lane with a bad ref
            const scheduled = lane.interp === 'Linear'
                ? lane.points.flatMap((point, pointIndex) => {
                    const next = lane.points[pointIndex + 1];
                    if (!next || next.tick <= point.tick) return [point];
                    // Densify authoring-time ramps at 1/32 beat, capped per segment.
                    const step = Math.max(1, Math.ceil(ppq / 32));
                    const count = Math.min(128, Math.ceil((next.tick - point.tick) / step));
                    return Array.from({ length: count }, (_, index) => {
                        const mix = index / count;
                        return { tick: Math.round(point.tick + (next.tick - point.tick) * mix), value: point.value + (next.value - point.value) * mix };
                    });
                }).concat(lane.points.at(-1) ? [lane.points.at(-1)!] : [])
                : lane.points;
            const gainRef = outputStageRefs(track).gain;
            for (const pt of scheduled) {
                const value = lane.ref === gainRef ? dbToGain(pt.value) : pt.value;
                lastTick = Math.max(lastTick, pt.tick);
                timed.push({ tick: pt.tick, ev: { at: tickToSec(pt.tick), cmd: 'setParam', node: anode, param: lane.param, value }, sched: {
                    at: tickToSample(tempoMap, pt.tick), node: anode,
                    kind: SchedEventKind.SET_PARAM,
                    a: lane.param & 0xff,
                    b: Math.floor(lane.param / 256) & 0xff,
                    value,
                } });
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
            if (instIdx === null) continue; // lenient: the code node's track ref didn't survive
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

    const range = (kind: 'loop' | 'punch'): [number, number] | null => {
        const location = (arr.locations ?? []).find((item) => item.kind === kind);
        if (!location || location.endTick === undefined) return null;
        return [tickToSample(tempoMap, location.startTick), tickToSample(tempoMap, location.endTick)];
    };
    const timeline: Timeline = {
        sample_rate: sampleRate,
        events: timed.flatMap((item) => item.sched ? [item.sched] : []),
        loop_range: range('loop'),
        punch_range: range('punch'),
        armed_tracks: [],
        count_in_beats: 0,
        end: Math.max(0, Math.round(seconds * sampleRate)),
    };

    const meterIndex: Record<string, number> = { ...trackOutputIndex };
    const master = remapped.nodes.find((node) => node.kind === 'SpeakerOut' || node.kind === 'GraphOut');
    if (master) meterIndex.__master__ = master.id;
    return { graph: remapped, events, tempoMap, timeline, seconds, trackIndex, meterIndex, codeNodes, skipped };
}
