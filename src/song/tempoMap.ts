// Authoring-side mirror of ojcore's immutable tempo-map arithmetic. Wire field
// names stay snake_case because serde_json preserves the ojproto Rust names.

import { PPQ, type TempoMap, type TempoPoint } from '@openjammer/oj-protocol';
import type { Arrangement } from './types';

export type { MeterPoint, TempoMap, TempoPoint } from '@openjammer/oj-protocol';

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_TIME_SIGNATURE: readonly [number, number] = [4, 4];

export type TempoMapArrangement = Pick<
    Arrangement,
    'ppq' | 'sampleRate' | 'tempoBpm' | 'timeSignature'
>;

/** Build today's one-tempo/one-meter arrangement as an ojproto wire document. */
export function buildTempoMap(arrangement: TempoMapArrangement): TempoMap {
    const ppq = arrangement.ppq ?? PPQ;
    const sampleRate = arrangement.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const [divisionsPerBar, noteValue] =
        arrangement.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    return normalizeTempoMap({
        ppq,
        sample_rate: sampleRate,
        tempos: [
            {
                tick: 0,
                sample: 0,
                bpm_start: arrangement.tempoBpm,
                bpm_end: arrangement.tempoBpm,
                continuing: false,
            },
        ],
        meters: [
            {
                tick: 0,
                sample: 0,
                bar: 1,
                divisions_per_bar: divisionsPerBar,
                note_value: noteValue,
            },
        ],
    });
}

/** Validate and defensively clone a complete authored map before publication. */
export function normalizeTempoMap(map: TempoMap): TempoMap {
    requirePositiveInteger(map.ppq, 'ppq');
    requirePositiveInteger(map.sample_rate, 'sample_rate');
    if (map.tempos.length === 0) throw new Error('tempo map needs a tempo point');
    if (map.meters.length === 0) throw new Error('tempo map needs a meter point');

    const tempos = map.tempos.map((point) => ({ ...point }));
    const meters = map.meters.map((point) => ({ ...point }));
    if (tempos[0].tick !== 0 || tempos[0].sample !== 0) {
        throw new Error('tempo map must start at tick/sample zero');
    }
    if (meters[0].tick !== 0 || meters[0].sample !== 0) {
        throw new Error('meter map must start at tick/sample zero');
    }

    tempos.forEach((point, index) => {
        requireNonNegativeInteger(point.tick, `tempos[${index}].tick`);
        requireNonNegativeInteger(point.sample, `tempos[${index}].sample`);
        requirePositiveFinite(point.bpm_start, `tempos[${index}].bpm_start`);
        requirePositiveFinite(point.bpm_end, `tempos[${index}].bpm_end`);
        if (point.tick % map.ppq !== 0) {
            throw new Error(`tempos[${index}] must be on a quarter-note boundary`);
        }
        const previous = tempos[index - 1];
        if (previous && (point.tick <= previous.tick || point.sample <= previous.sample)) {
            throw new Error('tempo ticks and samples must be strictly increasing');
        }
    });

    meters.forEach((point, index) => {
        requireNonNegativeInteger(point.tick, `meters[${index}].tick`);
        requireNonNegativeInteger(point.sample, `meters[${index}].sample`);
        requirePositiveInteger(point.bar, `meters[${index}].bar`);
        requirePositiveInteger(point.divisions_per_bar, `meters[${index}].divisions_per_bar`);
        requirePositiveInteger(point.note_value, `meters[${index}].note_value`);
        const previous = meters[index - 1];
        if (!previous) return;
        if (point.tick <= previous.tick || point.sample <= previous.sample) {
            throw new Error('meter ticks and samples must be strictly increasing');
        }
        const priorBarTicks =
            ((map.ppq * 4) / previous.note_value) * previous.divisions_per_bar;
        if (!Number.isInteger(priorBarTicks) || (point.tick - previous.tick) % priorBarTicks !== 0) {
            throw new Error(`meters[${index}] must be on a bar boundary`);
        }
    });

    return { ppq: map.ppq, sample_rate: map.sample_rate, tempos, meters };
}

/** JSON bytes matching ojproto's serde wire shape. */
export function serializeTempoMap(map: TempoMap): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(normalizeTempoMap(map)));
}

/** Convert a musical tick through a complete tempo map. */
export function tickToSeconds(map: TempoMap, tick: number): number {
    const index = segmentAt(map.tempos, tick, (point) => point.tick);
    const point = map.tempos[index];
    const next = map.tempos[index + 1];
    const deltaQuarters = (tick - point.tick) / map.ppq;
    const secondsAtPoint = point.sample / map.sample_rate;
    const omega = rampOmega(map, point, next);
    if (omega === 0) {
        // Preserve the exact operation ordering of time.ts's former scalar path.
        return secondsAtPoint + (tick - point.tick) *
            (60 / (point.bpm_start * map.ppq));
    }
    const spq0 = samplesPerQuarter(map, point.bpm_start);
    return secondsAtPoint + Math.log1p(spq0 * omega * deltaQuarters) /
        omega / map.sample_rate;
}

/** Resolve an authored tick to the integer sample coordinate published to ojcore. */
export function tickToSample(map: TempoMap, tick: number): number {
    return Math.max(0, Math.round(tickToSeconds(map, tick) * map.sample_rate));
}

/** Resolve an engine timeline sample back through the same authored map. */
export function sampleToTick(map: TempoMap, sample: number): number {
    return secondsToTick(map, sample / map.sample_rate);
}

/** Convert seconds through a complete tempo map to a fractional musical tick. */
export function secondsToTick(map: TempoMap, seconds: number): number {
    const sample = seconds * map.sample_rate;
    const index = segmentAt(map.tempos, sample, (point) => point.sample);
    const point = map.tempos[index];
    const next = map.tempos[index + 1];
    const deltaSamples = sample - point.sample;
    const omega = rampOmega(map, point, next);
    if (omega === 0) {
        return point.tick + (seconds - point.sample / map.sample_rate) /
            (60 / (point.bpm_start * map.ppq));
    }
    const spq0 = samplesPerQuarter(map, point.bpm_start);
    const deltaQuarters = Math.expm1(omega * deltaSamples) / (spq0 * omega);
    return point.tick + deltaQuarters * map.ppq;
}

function rampOmega(map: TempoMap, point: TempoPoint, next: TempoPoint | undefined): number {
    if (!next) return 0;
    const endBpm = point.continuing ? next.bpm_start : point.bpm_end;
    if (endBpm === point.bpm_start) return 0;
    const spq0 = samplesPerQuarter(map, point.bpm_start);
    const spq1 = samplesPerQuarter(map, endBpm);
    const durationQuarters = (next.tick - point.tick) / map.ppq;
    return (1 / spq1 - 1 / spq0) / durationQuarters;
}

function samplesPerQuarter(map: TempoMap, bpm: number): number {
    return map.sample_rate * 60 / bpm;
}

function segmentAt<T>(points: readonly T[], value: number, coordinate: (point: T) => number): number {
    let low = 0;
    let high = points.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (coordinate(points[middle]) <= value) low = middle + 1;
        else high = middle;
    }
    return Math.max(0, low - 1);
}

function requirePositiveFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function requireNonNegativeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
