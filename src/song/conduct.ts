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
import type { Arrangement, ScheduleEvent } from './types';
import type { OjGraph } from '../../packages/oj-protocol-ts/src/index';

export interface ConductResult {
    /** The flat IR, backend-remapped for native — exactly what `oj render` loads. */
    graph: OjGraph;
    /** The note/param schedule in seconds — exactly the render bin's SchedEvent shape. */
    events: ScheduleEvent[];
    /** Total render length in seconds (last event + a release tail). */
    seconds: number;
    /** Surviving track ref -> IR NodeIdx (the agent's read surface / debugging). */
    trackIndex: Record<string, number>;
}

const DEFAULTS = { ppq: 960, sampleRate: 48_000, blockSize: 256 } as const;

/** setParam settles, then old notes release, then new notes start (same instant). */
function kindRank(cmd: ScheduleEvent['cmd']): number {
    return cmd === 'setParam' ? 0 : cmd === 'noteOff' ? 1 : 2;
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

    const events: ScheduleEvent[] = [];
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
                    events.push({ at: tickToSec(onTick), cmd: 'noteOn', node, note, vel: clampVel(n.vel) });
                    events.push({ at: tickToSec(offTick), cmd: 'noteOff', node, note });
                }
            }
        }

        for (const lane of track.automation ?? []) {
            const anode = idxOf(lane.ref);
            for (const pt of lane.points) {
                lastTick = Math.max(lastTick, pt.tick);
                events.push({ at: tickToSec(pt.tick), cmd: 'setParam', node: anode, param: lane.param, value: pt.value });
            }
        }
    }

    events.sort((a, b) => a.at - b.at || kindRank(a.cmd) - kindRank(b.cmd));

    // A release tail (one bar, >= 1s) so final notes + reverb/delay ring out.
    const beatsPerBar = arr.timeSignature?.[0] ?? 4;
    const tailSec = Math.max(1, ppq * beatsPerBar * secPerTick);
    const seconds = tickToSec(lastTick) + tailSec;

    return { graph: remapped, events, seconds, trackIndex };
}
