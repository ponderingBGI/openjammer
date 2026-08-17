import { effectLoweringFor, manifestFor, type ParamDecl } from '../engine/manifest';
import type { NodeType } from '../engine/types';
import { HOSTED_PLUGIN_DESCRIPTOR_KEY, type HostedPluginDescriptor } from '../engine/dynamicRegistry';
import type { Arrangement, ArrangementTrack, AutomationLane, AutomationLaneState, AutomationPoint } from './types';

export const TRACK_GAIN_PARAM = 0;
export const TRACK_PAN_PARAM = 0;
export const TRACK_GAIN_MIN_DB = -60;
export const TRACK_GAIN_MAX_DB = 12;

export interface AddressableParam extends ParamDecl {
    ref: string;
    label: { group: string; name: string };
    unit?: 'dB' | 'pan';
    toggled?: boolean;
}

export function outputStageRefs(track: Pick<ArrangementTrack, 'id' | 'ref'>) {
    // The graph ref is the track's persisted audio binding and remains unchanged
    // when legacy documents receive normalized entity ids.
    const root = track.ref;
    return { gain: `${root}:output:gain`, pan: `${root}:output:pan` } as const;
}

export function dbToGain(db: number): number {
    return db <= TRACK_GAIN_MIN_DB ? 0 : 10 ** (db / 20);
}

export function automationStateBehavior(state: AutomationLaneState): { writable: boolean; playing: boolean; capturing: boolean } {
    switch (state) {
        case 'Off': return { writable: true, playing: false, capturing: false };
        case 'Play': return { writable: false, playing: true, capturing: false };
        case 'Write': return { writable: true, playing: false, capturing: true };
        case 'Touch': return { writable: true, playing: true, capturing: true };
        case 'Latch': return { writable: true, playing: true, capturing: true };
    }
}

export function mapAutomationStates(arrangement: Arrangement, mode: 'save' | 'protect'): Arrangement {
    return {
        ...arrangement,
        tracks: arrangement.tracks.map((track) => ({
            ...track,
            automation: track.automation?.map((lane) => {
                const state = lane.state ?? 'Play';
                const mapped = mode === 'save'
                    ? state === 'Write' ? (lane.points.length ? 'Touch' : 'Off') : state
                    : state === 'Write' ? 'Off' : state === 'Touch' || state === 'Latch' ? 'Play' : state;
                const next: AutomationLane = { ...lane, state: mapped };
                if (mapped === 'Play') delete next.state;
                return next;
            }),
        })),
    };
}

export const protectAutomation = (arrangement: Arrangement) => mapAutomationStates(arrangement, 'protect');

export function trackOutputParams(track: ArrangementTrack): AddressableParam[] {
    const refs = outputStageRefs(track);
    return [
        { ref: refs.gain, id: TRACK_GAIN_PARAM, name: 'gain', label: { group: 'Track', name: 'Track Gain' }, min: TRACK_GAIN_MIN_DB, max: TRACK_GAIN_MAX_DB, default: 0, unit: 'dB' },
        { ref: refs.pan, id: TRACK_PAN_PARAM, name: 'pan', label: { group: 'Track', name: 'Track Pan' }, min: -1, max: 1, default: 0, unit: 'pan' },
    ];
}

/** Addressable parameters on the track's downstream instrument/effect subgraph. */
export function addressableTrackParams(arrangement: Arrangement, track: ArrangementTrack): AddressableParam[] {
    const nodes = new Map(arrangement.graph.nodes.map((node) => [node.ref, node]));
    const outgoing = new Map<string, string[]>();
    for (const edge of arrangement.graph.connections ?? []) {
        const from = edge.from.split(':')[0]!;
        const to = edge.to.split(':')[0]!;
        outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
    }
    const reachable = new Set<string>();
    const queue = [track.ref];
    while (queue.length) {
        const ref = queue.shift()!;
        if (reachable.has(ref)) continue;
        reachable.add(ref);
        queue.push(...(outgoing.get(ref) ?? []));
    }
    const params: AddressableParam[] = [...trackOutputParams(track)];
    for (const spec of arrangement.graph.nodes) {
        if (!reachable.has(spec.ref) || spec.type === 'speaker' || spec.type === 'recorder') continue;
        let decls: ParamDecl[];
        const hosted = spec.data?.[HOSTED_PLUGIN_DESCRIPTOR_KEY] as HostedPluginDescriptor | undefined;
        try {
            decls = hosted?.params?.map((param, index) => ({ ...param, id: index })) ?? (spec.type === 'effect'
                ? effectLoweringFor(spec.data).params
                : manifestFor(spec.type as NodeType).params);
        } catch {
            continue;
        }
        const group = hosted?.name ?? nodes.get(spec.ref)?.ref ?? spec.ref;
        for (const decl of decls) {
            if (decl.hidden || decl.automatable === false) continue;
            const path = decl.module?.split('/').filter(Boolean).join(' › ');
            params.push({ ...decl, ref: spec.ref, label: { group, name: `${path ? `${path} › ` : ''}${decl.name || `Parameter ${decl.id + 1}`}` } });
        }
    }
    return params;
}

export function descriptorForLane(arrangement: Arrangement, lane: AutomationLane): AddressableParam | undefined {
    const track = arrangement.tracks.find((item) => (item.automation ?? []).some((candidate) => candidate.id === lane.id));
    return track ? addressableTrackParams(arrangement, track).find((param) => param.ref === lane.ref && param.id === lane.param) : undefined;
}

export function evaluateAutomation(points: readonly AutomationPoint[], tick: number, interp: AutomationLane['interp'] = 'Discrete'): number | undefined {
    if (!points.length) return undefined;
    const ordered = [...points].sort((a, b) => a.tick - b.tick);
    if (tick <= ordered[0]!.tick) return ordered[0]!.value;
    if (tick >= ordered.at(-1)!.tick) return ordered.at(-1)!.value;
    const rightIndex = ordered.findIndex((point) => point.tick >= tick);
    const right = ordered[rightIndex]!;
    const left = ordered[rightIndex - 1]!;
    if (interp !== 'Linear' || right.tick === left.tick) return left.value;
    return left.value + (right.value - left.value) * ((tick - left.tick) / (right.tick - left.tick));
}

/** BC-40's exact single-forward-pass triangle-area thinning rule. */
export function thinAutomationPoints(points: readonly AutomationPoint[], factor = 20): AutomationPoint[] {
    if (points.length <= 2) return [...points];
    const adjusted = factor * 0.7071;
    const out = [...points].sort((a, b) => a.tick - b.tick);
    let index = 0;
    while (index + 2 < out.length) {
        const [a, b, c] = [out[index]!, out[index + 1]!, out[index + 2]!];
        const area = Math.abs(a.tick * (b.value - c.value) + b.tick * (c.value - a.value) + c.tick * (a.value - b.value));
        if (area < adjusted) out.splice(index + 1, 1);
        else index++;
    }
    return out;
}
