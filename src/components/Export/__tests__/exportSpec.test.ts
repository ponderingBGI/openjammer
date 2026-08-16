import { describe, expect, it } from 'vitest';
import { buildPaperSketch } from '../../../song/songs/paperSketch';
import { assembleExportArgs, clipWarning, peakWarning } from '../exportSpec';
import type { BounceSpec } from '../types';

const spec: BounceSpec = {
    sampleRate: 96_000,
    bitDepth: '24',
    format: 'flac',
    tail: { mode: 'fixed', seconds: 1.5 },
};
const paperSketch = buildPaperSketch();

describe('export contract assembly', () => {
    it('matches the export_arrangement invoke keys and target sample rate', () => {
        const args = assembleExportArgs(paperSketch, spec, '/music/master.flac', 'native');
        expect(Object.keys(args)).toEqual(['graph', 'timeline', 'tempoMap', 'spec', 'outPath']);
        expect(args.spec).toEqual(spec);
        expect(args.outPath).toBe('/music/master.flac');
        expect(args.graph.sample_rate).toBe(96_000);
        expect(args.timeline.sample_rate).toBe(96_000);
        expect(args.tempoMap.sample_rate).toBe(96_000);
    });

    it('warns above -1 dBFS and on any clipped sample', () => {
        expect(peakWarning(-1)).toBe(false);
        expect(peakWarning(-0.999)).toBe(true);
        expect(clipWarning(0)).toBe(false);
        expect(clipWarning(1)).toBe(true);
    });
});
