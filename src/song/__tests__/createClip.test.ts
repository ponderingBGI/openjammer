import { describe, expect, it } from 'vitest';
import { createClip, EDIT_OPS } from '../ops';
import { applyVerbs } from '../verbs';
import type { Arrangement } from '../types';

const arrangement: Arrangement = {
    name: 'draw clip', tempoBpm: 120, ppq: 960,
    graph: { nodes: [], connections: [] },
    tracks: [{ id: 'track-1', ref: 'keys', clips: [] }],
};

describe('createClip', () => {
    it('advertises draw-a-clip and creates an atomic empty MIDI source plus clip', () => {
        expect(EDIT_OPS).toContain('createClip');
        let id = 0;
        const result = createClip(arrangement, 'track-1', 960, 3840, (prefix) => `${prefix}-${id++}`, 'Verse');
        expect(result.rejected).toBeUndefined();
        expect(result.verbs).toHaveLength(1);
        expect(result.verbs[0]?.kind).toBe('compound');
        expect(result.selectedClipIds).toEqual(['clip-1']);

        const applied = applyVerbs(arrangement, result.verbs);
        expect(applied.next.sources?.['src:midi-0']).toMatchObject({ kind: 'midi', notes: [], lengthTick: 3840, name: 'Verse' });
        expect(applied.next.tracks[0]?.clips).toEqual([{ id: 'clip-1', sourceId: 'src:midi-0', startTick: 960, lengthTick: 3840, name: 'Verse' }]);
        expect(applyVerbs(applied.next, applied.inverse).next).toEqual(arrangement);
    });

    it('rejects missing tracks and invalid windows without minting ids', () => {
        let minted = 0;
        const mint = () => { minted += 1; return `id-${minted}`; };
        expect(createClip(arrangement, 'missing', 0, 960, mint).rejected).toMatch(/no track/);
        expect(createClip(arrangement, 'track-1', -1, 960, mint).rejected).toMatch(/start/);
        expect(createClip(arrangement, 'track-1', 0, 0, mint).rejected).toMatch(/length/);
        expect(minted).toBe(0);
    });
});
