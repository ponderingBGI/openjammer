import { describe, expect, it } from 'vitest';
import fixture from './fixtures/arrangement-v1.json';
import { arrangementForExport, readArrangement } from '../project';

describe('arrangement project schema v2 migration', () => {
    it('migrates a real v1 fixture losslessly and reaches a fixed point', () => {
        const migrated = readArrangement(fixture)!;
        expect(migrated.schemaVersion).toBe(2);
        expect(migrated.idCounter).toBe(1);
        expect(migrated.locations).toEqual([
            { id: 's0', name: 'Intro', kind: 'section', startTick: 0 },
            { id: 's1', name: 'Verse', kind: 'section', startTick: 7680 },
        ]);
        const clip = migrated.tracks[0]!.clips[0]!;
        expect(clip).toEqual({ id: 'clip-old', sourceId: 'src:midi:m0', startTick: 960, lengthTick: 3840 });
        const source = migrated.sources!['src:midi:m0']!;
        expect(source.kind).toBe('midi');
        if (source.kind === 'midi') expect(source.notes.map(({ id: _id, ...note }) => note)).toEqual(fixture.tracks[0]!.clips[0]!.notes.map(({ id: _id, ...note }) => note));

        const persisted = JSON.parse(JSON.stringify(arrangementForExport(migrated)));
        expect(readArrangement(persisted)).toEqual(migrated);
        expect(readArrangement(readArrangement(persisted))).toEqual(migrated);
    });
});
