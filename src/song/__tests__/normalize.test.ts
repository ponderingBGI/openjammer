import { describe, expect, it } from 'vitest';
import { conduct } from '../conduct';
import { normalizeArrangement } from '../normalize';
import type { Arrangement } from '../types';

const base: Arrangement = {
    name: 'norm',
    tempoBpm: 120,
    ppq: 960,
    sections: [
        { name: 'A', startBar: 1 },
        { name: 'B', startBar: 5 },
    ],
    graph: {
        nodes: [
            { ref: 'keys', type: 'keys' },
            { ref: 'spk', type: 'speaker' },
        ],
        connections: [{ from: 'keys', to: 'spk' }],
    },
    tracks: [
        {
            ref: 'keys',
            clips: [
                {
                    startTick: 0,
                    notes: [
                        { tick: 0, durTick: 480, pitch: 60 },
                        { tick: 480, durTick: 480, pitch: 64 },
                    ],
                },
                { startTick: 1920, notes: [{ tick: 0, durTick: 960, pitch: 67 }] },
            ],
            automation: [{ ref: 'keys', param: 0, points: [{ tick: 0, value: 0.3 }] }],
        },
    ],
};

function allIds(arr: Arrangement): string[] {
    const ids: string[] = [];
    for (const t of arr.tracks) {
        ids.push(t.id!);
        for (const c of t.clips) {
            ids.push(c.id!);
            for (const n of c.notes) ids.push(n.id!);
        }
        for (const l of t.automation ?? []) ids.push(l.id!);
    }
    for (const s of arr.sections ?? []) ids.push(s.id!);
    return ids;
}

describe('normalizeArrangement', () => {
    it('stamps an id on every track, clip, note, lane, and section', () => {
        const n = normalizeArrangement(base);
        const ids = allIds(n);
        expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
        // track + 2 clips + (2+1) notes + 1 lane + 2 sections = 9 entities.
        expect(ids.length).toBe(9);
    });

    it('produces only unique ids (collision-free)', () => {
        const ids = allIds(normalizeArrangement(base));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('is idempotent (a second normalize changes nothing)', () => {
        const once = normalizeArrangement(base);
        const twice = normalizeArrangement(once);
        expect(twice).toEqual(once);
    });

    it('is deterministic (same structure -> same ids every run)', () => {
        expect(allIds(normalizeArrangement(base))).toEqual(allIds(normalizeArrangement(base)));
    });

    it('preserves an existing id verbatim and only fills the absent ones', () => {
        const seeded: Arrangement = {
            ...base,
            tracks: [{ ...base.tracks[0]!, id: 'my-track', clips: [...base.tracks[0]!.clips] }],
        };
        const n = normalizeArrangement(seeded);
        expect(n.tracks[0]!.id).toBe('my-track');
        // The clips below it still get stamped (derived from the kept track id).
        expect(n.tracks[0]!.clips[0]!.id).toBe('my-track.c0');
    });

    it('de-collides a hand-authored duplicate id deterministically', () => {
        const dup: Arrangement = {
            ...base,
            tracks: [
                { ref: 'keys', id: 'x', clips: [] },
                { ref: 'keys', id: 'x', clips: [] },
            ],
        };
        const n = normalizeArrangement(dup);
        expect(n.tracks.map((t) => t.id)).toEqual(['x', 'x#2']);
    });

    it('does not mutate its input', () => {
        const before = JSON.stringify(base);
        normalizeArrangement(base);
        expect(JSON.stringify(base)).toBe(before);
    });

    it('CONDUCT IS BLIND TO IDS: normalize then conduct == conduct (bit-identical bounce)', () => {
        expect(conduct(normalizeArrangement(base))).toEqual(conduct(base));
    });
});
