import { describe, expect, it, vi } from 'vitest';
import { addMarker, EDIT_OPS } from '../ops';
import { applyVerbs } from '../verbs';
import type { Arrangement } from '../types';

const arrangement: Arrangement = {
    name: 'markers', tempoBpm: 120, ppq: 960,
    graph: { nodes: [], connections: [] }, tracks: [],
    locations: [{ id: 'existing', name: 'Marker 1', kind: 'mark', startTick: 100 }],
};

describe('addMarker', () => {
    it('is advertised and adds one exactly reversible named marker', () => {
        expect(EDIT_OPS).toContain('addMarker');
        const result = addMarker(arrangement, 1920.4, () => 'marker-2');
        expect(result.rejected).toBeUndefined();
        expect(result.verbs).toEqual([{ kind: 'addLocation', index: 1, location: { id: 'marker-2', name: 'Marker 2', kind: 'mark', startTick: 1920 } }]);
        const applied = applyVerbs(arrangement, result.verbs);
        expect(applyVerbs(applied.next, applied.inverse).next).toEqual(arrangement);
    });

    it('rejects invalid ticks without minting an id', () => {
        const mint = vi.fn(() => 'unused');
        expect(addMarker(arrangement, -1, mint).rejected).toMatch(/zero or greater/);
        expect(mint).not.toHaveBeenCalled();
    });
});
