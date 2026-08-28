import { describe, expect, it } from 'vitest';
import { automationStateBehavior, outputStageRefs, protectAutomation, thinAutomationPoints } from '../automation';
import { conduct } from '../conduct';
import { moveAutomationPoints, setAutomationRange } from '../ops';
import { arrangementForExport, readArrangement } from '../project';
import type { Arrangement } from '../types';
import { applyVerb, applyVerbs } from '../verbs';

function fixture(points = [{ tick: 0, value: 0 }, { tick: 100, value: 0.5 }, { tick: 200, value: 1 }]): Arrangement {
    const track = { id: 'track', ref: 'keys', clips: [] };
    return {
        name: 'automation', tempoBpm: 120, ppq: 960,
        graph: { nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'speaker', type: 'speaker' }], connections: [{ from: 'keys', to: 'speaker' }] },
        tracks: [{ ...track, automation: [{ id: 'lane', ref: outputStageRefs(track).gain, param: 0, points }] }],
    };
}

describe('Wave 6 automation contracts', () => {
    it('implements the reserved lane-state predicate table and persistence mappings', () => {
        expect(automationStateBehavior('Off')).toEqual({ writable: true, playing: false, capturing: false });
        expect(automationStateBehavior('Play')).toEqual({ writable: false, playing: true, capturing: false });
        expect(automationStateBehavior('Write')).toEqual({ writable: true, playing: false, capturing: true });
        expect(automationStateBehavior('Touch')).toEqual({ writable: true, playing: true, capturing: true });
        expect(automationStateBehavior('Latch')).toEqual({ writable: true, playing: true, capturing: true });
        const write = fixture();
        write.tracks[0]!.automation![0]!.state = 'Write';
        expect(arrangementForExport(write).tracks[0]!.automation![0]!.state).toBe('Touch');
        expect(readArrangement(write)!.tracks[0]!.automation![0]!.state).toBe('Off');
        expect(protectAutomation({ ...write, tracks: [{ ...write.tracks[0]!, automation: [{ ...write.tracks[0]!.automation![0]!, state: 'Latch' }] }] }).tracks[0]!.automation![0]!.state).toBeUndefined();
    });

    it('adds unity Gain + centred Pan after every track and exposes their meter addresses', () => {
        const result = conduct(fixture([]));
        const gain = result.graph.nodes.find((node) => node.kind === 'Gain' && node.id === result.events.find((event) => event.cmd === 'setParam')?.node);
        const pan = result.graph.nodes.find((node) => node.id === result.meterIndex.keys);
        expect(result.graph.nodes.some((node) => node.kind === 'Gain' && node.params[0]?.value === 1)).toBe(true);
        expect(pan).toMatchObject({ kind: 'Pan', params: [{ id: 0, value: 0 }] });
        expect(gain).toBeUndefined();
        expect(result.meterIndex.__master__).toBeTypeOf('number');
    });

    it('places each output stage before a shared downstream bus effect', () => {
        const arr = fixture([]);
        arr.graph.nodes.splice(1, 0, { ref: 'bass', type: 'keys' }, { ref: 'bus', type: 'effect' });
        arr.graph.connections = [{ from: 'keys', to: 'bus' }, { from: 'bass', to: 'bus' }, { from: 'bus', to: 'speaker' }];
        arr.tracks.push({ id: 'bass-track', ref: 'bass', clips: [] });
        const result = conduct(arr);
        const bus = result.graph.nodes.find((node) => node.kind === 'Waveshaper')!;
        expect(result.graph.edges).toContainEqual(expect.objectContaining({ from_node: result.meterIndex.keys, to_node: bus.id }));
        expect(result.graph.edges).toContainEqual(expect.objectContaining({ from_node: result.meterIndex.bass, to_node: bus.id }));
    });

    it('does not lower Off lanes and densifies loaded Linear lanes through SetParam events', () => {
        const off = fixture();
        off.tracks[0]!.automation![0]!.state = 'Off';
        expect(conduct(off).events).toEqual([]);
        const linear = fixture([{ tick: 0, value: -12 }, { tick: 960, value: 0 }]);
        linear.tracks[0]!.automation![0]!.interp = 'Linear';
        const events = conduct(linear).events.filter((event) => event.cmd === 'setParam');
        expect(events.length).toBeGreaterThan(2);
        expect(events.length).toBeLessThanOrEqual(129);
        expect(events[0]).toMatchObject({ at: 0, value: 10 ** (-12 / 20) });
        expect(events.at(-1)).toMatchObject({ at: 0.5, value: 1 });
    });

    it('stops one tick before collisions and push-points carries later points', () => {
        const arr = fixture();
        const stopped = applyVerbs(arr, moveAutomationPoints(arr, 'lane', [100], 100).verbs).next;
        expect(stopped.tracks[0]!.automation![0]!.points.map((point) => point.tick)).toEqual([0, 199, 200]);
        const pushed = applyVerbs(arr, moveAutomationPoints(arr, 'lane', [100], 25, 0, true).verbs).next;
        expect(pushed.tracks[0]!.automation![0]!.points.map((point) => point.tick)).toEqual([0, 125, 225]);
    });

    it('range replacement is guarded, thinned, and structurally reversible', () => {
        const arr = fixture([{ tick: 0, value: 0 }, { tick: 50, value: 0.2 }, { tick: 100, value: 0.5 }, { tick: 150, value: 0.7 }, { tick: 200, value: 1 }]);
        const op = setAutomationRange(arr, 'lane', 75, 125, [{ tick: 75, value: 0.3 }, { tick: 100, value: 0.4 }, { tick: 125, value: 0.6 }], 0);
        const applied = applyVerbs(arr, op.verbs);
        expect(applied.next.tracks[0]!.automation![0]!.points).toEqual(expect.arrayContaining([{ tick: 74, value: 0.2 }, { tick: 126, value: 0.5 }]));
        expect(applyVerbs(applied.next, applied.inverse).next).toEqual(arr);
        expect(thinAutomationPoints([{ tick: 0, value: 0 }, { tick: 1, value: 0.01 }, { tick: 2, value: 0 }], 20)).toEqual([{ tick: 0, value: 0 }, { tick: 2, value: 0 }]);
    });

    it('track gain/pan and lane state verbs have exact inverses', () => {
        for (const verb of [
            { kind: 'setTrackGain', trackId: 'track', gainDb: -9 } as const,
            { kind: 'setTrackPan', trackId: 'track', pan: 0.4 } as const,
            { kind: 'setAutomationLaneState', laneId: 'lane', state: 'Off' } as const,
        ]) {
            const changed = applyVerb(fixture(), verb);
            expect(applyVerb(changed.next, changed.inverse).next).toEqual(fixture());
        }
    });
});
