import type { Arrangement, ArrangementClip, ArrangementNote, Source } from '../types';
import { seededRandom } from './prng';

export const HUNDRED_TRACKS_SEED = 0x0f1e57;
const PPQ = 960;
const BAR = PPQ * 4;
const TRACKS = 100;
const CLIPS_PER_TRACK = 20;

/** J8/T1 shared stress document: exactly 100 tracks, 2,000 clips and 40,000 MIDI notes. */
export function buildHundredTracks(seed = HUNDRED_TRACKS_SEED): Arrangement {
    const random = seededRandom(seed);
    const sources: Record<string, Source> = {};
    const tracks = Array.from({ length: TRACKS }, (_, trackIndex) => {
        const ref = `stress-voice-${trackIndex.toString().padStart(3, '0')}`;
        const trackId = `stress-track-${trackIndex.toString().padStart(3, '0')}`;
        const clips: ArrangementClip[] = [];
        for (let clipIndex = 0; clipIndex < CLIPS_PER_TRACK; clipIndex++) {
            const ordinal = trackIndex * CLIPS_PER_TRACK + clipIndex;
            const sourceId = `stress-source-${ordinal.toString().padStart(4, '0')}`;
            const startTick = clipIndex * BAR * 2 + (trackIndex % 4) * (PPQ / 4);
            const lengthTick = BAR * 2;
            if (clipIndex % 5 === 4) {
                sources[sourceId] = {
                    id: sourceId,
                    kind: 'audio',
                    name: `Stem ${ordinal}`,
                    assetId: `0x${(0x1000 + ordinal).toString(16)}`,
                    frames: 192_000,
                    sampleRate: 48_000,
                    channels: 2,
                    naturalBpm: 120,
                };
            } else {
                const notes: ArrangementNote[] = Array.from({ length: 25 }, (_, noteIndex) => ({
                    id: `stress-note-${ordinal}-${noteIndex}`,
                    tick: noteIndex * 300,
                    durTick: random.pick([120, 180, 240, 360]),
                    pitch: 36 + ((trackIndex * 3 + noteIndex * 5 + random.int(0, 4)) % 48),
                    vel: random.int(35, 118),
                }));
                sources[sourceId] = { id: sourceId, kind: 'midi', name: `Pattern ${ordinal}`, notes, lengthTick };
            }
            clips.push({
                id: `stress-clip-${ordinal.toString().padStart(4, '0')}`,
                sourceId,
                startTick,
                lengthTick,
                layerIndex: clipIndex % 5 === 4 ? 1 : 0,
                gain: Number((0.72 + random.float() * 0.24).toFixed(4)),
            });
        }
        return {
            id: trackId,
            name: `Track ${trackIndex + 1}`,
            ref,
            clips,
            gainDb: Number((-12 + random.float() * 9).toFixed(3)),
            pan: Number((-0.8 + random.float() * 1.6).toFixed(3)),
            automation: [{
                id: `${trackId}-gain`, ref: `${ref}:output:gain`, param: 0, state: 'Play' as const, interp: 'Linear' as const,
                points: Array.from({ length: 9 }, (_, point) => ({ tick: point * BAR * 5, value: Number((-9 + random.float() * 6).toFixed(3)) })),
            }],
        };
    });
    const refs = tracks.map((track) => track.ref);
    return {
        name: `Hundred Tracks · seed ${seed >>> 0}`,
        schemaVersion: 2,
        idCounter: 100_000,
        tempoBpm: 120,
        ppq: PPQ,
        timeSignature: [4, 4],
        sampleRate: 48_000,
        blockSize: 256,
        sources,
        locations: [{ id: 'stress-song-range', name: 'Long Set', kind: 'songRange', startTick: 0, endTick: BAR * 40 }],
        graph: {
            nodes: [...refs.map((ref, index) => ({ ref, type: 'instrument' as const, data: { instrumentId: index % 2 ? 'karplus-nylon' : 'karplus-electric' } })), { ref: 'stress-master', type: 'speaker' }],
            connections: refs.map((ref) => ({ from: ref, to: 'stress-master' })),
        },
        tracks,
    };
}

export default buildHundredTracks;
