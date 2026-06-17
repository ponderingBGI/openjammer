/**
 * Procedural voice engine — every selectable instrument makes a distinct,
 * non-silent sound, deterministically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getFamilyVoice,
    getInstrumentVoice,
    resolveVoiceFamily,
    _resetVoiceCacheForTests,
    type VoiceFamily,
} from '../voiceSynth';
import { getVoiceForInstrumentNode } from '../defaultInstrument';
import { INSTRUMENT_DEFINITIONS } from '../instrumentCatalog';

const ALL_FAMILIES: VoiceFamily[] = [
    'keys', 'piano', 'epiano', 'organ', 'mallet', 'bell', 'pluck', 'bass',
    'strings', 'brass', 'reed', 'flute', 'lead', 'pad', 'percussion', 'world',
];

/** Peak absolute amplitude of a buffer. */
function peak(pcm: Float32Array): number {
    let p = 0;
    for (const v of pcm) {
        if (!Number.isFinite(v)) return NaN;
        const a = Math.abs(v);
        if (a > p) p = a;
    }
    return p;
}

beforeEach(() => _resetVoiceCacheForTests());

describe('voice synthesis', () => {
    it('every family renders finite, normalized, non-silent PCM', () => {
        for (const fam of ALL_FAMILIES) {
            const v = getFamilyVoice(fam);
            expect(v.pcm.length).toBeGreaterThan(0);
            expect(v.sampleRate).toBeGreaterThan(0);
            expect(v.rootNote).toBe(60);
            const p = peak(v.pcm);
            expect(p).toBeGreaterThan(0.5); // peak-normalized to ~0.9
            expect(p).toBeLessThanOrEqual(0.91);
        }
    });

    it('is deterministic — same family renders identical PCM', () => {
        const a = getFamilyVoice('piano').pcm;
        _resetVoiceCacheForTests();
        const b = getFamilyVoice('piano').pcm;
        expect(a.length).toBe(b.length);
        expect(Array.from(a.slice(0, 256))).toEqual(Array.from(b.slice(0, 256)));
    });

    it('produces AUDIBLY DIFFERENT voices across families', () => {
        // Compare a few characteristically-different families: their PCM must differ.
        const fams: VoiceFamily[] = ['piano', 'strings', 'reed', 'organ', 'bell'];
        const heads = fams.map((f) => Array.from(getFamilyVoice(f).pcm.slice(2000, 2100)).join(','));
        const unique = new Set(heads);
        expect(unique.size).toBe(fams.length);
    });
});

describe('resolveVoiceFamily — instrument → timbre', () => {
    const cases: Array<[string, string, VoiceFamily]> = [
        ['gm-acoustic-grand-piano', 'Acoustic Grand Piano', 'piano'],
        ['gm-electric-piano-1', 'Electric Piano 1', 'epiano'],
        ['gm-church-organ', 'Church Organ', 'organ'],
        ['gm-vibraphone', 'Vibraphone', 'mallet'],
        ['gm-tubular-bells', 'Tubular Bells', 'bell'],
        ['karplus-acoustic', 'Acoustic Guitar', 'pluck'],
        ['gm-cello', 'Cello', 'strings'],
        ['gm-violin', 'Violin', 'strings'],
        ['gm-trumpet', 'Trumpet', 'brass'],
        ['gm-alto-sax', 'Alto Sax', 'reed'],
        ['gm-flute', 'Flute', 'flute'],
        ['gm-acoustic-bass', 'Acoustic Bass', 'bass'],
        ['gm-lead-1-square', 'Lead 1 (square)', 'lead'],
        ['gm-pad-1-new-age', 'Pad 1 (new age)', 'pad'],
        ['gm-acoustic-snare', 'Acoustic Snare', 'percussion'],
    ];
    for (const [id, name, want] of cases) {
        it(`${name} → ${want}`, () => {
            expect(resolveVoiceFamily(id, name)).toBe(want);
        });
    }

    it('falls back to the catalogue category when no keyword matches', () => {
        expect(resolveVoiceFamily('myinst', 'Weird Thing', 'brass')).toBe('brass');
        expect(resolveVoiceFamily('myinst', 'Weird Thing', 'guitar')).toBe('pluck');
    });

    it('falls back to the warm default for a totally unknown instrument', () => {
        expect(resolveVoiceFamily('zzz', 'zzz')).toBe('keys');
    });
});

describe('NO instrument in the catalogue is silent (golden)', () => {
    it('every catalogue entry resolves to a non-silent, finite voice', () => {
        expect(INSTRUMENT_DEFINITIONS.length).toBeGreaterThan(100);
        for (const def of INSTRUMENT_DEFINITIONS) {
            const v = getInstrumentVoice(def.id, def.name, def.category);
            const p = peak(v.pcm);
            expect(Number.isFinite(p), `${def.id} produced non-finite PCM`).toBe(true);
            expect(p, `${def.id} is silent`).toBeGreaterThan(0.1);
        }
    });
});

describe('getVoiceForInstrumentNode — executor seam', () => {
    it('uses data.instrumentId when present', () => {
        const sax = getVoiceForInstrumentNode('instrument', { instrumentId: 'gm-alto-sax' });
        expect(sax.key).toBe('reed');
        const piano = getVoiceForInstrumentNode('instrument', { instrumentId: 'gm-acoustic-grand-piano' });
        expect(piano.key).toBe('piano');
        // Different selections → different bound voices.
        expect(sax.key).not.toBe(piano.key);
    });

    it('resolves from the node type when there is no instrumentId', () => {
        expect(getVoiceForInstrumentNode('cello', undefined).key).toBe('strings');
        expect(getVoiceForInstrumentNode('saxophone', undefined).key).toBe('reed');
        expect(getVoiceForInstrumentNode('piano', {}).key).toBe('piano');
    });

    it('returns a stable key for re-bind comparison', () => {
        const a = getVoiceForInstrumentNode('instrument', { instrumentId: 'gm-flute' });
        const b = getVoiceForInstrumentNode('instrument', { instrumentId: 'gm-flute' });
        expect(a.key).toBe(b.key);
    });
});
