import { describe, expect, it } from 'vitest';
import { conduct } from '../conduct';
import { normalizeArrangement } from '../normalize';
import type { Arrangement } from '../types';

const base: Arrangement = {
    name: 'norm', tempoBpm: 120, ppq: 960, idCounter: 1,
    locations: [{ name: 'A', kind: 'section', startTick: 0 }, { name: 'B', kind: 'section', startTick: 15360 }],
    sources: {
        'src:midi:m0': { id: 'src:midi:m0', kind: 'midi', name: 'notes', lengthTick: 3840, notes: [
            { tick: 0, durTick: 480, pitch: 60 }, { tick: 480, durTick: 480, pitch: 64 }, { tick: 1920, durTick: 960, pitch: 67 },
        ] },
    },
    graph: { nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'spk', type: 'speaker' }], connections: [{ from: 'keys', to: 'spk' }] },
    tracks: [{ ref: 'keys', clips: [
        { sourceId: 'src:midi:m0', startTick: 1920, sourceStart: 1920, lengthTick: 960 },
        { sourceId: 'src:midi:m0', startTick: 0, lengthTick: 960 },
    ], automation: [{ ref: 'keys', param: 0, points: [{ tick: 0, value: 0.3 }] }] }],
};

function allIds(arrangement: Arrangement): string[] {
    return [
        ...Object.values(arrangement.sources ?? {}).flatMap((source) => [source.id, ...(source.kind === 'midi' ? source.notes.map((note) => note.id!) : [])]),
        ...arrangement.tracks.flatMap((track) => [track.id!, ...track.clips.map((clip) => clip.id!), ...(track.automation ?? []).map((lane) => lane.id!)]),
        ...(arrangement.locations ?? []).map((location) => location.id!),
    ];
}

describe('normalizeArrangement v2', () => {
    it('stamps globally unique source/note/track/clip/lane/location ids and sorts clips', () => {
        const normalized = normalizeArrangement(base);
        const ids = allIds(normalized);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(normalized.tracks[0]!.clips.map((clip) => clip.startTick)).toEqual([0, 1920]);
        expect(normalized.sources!['src:midi:m0']!.kind === 'midi' && normalized.sources!['src:midi:m0']!.notes[0]!.id).toBe('src:midi:m0.n0');
    });

    it('is deterministic and idempotent across JSON round-trip', () => {
        const once = normalizeArrangement(base);
        expect(normalizeArrangement(base)).toEqual(once);
        expect(normalizeArrangement(once)).toEqual(once);
        expect(normalizeArrangement(JSON.parse(JSON.stringify(once)) as Arrangement)).toEqual(once);
    });

    it('preserves existing ids and de-collides duplicates', () => {
        const normalized = normalizeArrangement({ ...base, tracks: [
            { id: 'x', ref: 'keys', clips: [] }, { id: 'x', ref: 'keys', clips: [] },
        ] });
        expect(normalized.tracks.map((track) => track.id)).toEqual(['x', 'x#2']);
    });

    it('canonicalizes audio identity to its content address', () => {
        const normalized = normalizeArrangement({ ...base, sources: {
            old: { id: 'old', kind: 'audio', name: 'take', assetId: 'ABCDEF', frames: 1, sampleRate: 48000, channels: 1 },
        }, tracks: [{ ref: 'keys', clips: [{ sourceId: 'old', startTick: 0, lengthTick: 1 }] }] });
        expect(normalized.sources?.['src:audio:abcdef']).toBeDefined();
        expect(normalized.tracks[0]!.clips[0]!.sourceId).toBe('src:audio:abcdef');
    });

    it('does not mutate input and conduct is blind to entity-id stamping', () => {
        const before = JSON.stringify(base);
        expect(conduct(normalizeArrangement(base))).toEqual(conduct(base));
        expect(JSON.stringify(base)).toBe(before);
    });
});
