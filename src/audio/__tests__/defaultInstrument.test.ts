import { describe, it, expect } from 'vitest';
import { getDefaultInstrumentVoice, DEFAULT_VOICE_INSTRUMENTS } from '../defaultInstrument';

describe('default instrument voice', () => {
    it('synthesizes a non-silent, normalized, finite mono voice at C4', () => {
        const v = getDefaultInstrumentVoice();
        expect(v.rootNote).toBe(60); // C4 — the sampler's unity-pitch note
        expect(v.sampleRate).toBeGreaterThan(0);
        expect(v.pcm.length).toBeGreaterThan(v.sampleRate); // > 1s of audio

        let peak = 0;
        let energy = 0;
        let finite = true;
        for (const s of v.pcm) {
            if (!Number.isFinite(s)) finite = false;
            const a = Math.abs(s);
            if (a > peak) peak = a;
            energy += s * s;
        }
        expect(finite).toBe(true);
        expect(energy).toBeGreaterThan(0); // not silence — the whole point
        expect(peak).toBeGreaterThan(0.5); // audible
        expect(peak).toBeLessThanOrEqual(1); // normalized, no clipping
    });

    it('decays over time (struck-string envelope: end quieter than start)', () => {
        const v = getDefaultInstrumentVoice();
        const win = Math.floor(v.sampleRate * 0.05); // 50ms RMS windows
        const rms = (from: number): number => {
            let e = 0;
            let count = 0;
            for (let i = from; i < from + win && i < v.pcm.length; i++) {
                e += v.pcm[i] * v.pcm[i];
                count++;
            }
            return count > 0 ? Math.sqrt(e / count) : 0;
        };
        const early = rms(Math.floor(v.sampleRate * 0.05));
        const late = rms(Math.floor(v.sampleRate * 1.0));
        expect(late).toBeLessThan(early);
    });

    it('is cached (same reference across calls)', () => {
        expect(getDefaultInstrumentVoice()).toBe(getDefaultInstrumentVoice());
    });

    it('covers the melodic alias instruments + the generic picker, not raw sample nodes', () => {
        expect(DEFAULT_VOICE_INSTRUMENTS.has('keys')).toBe(true);
        expect(DEFAULT_VOICE_INSTRUMENTS.has('piano')).toBe(true);
        // The generic `instrument` picker now sounds out of the box: it resolves a
        // voice from the selected `instrumentId` (still overridden the moment a user
        // binds a real sample — the executor skips nodes with a sample binding).
        expect(DEFAULT_VOICE_INSTRUMENTS.has('instrument')).toBe(true);
        // Raw sample nodes own their PCM; they must NOT be auto-defaulted.
        expect(DEFAULT_VOICE_INSTRUMENTS.has('sampler')).toBe(false);
        expect(DEFAULT_VOICE_INSTRUMENTS.has('library')).toBe(false);
    });
});
