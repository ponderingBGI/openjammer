import { describe, expect, it } from 'vitest';
import { applyVerb, applyVerbs, type Verb } from '../verbs';
import { normalizeArrangement } from '../normalize';
import type { Arrangement } from '../types';

/** A normalized fixture (every entity already has a stable id). */
const arr: Arrangement = normalizeArrangement({
    name: 'verbs',
    tempoBpm: 100,
    ppq: 960,
    sections: [{ name: 'A', startBar: 1 }],
    graph: {
        nodes: [
            { ref: 'keys', type: 'keys' },
            { ref: 'bass', type: 'keys' },
            { ref: 'spk', type: 'speaker' },
        ],
        connections: [
            { from: 'keys', to: 'spk' },
            { from: 'bass', to: 'spk' },
        ],
    },
    tracks: [
        {
            ref: 'keys',
            name: 'Keys',
            clips: [
                {
                    startTick: 0,
                    notes: [
                        { tick: 0, durTick: 480, pitch: 60, vel: 90 },
                        { tick: 480, durTick: 480, pitch: 64, vel: 80 },
                    ],
                },
            ],
            automation: [{ ref: 'keys', param: 1, points: [{ tick: 0, value: 200 }, { tick: 1920, value: 800 }] }],
        },
        { ref: 'bass', name: 'Bass', clips: [] },
    ],
});

const trackId = arr.tracks[0]!.id!;
const bassId = arr.tracks[1]!.id!;
const clipId = arr.tracks[0]!.clips[0]!.id!;
const noteId = arr.tracks[0]!.clips[0]!.notes[0]!.id!;
const laneId = arr.tracks[0]!.automation![0]!.id!;
const sectionId = arr.sections![0]!.id!;

/** Every verb + a representative instance, for the round-trip law. */
const cases: Verb[] = [
    { kind: 'addTrack', index: 1, track: { id: 'newt', ref: 'bass', clips: [] } },
    { kind: 'removeTrack', trackId: bassId },
    { kind: 'setTrackMute', trackId, mute: true },
    { kind: 'setTrackName', trackId, name: 'Renamed' },
    { kind: 'addClip', trackId: bassId, index: 0, clip: { id: 'newc', startTick: 960, notes: [] } },
    { kind: 'removeClip', clipId },
    { kind: 'moveClip', clipId, startTick: 1920 },
    { kind: 'addNote', clipId, index: 2, note: { id: 'newn', tick: 960, durTick: 240, pitch: 67, vel: 70 } },
    { kind: 'removeNote', noteId },
    { kind: 'editNote', noteId, patch: { pitch: 72, vel: 100 } },
    { kind: 'addSection', index: 1, section: { id: 'news', name: 'B', startBar: 5 } },
    { kind: 'removeSection', sectionId },
    { kind: 'setTempo', tempoBpm: 140 },
    {
        kind: 'addAutomationLane',
        trackId: bassId,
        index: 0,
        lane: { id: 'newl', ref: 'bass', param: 0, points: [{ tick: 0, value: 0 }] },
    },
    { kind: 'removeAutomationLane', laneId },
    { kind: 'setAutomationPoint', laneId, point: { tick: 960, value: 500 } }, // new point
    { kind: 'setAutomationPoint', laneId, point: { tick: 0, value: 999 } }, // overwrite existing
    { kind: 'removeAutomationPoint', laneId, tick: 1920 },
];

describe('applyVerb — the reversible authoring vocabulary', () => {
    it.each(cases.map((v) => [v.kind, v] as const))(
        'round-trips %s (apply then inverse == identity)',
        (_kind, verb) => {
            const { next, inverse } = applyVerb(arr, verb);
            // The verb actually changed something …
            expect(next).not.toEqual(arr);
            // … and its inverse restores the EXACT original.
            const restored = applyVerb(next, inverse).next;
            expect(restored).toEqual(arr);
        },
    );

    it('throws (fail-closed) on a verb that references a missing id', () => {
        expect(() => applyVerb(arr, { kind: 'removeClip', clipId: 'ghost' })).toThrow(/no clip/);
        expect(() => applyVerb(arr, { kind: 'editNote', noteId: 'ghost', patch: { pitch: 1 } })).toThrow(/no note/);
        expect(() => applyVerb(arr, { kind: 'setTrackMute', trackId: 'ghost', mute: true })).toThrow(/no track/);
    });

    it('editNote inverse restores ONLY the keys the patch changed', () => {
        const before = arr.tracks[0]!.clips[0]!.notes[0]!;
        const { next, inverse } = applyVerb(arr, { kind: 'editNote', noteId, patch: { pitch: 72 } });
        const after = next.tracks[0]!.clips[0]!.notes[0]!;
        expect(after.pitch).toBe(72);
        expect(after.vel).toBe(before.vel); // untouched
        expect(inverse).toEqual({ kind: 'editNote', noteId, patch: { pitch: before.pitch } });
    });

    it('keeps automation points sorted by tick after an out-of-order insert', () => {
        const { next } = applyVerb(arr, { kind: 'setAutomationPoint', laneId, point: { tick: 480, value: 333 } });
        const ticks = next.tracks[0]!.automation![0]!.points.map((p) => p.tick);
        expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    });
});

describe('applyVerbs — atomic batches (intent compilers)', () => {
    it('applies in order and inverts in REVERSE order (one Ctrl+Z restores all)', () => {
        const batch: Verb[] = [
            { kind: 'setTempo', tempoBpm: 90 },
            { kind: 'setTrackMute', trackId, mute: true },
            { kind: 'moveClip', clipId, startTick: 480 },
        ];
        const { next, inverse } = applyVerbs(arr, batch);
        expect(next).not.toEqual(arr);
        const restored = applyVerbs(next, inverse).next;
        expect(restored).toEqual(arr);
    });
});
