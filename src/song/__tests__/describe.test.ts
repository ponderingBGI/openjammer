import { describe, expect, it } from 'vitest';
import { DESCRIBE_NOTE_CAP, describeArrangement } from '../describe';
import { normalizeArrangement } from '../normalize';
import { buildPaperSketch } from '../songs/paperSketch';
import type { Arrangement } from '../types';

describe('describeArrangement', () => {
    it('summarizes Paper Sketch with names, ids, sections, and bar.beat positions', () => {
        const arr = normalizeArrangement(buildPaperSketch());
        const out = describeArrangement(arr);
        // Title + tempo/meter.
        expect(out).toContain('"Paper Sketch No. 1" — 84 BPM, 4/4');
        // Sections labelled at bar.beat (never raw ticks).
        expect(out).toContain('Sections:');
        expect(out).toContain('Intro (1.1)');
        expect(out).toContain('Lift (9.1)');
        // Each track named + its stable id (what the verbs target).
        for (const t of arr.tracks) {
            expect(out).toContain(`id ${t.id}`);
        }
        expect(out).toContain('Nylon Chords');
        // Pitch range rendered as note names, not raw MIDI.
        expect(out).toMatch(/[A-G]#?-?\d–[A-G]#?-?\d/);
        // Clips named by id so the agent can target them.
        expect(out).toContain(`clip ${arr.tracks[0]!.clips[0]!.id}`);
        // The chords track's automation lane is surfaced.
        expect(out).toContain('automation');
    });

    it('handles an empty arrangement gracefully', () => {
        const empty: Arrangement = { name: 'Blank', tempoBpm: 120, graph: { nodes: [] }, tracks: [] };
        const out = describeArrangement(empty);
        expect(out).toContain('"Blank" — 120 BPM');
        expect(out).toContain('No tracks yet');
    });

    it('marks a muted track', () => {
        const arr = normalizeArrangement({
            name: 'm',
            tempoBpm: 120,
            graph: { nodes: [{ ref: 'k', type: 'keys' }] },
            tracks: [{ ref: 'k', name: 'Keys', mute: true, clips: [] }],
        });
        expect(describeArrangement(arr)).toContain('MUTED');
    });

    it('BC-30..37 lists addressable note details per clip', () => {
        const arr = normalizeArrangement({
            name: 'Notes',
            tempoBpm: 120,
            graph: { nodes: [{ ref: 'keys', type: 'keys' }] },
            sources: {
                melody: {
                    id: 'melody', kind: 'midi', name: 'Melody', lengthTick: 960,
                    notes: [
                        { id: 'outside', tick: 0, durTick: 60, pitch: 48, vel: 12 },
                        { id: 'target', tick: 240, durTick: 120, pitch: 64, vel: 91 },
                    ],
                },
            },
            tracks: [{ ref: 'keys', clips: [{ id: 'clip-a', sourceId: 'melody', startTick: 0, sourceStart: 120, lengthTick: 480 }] }],
        });

        const out = describeArrangement(arr);
        expect(out).toContain('notes (first 1 of 1)');
        expect(out).toContain('{id target, pitch 64, tick 240, durTick 120, vel 91}');
        expect(out).not.toContain('{id outside,');
    });

    it('caps dense per-clip note details and reports the omitted count', () => {
        const count = DESCRIBE_NOTE_CAP + 3;
        const arr = normalizeArrangement({
            name: 'Dense', tempoBpm: 120, graph: { nodes: [{ ref: 'keys', type: 'keys' }] },
            sources: {
                dense: {
                    id: 'dense', kind: 'midi', name: 'Dense', lengthTick: count * 10,
                    notes: Array.from({ length: count }, (_, index) => ({
                        id: `n${index}`, tick: index * 10, durTick: 8, pitch: 60, vel: index,
                    })),
                },
            },
            tracks: [{ ref: 'keys', clips: [{ id: 'dense-clip', sourceId: 'dense', startTick: 0, lengthTick: count * 10 }] }],
        });

        const out = describeArrangement(arr);
        expect(out).toContain(`notes (first ${DESCRIBE_NOTE_CAP} of ${count})`);
        expect(out).toContain(`{id n${DESCRIBE_NOTE_CAP - 1},`);
        expect(out).not.toContain(`{id n${DESCRIBE_NOTE_CAP},`);
        expect(out).toContain('+3 more');
    });
});
