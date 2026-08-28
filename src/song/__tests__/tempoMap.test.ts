import { describe, expect, it } from 'vitest';
import type { TempoMap } from '@openjammer/oj-protocol';
import {
    buildTempoMap,
    secondsToTick,
    serializeTempoMap,
    tickToSeconds,
} from '../tempoMap';

describe('tempo map', () => {
    it('builds the current scalar arrangement as an ojproto map', () => {
        const map = buildTempoMap({ tempoBpm: 120 });
        expect(map).toEqual({
            ppq: 960,
            sample_rate: 48_000,
            tempos: [{
                tick: 0,
                sample: 0,
                bpm_start: 120,
                bpm_end: 120,
                continuing: false,
            }],
            meters: [{
                tick: 0,
                sample: 0,
                bar: 1,
                divisions_per_bar: 4,
                note_value: 4,
            }],
        });
        expect(JSON.parse(new TextDecoder().decode(serializeTempoMap(map)))).toEqual(map);
    });

    it('round-trips constant and ramped segments', () => {
        const map: TempoMap = {
            ppq: 960,
            sample_rate: 48_000,
            tempos: [
                { tick: 0, sample: 0, bpm_start: 120, bpm_end: 180, continuing: false },
                { tick: 3840, sample: 83_178, bpm_start: 180, bpm_end: 180, continuing: false },
            ],
            meters: [
                { tick: 0, sample: 0, bar: 1, divisions_per_bar: 4, note_value: 4 },
            ],
        };
        for (const tick of [0, 480, 1920, 3839, 3840, 8000]) {
            expect(secondsToTick(map, tickToSeconds(map, tick))).toBeCloseTo(tick, 8);
        }
    });
});
