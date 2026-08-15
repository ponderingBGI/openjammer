import { describe, expect, it } from 'vitest';
import { conduct } from '../conduct';
import type { Arrangement, ArrangementNote } from '../types';

function song(notes: ArrangementNote[], clip: Partial<Arrangement['tracks'][number]['clips'][number]> = {}): Arrangement {
    return {
        name: 'unit', tempoBpm: 120, ppq: 960,
        sources: { midi: { id: 'midi', kind: 'midi', name: 'MIDI', notes, lengthTick: 3840 } },
        graph: { nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'spk', type: 'speaker' }], connections: [{ from: 'keys', to: 'spk' }] },
        tracks: [{ ref: 'keys', clips: [{ sourceId: 'midi', startTick: 0, lengthTick: 3840, ...clip }] }],
    };
}
const base = song([{ tick: 0, durTick: 960, pitch: 60, vel: 100 }], { lengthTick: 960 });

describe('conduct', () => {
    it('lowers source notes to seconds', () => {
        const result = conduct(base);
        const node = result.trackIndex.keys;
        expect(result.events).toEqual([
            { at: 0, cmd: 'noteOn', node, note: 60, vel: 100 },
            { at: 0.5, cmd: 'noteOff', node, note: 60 },
        ]);
        expect(result.seconds).toBeGreaterThan(0.5);
    });

    it('clips a note straddling the clip end', () => {
        const result = conduct(song([{ tick: 720, durTick: 960, pitch: 64 }], { lengthTick: 960 }));
        expect(result.events.map((event) => event.at)).toEqual([0.375, 0.5]);
    });

    it('applies sourceStart and clips a note crossing the left boundary', () => {
        const result = conduct(song([
            { tick: 240, durTick: 480, pitch: 60 },
            { tick: 960, durTick: 240, pitch: 64 },
        ], { startTick: 1920, sourceStart: 480, lengthTick: 720 }));
        expect(result.events).toEqual([
            { at: 1, cmd: 'noteOn', node: result.trackIndex.keys, note: 60, vel: 100 },
            { at: 1.125, cmd: 'noteOff', node: result.trackIndex.keys, note: 60 },
            { at: 1.25, cmd: 'noteOn', node: result.trackIndex.keys, note: 64, vel: 100 },
            { at: 1.375, cmd: 'noteOff', node: result.trackIndex.keys, note: 64 },
        ]);
    });

    it('guards zero-length clips', () => {
        expect(conduct(song([{ tick: 0, durTick: 480, pitch: 60 }], { lengthTick: 0 })).events).toEqual([]);
    });

    it('is deterministic and backend-independent', () => {
        expect(conduct(base)).toEqual(conduct(base));
        const native = conduct(base, 'native');
        const wasm = conduct(base, 'wasm');
        expect(wasm.events).toEqual(native.events);
        expect(wasm.trackIndex).toEqual(native.trackIndex);
        expect(wasm.seconds).toBe(native.seconds);
    });

    it('honours track and clip mute', () => {
        expect(conduct({ ...base, tracks: [{ ...base.tracks[0]!, mute: true }] }).events).toEqual([]);
        expect(conduct({ ...base, tracks: [{ ...base.tracks[0]!, clips: [{ ...base.tracks[0]!.clips[0]!, mute: true }] }] }).events).toEqual([]);
    });

    it('lowers automation to stepped events', () => {
        const arrangement: Arrangement = { ...base, tracks: [{ ref: 'keys', clips: [], automation: [{ ref: 'keys', param: 0, points: [{ tick: 0, value: 0.2 }, { tick: 1920, value: 0.9 }] }] }] };
        const result = conduct(arrangement);
        expect(result.events).toEqual([
            { at: 0, cmd: 'setParam', node: result.trackIndex.keys, param: 0, value: 0.2 },
            { at: 1, cmd: 'setParam', node: result.trackIndex.keys, param: 0, value: 0.9 },
        ]);
    });

    it('fails strict unresolved refs and skips them in preview', () => {
        const bad: Arrangement = { ...base, tracks: [{ ref: 'ghost', clips: base.tracks[0]!.clips }] };
        expect(() => conduct(bad)).toThrow(/did not survive/);
        expect(conduct(bad, 'native', { lenient: true }).skipped).toEqual(['ghost']);
    });

    it('splices authored code nodes in declared order', () => {
        const result = conduct({ ...base, codeNodes: [
            { id: 'ai.wasm.a', onTrack: 'keys', faustSource: 'process = _;' },
            { id: 'ai.wasm.b', onTrack: 'keys', faustSource: 'process = _;' },
        ] });
        const keys = result.trackIndex.keys;
        const a = result.graph.nodes.find((node) => node.manifest_id === 'ai.wasm.a')!;
        const b = result.graph.nodes.find((node) => node.manifest_id === 'ai.wasm.b')!;
        expect(result.graph.edges.some((edge) => edge.from_node === keys && edge.to_node === a.id)).toBe(true);
        expect(result.graph.edges.some((edge) => edge.from_node === a.id && edge.to_node === b.id)).toBe(true);
    });

    it('emits a bound Sampler node for an audio source', () => {
        const arrangement: Arrangement = {
            ...base,
            sources: { 'src:audio:abcdef': { id: 'src:audio:abcdef', kind: 'audio', name: 'take', assetId: 'abcdef', frames: 48000, sampleRate: 48000, channels: 1 } },
            tracks: [{ ref: 'keys', clips: [{ sourceId: 'src:audio:abcdef', startTick: 0, lengthTick: 960 }] }],
        };
        const result = conduct(arrangement);
        const sampler = result.graph.nodes.find((node) => node.kind === 'Sampler' && node.assets.some((asset) => asset.asset === 0xabcdef));
        expect(sampler).toBeDefined();
        expect(result.events).toContainEqual({ at: 0, cmd: 'noteOn', node: sampler!.id, note: 60, vel: 127 });
    });

    it('sorts schedule events by integer tick', () => {
        const result = conduct(song([
            { tick: 480, durTick: 240, pitch: 64 },
            { tick: 0, durTick: 480, pitch: 60 },
            { tick: 240, durTick: 240, pitch: 62 },
        ], { lengthTick: 960 }));
        const onsets = result.events.filter((event) => event.cmd === 'noteOn').map((event) => event.at);
        expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
    });
});
