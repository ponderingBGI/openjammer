import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement } from '../../../song/types';
import { applyVerbs } from '../../../song/verbs';
import { appendMidiRecordJournal, beginMidiRecordJournal, recoverMidiRecordJournal } from '../midiRecordJournal';

const arrangement: Arrangement = {
    name: 'journal', tempoBpm: 120, ppq: 960,
    graph: { nodes: [{ ref: 'keys', type: 'instrument' }], connections: [] },
    tracks: [{ id: 'track-1', ref: 'keys', clips: [] }],
};

describe('browser MIDI record journal', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(Date, 'now').mockReturnValue(42);
    });
    afterEach(() => vi.restoreAllMocks());

    it('recovers a closed note through the normal capture verb path and consumes the journal', () => {
        const bindings = [{ trackId: 'track-1', ref: 'keys', node: 7, kind: 'midi' as const, inputLabel: 'MIDI' }];
        beginMidiRecordJournal(100, bindings);
        appendMidiRecordJournal({ node: 7, note: 64, velocity: 99, on: true, tick: 120 });
        appendMidiRecordJournal({ node: 7, note: 64, velocity: 0, on: false, tick: 360 });
        let id = 0;
        const verbs = recoverMidiRecordJournal(arrangement, (prefix) => `${prefix}-${++id}`);
        const recovered = applyVerbs(arrangement, verbs).next;
        const source = Object.values(recovered.sources ?? {})[0];
        expect(source?.kind === 'midi' && source.notes).toHaveLength(1);
        expect(source?.kind === 'midi' && source.notes[0]).toMatchObject({ pitch: 64, tick: 20, durTick: 240, vel: 99 });
        expect(recovered.tracks[0]?.clips).toHaveLength(1);
        expect(recoverMidiRecordJournal(recovered, () => 'unused')).toEqual([]);
    });
});
