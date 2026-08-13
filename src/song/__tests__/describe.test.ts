import { describe, expect, it } from 'vitest';
import { describeArrangement } from '../describe';
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
});
