/**
 * Built-in default instrument voice.
 *
 * Melodic instrument nodes (Keys, Piano, Cello, …) lower to the engine's
 * `builtin.sampler` (see `src/engine/manifest.ts`), which is **silent until PCM
 * is bound**. The repo ships no sample assets and these category-alias
 * instruments have no sample-picker UI, so a freshly-wired `MiniLab → Keys →
 * Speaker` patch produces no sound at all — the note routes correctly but lands
 * on an empty sampler.
 *
 * To make instruments playable out of the box we synthesize one pleasant default
 * voice here and the executor lowers it into every such node (per
 * {@link DEFAULT_VOICE_INSTRUMENTS}). The engine sampler pitch-shifts a single
 * sample by `2^((note-rootNote)/12)`, so one tone at C4 plays correctly across
 * the whole keyboard. A user who later binds a real sample simply replaces it.
 *
 * The waveform is a warm additive tone with a natural per-partial decay (an
 * electric-piano / bell character that suits "Keys") — deterministic and pure so
 * it is unit-testable and identical every run.
 */

/** Instrument node types that get the built-in default voice (no sample UI). */
export const DEFAULT_VOICE_INSTRUMENTS: ReadonlySet<string> = new Set([
    'keys',
    'piano',
    'cello',
    'electricCello',
    'violin',
    'saxophone',
    'strings',
    'winds',
]);

/** A decoded mono voice ready to lower into the engine sampler. */
export interface DefaultVoice {
    /** Mono PCM, peak-normalized to ~0.9. */
    pcm: Float32Array;
    /** Sample rate of {@link pcm} (the engine SR-corrects on load). */
    sampleRate: number;
    /** The MIDI note the sample is recorded at (C4) — the sampler's unity pitch. */
    rootNote: number;
}

/** C4 in MIDI + Hz (the sample's recorded pitch / unity playback note). */
const ROOT_NOTE = 60;
const ROOT_HZ = 261.6256;
/** 24 kHz keeps the IPC payload small; the sampler SR-corrects on load. */
const SAMPLE_RATE = 24000;
const DURATION_S = 1.4;
const ATTACK_S = 0.004;

/**
 * Harmonic series for the voice: each partial has its own amplitude and decay
 * rate. Higher partials decay faster, so the tone is bright on attack and mellows
 * as it rings out — the natural behaviour of a struck/plucked string.
 */
const PARTIALS: ReadonlyArray<{ mult: number; amp: number; decay: number }> = [
    { mult: 1, amp: 1.0, decay: 3.0 },
    { mult: 2, amp: 0.45, decay: 4.5 },
    { mult: 3, amp: 0.22, decay: 6.0 },
    { mult: 4, amp: 0.12, decay: 8.0 },
    { mult: 6, amp: 0.06, decay: 11.0 },
];

let cached: DefaultVoice | null = null;

/** Synthesize the default voice once and cache it (pure + deterministic). */
export function getDefaultInstrumentVoice(): DefaultVoice {
    if (cached) return cached;

    const n = Math.floor(SAMPLE_RATE * DURATION_S);
    const pcm = new Float32Array(n);
    const twoPiOverSr = (2 * Math.PI) / SAMPLE_RATE;

    let peak = 0;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        // Soft attack ramp avoids a click at the very start of the note.
        const attack = t < ATTACK_S ? t / ATTACK_S : 1;
        let s = 0;
        for (const p of PARTIALS) {
            const env = Math.exp(-p.decay * t);
            s += p.amp * env * Math.sin(twoPiOverSr * ROOT_HZ * p.mult * i);
        }
        const v = attack * s;
        pcm[i] = v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
    }

    // Peak-normalize to ~0.9 so a single voice is healthy but leaves headroom for
    // polyphony / the engine limiter.
    if (peak > 0) {
        const g = 0.9 / peak;
        for (let i = 0; i < n; i++) pcm[i] *= g;
    }

    cached = { pcm, sampleRate: SAMPLE_RATE, rootNote: ROOT_NOTE };
    return cached;
}
