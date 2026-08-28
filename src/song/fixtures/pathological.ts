import type { Arrangement } from '../types';

export const PATHOLOGICAL_SEED = 0x7a11;

export function buildPathological(seed = PATHOLOGICAL_SEED): Arrangement {
    const suffix = (seed >>> 0).toString(16);
    return {
        name: `病理的 🎛️ e\u0301 · ${suffix}`, schemaVersion: 2, idCounter: 77,
        tempoBpm: 240, ppq: 960, timeSignature: [7, 8], sampleRate: 48_000, blockSize: 256,
        sources: {
            [`path-midi-${suffix}`]: {
                id: `path-midi-${suffix}`, kind: 'midi', name: '同時刻 / ties', lengthTick: 6720,
                notes: [
                    { id: 'path-note-zero-velocity', tick: 0, durTick: 1, pitch: 0, vel: 0 },
                    { id: 'path-note-tie-a', tick: 960, durTick: 960, pitch: 127, vel: 127 },
                    { id: 'path-note-tie-b', tick: 960, durTick: 1, pitch: 60, vel: 1 },
                    { id: 'path-note-tie-c', tick: 960, durTick: 4, pitch: 60, vel: 127 },
                    { id: 'path-note-tail', tick: 6719, durTick: 1, pitch: 64, vel: 64 },
                ],
            },
        },
        locations: [
            { id: 'path-mark-a', name: 'α', kind: 'mark', startTick: 960 },
            { id: 'path-mark-b', name: 'β', kind: 'mark', startTick: 960 },
            { id: 'path-range', name: '⅞', kind: 'songRange', startTick: 0, endTick: 6720 },
        ],
        graph: { nodes: [{ ref: 'path-voice', type: 'instrument', data: { instrumentId: 'karplus-electric' } }, { ref: 'path-master', type: 'speaker' }], connections: [{ from: 'path-voice', to: 'path-master' }] },
        tracks: [{
            id: 'path-track-🎹', name: '鍵盤 — “loud”', ref: 'path-voice',
            clips: [
                { id: 'path-zero-guard', sourceId: `path-midi-${suffix}`, startTick: 0, lengthTick: 0, name: 'zero-length guard' },
                { id: 'path-main', sourceId: `path-midi-${suffix}`, startTick: 0, lengthTick: 6720, fadeIn: { lengthTick: 1 }, fadeOut: { lengthTick: 1 } },
                { id: 'path-overlap', sourceId: `path-midi-${suffix}`, startTick: 960, lengthTick: 1, sourceStart: 960, layerIndex: 127 },
            ],
            automation: [{ id: 'path-auto', ref: 'path-voice:output:gain', param: 0, state: 'Play', interp: 'Discrete', points: [{ tick: 0, value: -60 }, { tick: 960, value: 12 }, { tick: 960, value: -12 }, { tick: 6719, value: 0 }] }],
        }],
    };
}

export default buildPathological;
