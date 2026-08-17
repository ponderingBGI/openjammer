import type { Arrangement, ArrangementNote, MidiSource } from '../types';
import { seededRandom } from './prng';

export const DENSE_EDIT_SEED = 0xd3e5e;
const PPQ = 960;
const BAR = PPQ * 4;

export function buildDenseEdit(seed = DENSE_EDIT_SEED): Arrangement {
    const random = seededRandom(seed);
    const refs = ['rhythm', 'harmony', 'melody', 'texture'] as const;
    const sources: Record<string, MidiSource> = {};
    const tracks = refs.map((ref, trackIndex) => {
        const sourceId = `dense-source-${ref}`;
        const notes: ArrangementNote[] = Array.from({ length: 64 }, (_, index) => ({
            id: `dense-note-${trackIndex}-${index}`,
            tick: index * PPQ / 2,
            durTick: index % 7 === 0 ? PPQ + PPQ / 2 : random.pick([PPQ / 4, PPQ / 2, PPQ]),
            pitch: 36 + trackIndex * 12 + (index * 5) % 12,
            vel: random.int(38, 124),
        }));
        sources[sourceId] = { id: sourceId, kind: 'midi', name: `${ref} source`, notes, lengthTick: BAR * 16 };
        return {
            id: `dense-track-${ref}`,
            name: ref[0]!.toUpperCase() + ref.slice(1),
            ref,
            gainDb: -trackIndex * 1.5,
            pan: [-0.55, -0.15, 0.25, 0.6][trackIndex],
            clips: Array.from({ length: 8 }, (_, clipIndex) => ({
                id: `dense-clip-${trackIndex}-${clipIndex}`,
                sourceId,
                startTick: clipIndex * BAR * 2 - (clipIndex > 0 ? PPQ / 2 : 0),
                lengthTick: BAR * 2 + (clipIndex % 2 ? PPQ : 0),
                sourceStart: (clipIndex * PPQ) % (BAR * 4),
                layerIndex: clipIndex % 3,
                gain: 0.72 + trackIndex * 0.06,
                fadeIn: { lengthTick: PPQ / 4, shape: 'constantPower' as const },
                fadeOut: { lengthTick: PPQ / 2, shape: 'symmetric' as const },
                envelope: [{ tick: 0, gain: 0.65 }, { tick: PPQ, gain: 1 }, { tick: BAR, gain: 0.8 }],
                name: `${ref} take ${clipIndex + 1}`,
            })),
            automation: [{
                id: `dense-lane-${ref}`, ref: `${ref}:output:gain`, param: 0, state: 'Play' as const, interp: trackIndex % 2 ? 'Discrete' as const : 'Linear' as const,
                points: Array.from({ length: 17 }, (_, index) => ({ tick: index * BAR, value: Number((-12 + random.float() * 10).toFixed(3)) })),
            }],
        };
    });
    return {
        name: `Dense Edit · seed ${seed >>> 0}`, schemaVersion: 2, idCounter: 10_000,
        tempoBpm: 108, ppq: PPQ, timeSignature: [4, 4], sampleRate: 48_000, blockSize: 256, sources,
        locations: [
            { id: 'dense-a', name: 'A', kind: 'section', startTick: 0, endTick: BAR * 4 },
            { id: 'dense-b', name: 'B', kind: 'section', startTick: BAR * 4, endTick: BAR * 8 },
            { id: 'dense-loop', name: 'Loop', kind: 'loop', startTick: BAR * 8, endTick: BAR * 12 },
            { id: 'dense-punch', name: 'Punch', kind: 'punch', startTick: BAR * 2, endTick: BAR * 4 },
            { id: 'dense-song', name: 'Song', kind: 'songRange', startTick: 0, endTick: BAR * 16 },
        ],
        graph: {
            nodes: [...refs.map((ref) => ({ ref, type: 'instrument' as const, data: { instrumentId: 'karplus-electric' } })), { ref: 'dense-master', type: 'speaker' }],
            connections: refs.map((ref) => ({ from: ref, to: 'dense-master' })),
        }, tracks,
    };
}

export default buildDenseEdit;
