import { describe, expect, it } from 'vitest';
import { normalizeArrangement } from '../normalize';
import { applyVerb, applyVerbs, type Verb } from '../verbs';
import type { Arrangement } from '../types';

const arr: Arrangement = normalizeArrangement({
    name: 'verbs', tempoBpm: 100, ppq: 960, idCounter: 3,
    sources: {
        'src:midi:m0': { id: 'src:midi:m0', kind: 'midi', name: 'Keys', lengthTick: 3840, notes: [
            { id: 'n0', tick: 0, durTick: 480, pitch: 60, vel: 90 },
            { id: 'n1', tick: 480, durTick: 480, pitch: 64, vel: 80 },
        ] },
        'src:midi:m1': { id: 'src:midi:m1', kind: 'midi', name: 'Unused', lengthTick: 960, notes: [] },
    },
    locations: [{ id: 'section', name: 'A', kind: 'section', startTick: 0 }, { id: 'loop', name: 'Loop', kind: 'loop', startTick: 0, endTick: 1920 }],
    graph: { nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'bass', type: 'keys' }, { ref: 'spk', type: 'speaker' }], connections: [{ from: 'keys', to: 'spk' }, { from: 'bass', to: 'spk' }] },
    tracks: [
        { id: 'keys-track', ref: 'keys', name: 'Keys', clips: [{ id: 'clip', sourceId: 'src:midi:m0', startTick: 0, lengthTick: 1920 }], automation: [{ id: 'lane', ref: 'keys', param: 1, points: [{ tick: 0, value: 200 }, { tick: 1920, value: 800 }] }] },
        { id: 'bass-track', ref: 'bass', name: 'Bass', clips: [] },
    ],
});

const cases: Verb[] = [
    { kind: 'compound', verbs: [{ kind: 'setTempo', tempoBpm: 110 }, { kind: 'setTrackMute', trackId: 'keys-track', mute: true }] },
    { kind: 'addSource', source: { id: 'src:audio:abcdef', kind: 'audio', name: 'take', assetId: 'abcdef', frames: 10, sampleRate: 48000, channels: 1 } },
    { kind: 'removeSource', sourceId: 'src:midi:m1' },
    { kind: 'addTrack', index: 1, track: { id: 'new-track', ref: 'bass', clips: [] } },
    { kind: 'removeTrack', trackId: 'bass-track' },
    { kind: 'setTrackMute', trackId: 'keys-track', mute: true },
    { kind: 'setTrackName', trackId: 'keys-track', name: 'Renamed' },
    { kind: 'addClip', trackId: 'bass-track', clip: { id: 'new-clip', sourceId: 'src:midi:m0', startTick: 2400, lengthTick: 480 } },
    { kind: 'removeClip', clipId: 'clip' },
    { kind: 'moveClip', clipId: 'clip', startTick: 2400, trackId: 'bass-track' },
    { kind: 'setClipWindow', clipId: 'clip', startTick: 120, sourceStart: 120, lengthTick: 1200 },
    { kind: 'trimClipStart', clipId: 'clip', startTick: 240 },
    { kind: 'trimClipEnd', clipId: 'clip', endTick: 1200 },
    { kind: 'slipClip', clipId: 'clip', sourceStart: 240 },
    { kind: 'splitClip', clipId: 'clip', atTick: 960, left: { id: 'left', sourceId: 'src:midi:m0', startTick: 0, lengthTick: 960 }, right: { id: 'right', sourceId: 'src:midi:m0', startTick: 960, lengthTick: 960 } },
    { kind: 'setClipGain', clipId: 'clip', gain: 0.5 },
    { kind: 'setClipEnvelope', clipId: 'clip', envelope: [{ tick: 0, gain: 0.5 }, { tick: 960, gain: 1 }] },
    { kind: 'setClipFade', clipId: 'clip', edge: 'in', fade: { lengthTick: 120, shape: 'constantPower' } },
    { kind: 'setClipFades', clipId: 'clip', fadeIn: { lengthTick: 120 }, fadeOut: { lengthTick: 240 } },
    { kind: 'setClipMute', clipId: 'clip', mute: true },
    { kind: 'setClipLayerIndex', clipId: 'clip', layerIndex: 2 },
    { kind: 'setClipSource', clipId: 'clip', sourceId: 'src:midi:m1', lengthTick: 480 },
    { kind: 'duplicateClip', clipId: 'clip', startTick: 2400, fork: false, clip: { id: 'copy', sourceId: 'src:midi:m0', startTick: 2400, lengthTick: 1920 } },
    { kind: 'addNote', sourceId: 'src:midi:m0', index: 2, note: { id: 'new-note', tick: 960, durTick: 240, pitch: 67 } },
    { kind: 'removeNote', noteId: 'n0' },
    { kind: 'editNote', noteId: 'n0', patch: { pitch: 72, vel: 100 } },
    { kind: 'addLocation', index: 1, location: { id: 'mark', name: 'Hit', kind: 'mark', startTick: 960 } },
    { kind: 'removeLocation', locationId: 'section' },
    { kind: 'moveLocation', locationId: 'section', startTick: 480 },
    { kind: 'setLocationName', locationId: 'section', name: 'Verse' },
    { kind: 'setLocationLocked', locationId: 'section', locked: true },
    { kind: 'setLoopRange', location: { id: 'loop', name: 'Loop 2', kind: 'loop', startTick: 240, endTick: 1440 } },
    { kind: 'setPunchRange', location: { id: 'punch', name: 'Punch', kind: 'punch', startTick: 240, endTick: 480 } },
    { kind: 'rippleTracks', atTick: 0, deltaTick: 240, trackIds: ['keys-track'], includeLocations: false },
    { kind: 'insertTime', atTick: 960, durationTick: 240, trackIds: ['keys-track'], splitIntersected: true, moveLocations: false },
    { kind: 'removeTime', atTick: 480, durationTick: 240, trackIds: ['keys-track'], moveLocations: false },
    { kind: 'stretchClip', clipId: 'clip', timeRatio: 2, pitchRatio: 1, anchor: 'start', newSource: { id: 'src:audio:cafe', kind: 'audio', name: 'render', assetId: 'cafe', frames: 100, sampleRate: 48000, channels: 1, derivedFrom: { of: 'src:midi:m0', timeRatio: 2, pitchRatio: 1 } }, newClip: { id: 'stretched', sourceId: 'src:audio:cafe', startTick: 0, lengthTick: 3840 } },
    { kind: 'bounceClips', trackId: 'keys-track', fromTick: 0, toTick: 1920, newSource: { id: 'src:audio:beef', kind: 'audio', name: 'bounce', assetId: 'beef', frames: 100, sampleRate: 48000, channels: 1 }, newClip: { id: 'bounce', sourceId: 'src:audio:beef', startTick: 0, lengthTick: 1920 } },
    { kind: 'setTempo', tempoBpm: 140 },
    { kind: 'addAutomationLane', trackId: 'bass-track', index: 0, lane: { id: 'new-lane', ref: 'bass', param: 0, points: [] } },
    { kind: 'removeAutomationLane', laneId: 'lane' },
    { kind: 'setAutomationPoint', laneId: 'lane', point: { tick: 960, value: 500 } },
    { kind: 'removeAutomationPoint', laneId: 'lane', tick: 1920 },
];

describe('v2 verbs', () => {
    it.each(cases.map((verb) => [verb.kind, verb] as const))('%s has an exact structural inverse', (_kind, verb) => {
        const { next, inverse } = applyVerb(arr, verb);
        expect(next).not.toEqual(arr);
        expect(applyVerb(next, inverse).next).toEqual(arr);
    });

    it('is fail-closed for missing ids, referenced source removal, and duplicate loop', () => {
        expect(() => applyVerb(arr, { kind: 'removeClip', clipId: 'ghost' })).toThrow(/no clip/);
        expect(() => applyVerb(arr, { kind: 'removeSource', sourceId: 'src:midi:m0' })).toThrow(/still referenced/);
        expect(() => applyVerb(arr, { kind: 'addLocation', index: 0, location: { id: 'loop2', name: 'x', kind: 'loop', startTick: 0, endTick: 10 } })).toThrow(/only one loop/);
    });

    it('ripple fails closed when a contraction would overlap a stationary clip', () => {
        const fixture = applyVerb(arr, { kind: 'addClip', trackId: 'keys-track', clip: { id: 'later', sourceId: 'src:midi:m0', startTick: 2400, lengthTick: 480 } }).next;
        expect(() => applyVerb(fixture, { kind: 'rippleTracks', atTick: 2000, deltaTick: -600, trackIds: ['keys-track'], includeLocations: false })).toThrow(/overlap/);
    });

    it('splitClip and removeTime restore through compound inverses', () => {
        for (const verb of [cases.find((item) => item.kind === 'splitClip')!, cases.find((item) => item.kind === 'removeTime')!]) {
            const result = applyVerb(arr, verb);
            expect(result.inverse.kind).toBe('compound');
            expect(applyVerb(result.next, result.inverse).next).toEqual(arr);
        }
    });

    it('applyVerbs reverses a batch in reverse order', () => {
        const result = applyVerbs(arr, [{ kind: 'setTempo', tempoBpm: 90 }, { kind: 'setTrackMute', trackId: 'keys-track', mute: true }]);
        expect(applyVerbs(result.next, result.inverse).next).toEqual(arr);
    });
});
