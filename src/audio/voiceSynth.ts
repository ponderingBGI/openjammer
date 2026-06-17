/**
 * Procedural voice engine — a distinct, characterful tone for EVERY instrument
 * in the picker, with zero sample assets.
 *
 * OpenJammer's melodic instrument nodes lower to the engine's `builtin.sampler`,
 * which is silent until PCM is bound (the repo ships no samples). Rather than
 * leave 171 catalogue entries either silent or all sharing one tone, we
 * SYNTHESIZE a recognizable mono one-shot per instrument FAMILY here — a struck
 * string for pianos, a bowed saw for strings, a reedy buzz for saxes, a metallic
 * ring for mallets, drawbar harmonics for organs, and so on. The engine sampler
 * pitch-shifts the one-shot across the keyboard (`2^((note-root)/12)`) and its
 * ADSR release fades it on note-off, so one C4 render plays the whole range.
 *
 * Everything here is PURE + DETERMINISTIC (seeded noise), so it is unit-testable
 * and identical every run. A user who brings their own sample / SoundFont /
 * plugin simply overrides the synthesized voice — this is the floor, not the
 * ceiling.
 */

/** A decoded mono voice ready to lower into the engine sampler. */
export interface SynthVoice {
    /** Mono PCM, peak-normalized to ~0.9. */
    pcm: Float32Array;
    /** Sample rate of {@link pcm} (the engine SR-corrects on load). */
    sampleRate: number;
    /** The MIDI note the sample is recorded at (C4) — the sampler's unity pitch. */
    rootNote: number;
}

/** The timbre families every selectable instrument maps onto. */
export type VoiceFamily =
    | 'keys'
    | 'piano'
    | 'epiano'
    | 'organ'
    | 'mallet'
    | 'bell'
    | 'pluck'
    | 'bass'
    | 'strings'
    | 'brass'
    | 'reed'
    | 'flute'
    | 'lead'
    | 'pad'
    | 'percussion'
    | 'world';

/** One partial in the additive series. */
interface Partial {
    /** Frequency = rootHz * mult (before inharmonic stretch). */
    mult: number;
    /** Linear amplitude. */
    amp: number;
    /** Exponential decay rate (1/s). 0 = sustained (uses the global envelope). */
    decay: number;
}

/** A recipe for one family's tone. */
interface VoiceSpec {
    /** One-shot length, seconds. */
    durationS: number;
    /** Click-free attack ramp, seconds (longer for bowed/pad). */
    attackS: number;
    /** The harmonic series. */
    partials: Partial[];
    /** Partial freq *= 1 + inharmonicity * mult^2 (piano/bell metallic stretch). */
    inharmonicity?: number;
    /** Pitch-LFO rate (Hz) + depth (fractional) — strings/brass/reed/flute. */
    vibratoHz?: number;
    vibratoDepth?: number;
    /** Amp-LFO rate (Hz) + depth (0..1) — organ/epiano/vibraphone. */
    tremoloHz?: number;
    tremoloDepth?: number;
    /** Breath/bow noise mixed under the tone (0..1) — flute/sax/strings. */
    noise?: number;
    /** Sustained families: release tail length, seconds (the rest holds flat). */
    releaseS?: number;
}

// C4 in MIDI + Hz (the sample's recorded pitch / unity playback note).
const ROOT_NOTE = 60;
const ROOT_HZ = 261.6256;
/** 24 kHz keeps the IPC payload small; the sampler SR-corrects on load. */
const SAMPLE_RATE = 24000;

/**
 * The family recipes. Tuned by ear-modelling: pianos are inharmonic struck
 * strings, organs are flat drawbar stacks, strings are bowed saws with vibrato,
 * reeds buzz on odd harmonics with breath, mallets ring metallically, etc.
 */
const FAMILY_SPECS: Record<VoiceFamily, VoiceSpec> = {
    // Warm additive bell/e-piano hybrid — the original default voice.
    keys: {
        durationS: 1.6,
        attackS: 0.004,
        partials: [
            { mult: 1, amp: 1.0, decay: 3.0 },
            { mult: 2, amp: 0.45, decay: 4.5 },
            { mult: 3, amp: 0.22, decay: 6.0 },
            { mult: 4, amp: 0.12, decay: 8.0 },
            { mult: 6, amp: 0.06, decay: 11.0 },
        ],
    },
    // Acoustic piano: bright struck onset, inharmonic partials, medium-long decay.
    piano: {
        durationS: 2.0,
        attackS: 0.003,
        inharmonicity: 0.0008,
        partials: [
            { mult: 1, amp: 1.0, decay: 1.6 },
            { mult: 2, amp: 0.6, decay: 2.4 },
            { mult: 3, amp: 0.4, decay: 3.2 },
            { mult: 4, amp: 0.26, decay: 4.0 },
            { mult: 5, amp: 0.16, decay: 5.0 },
            { mult: 6, amp: 0.1, decay: 6.5 },
            { mult: 8, amp: 0.05, decay: 9.0 },
        ],
    },
    // Electric piano (Rhodes/Wurli): fundamental + bell tine, gentle tremolo.
    epiano: {
        durationS: 1.8,
        attackS: 0.004,
        tremoloHz: 5.0,
        tremoloDepth: 0.18,
        partials: [
            { mult: 1, amp: 1.0, decay: 2.2 },
            { mult: 2, amp: 0.3, decay: 3.5 },
            { mult: 4, amp: 0.5, decay: 5.5 }, // the characteristic bell tine
            { mult: 5, amp: 0.12, decay: 7.0 },
        ],
    },
    // Drawbar organ: flat-sustained harmonic stack, fast attack, faint tremolo.
    organ: {
        durationS: 1.8,
        attackS: 0.006,
        releaseS: 0.12,
        tremoloHz: 6.5,
        tremoloDepth: 0.08,
        partials: [
            { mult: 0.5, amp: 0.3, decay: 0 },
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 2, amp: 0.7, decay: 0 },
            { mult: 3, amp: 0.5, decay: 0 },
            { mult: 4, amp: 0.4, decay: 0 },
            { mult: 6, amp: 0.25, decay: 0 },
            { mult: 8, amp: 0.18, decay: 0 },
        ],
    },
    // Mallet (vibraphone/marimba): metallic inharmonic ring, quick decay, tremolo.
    mallet: {
        durationS: 1.6,
        attackS: 0.002,
        inharmonicity: 0.004,
        tremoloHz: 5.5,
        tremoloDepth: 0.25,
        partials: [
            { mult: 1, amp: 1.0, decay: 3.0 },
            { mult: 4, amp: 0.5, decay: 5.0 },
            { mult: 10, amp: 0.18, decay: 8.0 },
        ],
    },
    // Bell (tubular/celesta/glockenspiel): strong inharmonic high partials, long ring.
    bell: {
        durationS: 2.4,
        attackS: 0.002,
        inharmonicity: 0.006,
        partials: [
            { mult: 1, amp: 0.7, decay: 1.2 },
            { mult: 2.76, amp: 1.0, decay: 1.6 },
            { mult: 5.4, amp: 0.5, decay: 2.4 },
            { mult: 8.9, amp: 0.25, decay: 3.5 },
        ],
    },
    // Plucked string (guitar/harp/dulcimer): rich bright onset, fast-ish decay.
    pluck: {
        durationS: 1.8,
        attackS: 0.002,
        partials: [
            { mult: 1, amp: 1.0, decay: 2.6 },
            { mult: 2, amp: 0.7, decay: 3.4 },
            { mult: 3, amp: 0.5, decay: 4.4 },
            { mult: 4, amp: 0.35, decay: 5.6 },
            { mult: 5, amp: 0.22, decay: 7.0 },
            { mult: 6, amp: 0.14, decay: 9.0 },
        ],
    },
    // Bass: strong fundamental, dark, medium decay.
    bass: {
        durationS: 1.8,
        attackS: 0.004,
        partials: [
            { mult: 1, amp: 1.0, decay: 2.0 },
            { mult: 2, amp: 0.5, decay: 3.0 },
            { mult: 3, amp: 0.22, decay: 4.5 },
            { mult: 4, amp: 0.1, decay: 6.0 },
        ],
    },
    // Bowed strings (violin/cello/ensemble): sustained saw, vibrato, bow noise, slow swell.
    strings: {
        durationS: 2.2,
        attackS: 0.06,
        releaseS: 0.18,
        vibratoHz: 5.2,
        vibratoDepth: 0.006,
        noise: 0.04,
        partials: [
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 2, amp: 0.6, decay: 0 },
            { mult: 3, amp: 0.45, decay: 0 },
            { mult: 4, amp: 0.32, decay: 0 },
            { mult: 5, amp: 0.24, decay: 0 },
            { mult: 6, amp: 0.18, decay: 0 },
            { mult: 7, amp: 0.12, decay: 0 },
        ],
    },
    // Brass (trumpet/trombone/horn/tuba): bright rising harmonics, sustained, light vibrato.
    brass: {
        durationS: 2.0,
        attackS: 0.03,
        releaseS: 0.14,
        vibratoHz: 5.0,
        vibratoDepth: 0.004,
        partials: [
            { mult: 1, amp: 0.8, decay: 0 },
            { mult: 2, amp: 1.0, decay: 0 },
            { mult: 3, amp: 0.8, decay: 0 },
            { mult: 4, amp: 0.6, decay: 0 },
            { mult: 5, amp: 0.4, decay: 0 },
            { mult: 6, amp: 0.25, decay: 0 },
        ],
    },
    // Reed (sax/clarinet/oboe): odd-harmonic buzz, sustained, vibrato + breath.
    reed: {
        durationS: 2.0,
        attackS: 0.02,
        releaseS: 0.14,
        vibratoHz: 5.4,
        vibratoDepth: 0.005,
        noise: 0.05,
        partials: [
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 3, amp: 0.6, decay: 0 },
            { mult: 5, amp: 0.4, decay: 0 },
            { mult: 7, amp: 0.22, decay: 0 },
            { mult: 9, amp: 0.12, decay: 0 },
        ],
    },
    // Flute/whistle: nearly a sine + octave, lots of breath, vibrato.
    flute: {
        durationS: 1.9,
        attackS: 0.04,
        releaseS: 0.12,
        vibratoHz: 5.6,
        vibratoDepth: 0.006,
        noise: 0.12,
        partials: [
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 2, amp: 0.25, decay: 0 },
            { mult: 3, amp: 0.08, decay: 0 },
        ],
    },
    // Synth lead: bright saw, sustained.
    lead: {
        durationS: 1.8,
        attackS: 0.008,
        releaseS: 0.1,
        partials: [
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 2, amp: 0.5, decay: 0 },
            { mult: 3, amp: 0.33, decay: 0 },
            { mult: 4, amp: 0.25, decay: 0 },
            { mult: 5, amp: 0.2, decay: 0 },
            { mult: 6, amp: 0.16, decay: 0 },
            { mult: 7, amp: 0.13, decay: 0 },
        ],
    },
    // Synth pad / choir: soft, detuned, slow bloom, sustained.
    pad: {
        durationS: 2.4,
        attackS: 0.18,
        releaseS: 0.3,
        vibratoHz: 0.6,
        vibratoDepth: 0.004,
        partials: [
            { mult: 1, amp: 1.0, decay: 0 },
            { mult: 2, amp: 0.5, decay: 0 },
            { mult: 2.01, amp: 0.4, decay: 0 }, // detune shimmer
            { mult: 3, amp: 0.3, decay: 0 },
            { mult: 4, amp: 0.18, decay: 0 },
        ],
    },
    // Percussion (untuned-ish): noise burst + short tonal thud, very fast decay.
    percussion: {
        durationS: 0.9,
        attackS: 0.001,
        noise: 0.6,
        partials: [
            { mult: 1, amp: 1.0, decay: 16.0 },
            { mult: 2.4, amp: 0.4, decay: 22.0 },
        ],
    },
    // World / fallback: a bright plucked-struck hybrid.
    world: {
        durationS: 1.8,
        attackS: 0.003,
        partials: [
            { mult: 1, amp: 1.0, decay: 3.0 },
            { mult: 2, amp: 0.6, decay: 4.0 },
            { mult: 3, amp: 0.35, decay: 5.5 },
            { mult: 5, amp: 0.16, decay: 8.0 },
        ],
    },
};

// ---------------------------------------------------------------------------
// instrumentId / name -> family resolution
// ---------------------------------------------------------------------------

/** Keyword → family rules, checked in order against a lowercased id+name. */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [RegExp, VoiceFamily]> = [
    [/electric[ -]?piano|rhodes|wurli|\bep\b/, 'epiano'],
    [/organ|accordion|harmonica|harmonium/, 'organ'],
    [/harpsichord|clavinet|clavi/, 'pluck'],
    [/vibraphone|marimba|xylophone|glockenspiel|kalimba|steel ?drum|timpani|celesta|music box/, 'mallet'],
    [/bell|tubular|chime/, 'bell'],
    [/\bkeys\b/, 'keys'],
    [/piano|grand|honky/, 'piano'],
    [/bass/, 'bass'],
    [/guitar|harp|banjo|sitar|koto|shamisen|\blute\b|mandolin|dulcimer|pluck|pizz/, 'pluck'],
    [/violin|viola|cello|contrabass|fiddle|string|orchestra|ensemble|erhu/, 'strings'],
    [/choir|voice|vocal|aah|ooh|pad|warm|sweep|halo|atmosphere|new age/, 'pad'],
    [/trumpet|trombone|tuba|horn|brass|cornet|bugle/, 'brass'],
    [/sax|clarinet|oboe|bassoon|english horn|reed|bagpipe|shanai|duduk|wind/, 'reed'],
    [/flute|piccolo|recorder|whistle|ocarina|pan ?flute|shakuhachi|blown/, 'flute'],
    [/lead|saw|square|synth ?lead|sawtooth|chiff/, 'lead'],
    [/drum|kick|snare|tom|cymbal|hat|clap|perc|agogo|woodblock|taiko|conga|bongo|tabla/, 'percussion'],
];

/** Coarse catalogue-category → family, the fallback when no keyword matches. */
const CATEGORY_FAMILY: Record<string, VoiceFamily> = {
    piano: 'piano',
    strings: 'strings',
    woodwinds: 'reed',
    brass: 'brass',
    guitar: 'pluck',
    bass: 'bass',
    synth: 'lead',
    percussion: 'mallet',
    world: 'world',
};

/**
 * Families backed by the engine's real Karplus-Strong physical-model primitive
 * (`builtin.karplus`) rather than the additive procedural sampler: plucked
 * strings (guitars, harp, …) and basses. The emit lowers these instrument nodes
 * to `KarplusString` so the engine plucks a live, per-note string; the executors
 * skip sample-binding them (Karplus needs no PCM).
 */
const KARPLUS_FAMILIES: ReadonlySet<VoiceFamily> = new Set<VoiceFamily>(['pluck', 'bass']);

/** Whether a {@link VoiceFamily} is rendered by the real Karplus primitive. */
export function isKarplusFamily(family: VoiceFamily): boolean {
    return KARPLUS_FAMILIES.has(family);
}

/**
 * Resolve an `instrumentId` (and optional display name + catalogue category) to a
 * timbre {@link VoiceFamily}. Keyword rules win (so "Church Organ" → organ even
 * though its catalogue category is "piano"); the category is the fallback; an
 * unknown input lands on the warm default `keys`.
 */
export function resolveVoiceFamily(
    instrumentId: string | undefined,
    name?: string,
    category?: string,
): VoiceFamily {
    const hay = `${instrumentId ?? ''} ${name ?? ''}`.toLowerCase();
    for (const [re, fam] of FAMILY_KEYWORDS) {
        if (re.test(hay)) return fam;
    }
    if (category && CATEGORY_FAMILY[category]) return CATEGORY_FAMILY[category];
    return 'keys';
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** A tiny deterministic PRNG (mulberry32) so the breath/bow noise is reproducible. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** True if every partial sustains (decay 0) — drives the global release tail. */
function isSustained(spec: VoiceSpec): boolean {
    return spec.partials.some((p) => p.decay === 0);
}

/** Render one {@link VoiceSpec} to peak-normalized mono PCM. PURE + deterministic. */
function synthesize(spec: VoiceSpec, seed: number): Float32Array {
    const n = Math.floor(SAMPLE_RATE * spec.durationS);
    const pcm = new Float32Array(n);
    const dt = 1 / SAMPLE_RATE;
    const rand = mulberry32(seed);
    const sustained = isSustained(spec);
    const releaseS = spec.releaseS ?? 0.05;
    const releaseStart = spec.durationS - releaseS;

    // One-pole low-pass state for the breath/bow noise (so it is airy, not fizzy).
    let noiseLp = 0;

    let peak = 0;
    for (let i = 0; i < n; i++) {
        const t = i * dt;

        // Global amplitude envelope: attack ramp, then either a flat sustain with a
        // release tail (sustained families) or a constant 1 (plucked families let
        // their per-partial decay shape the tail).
        let genv: number;
        if (t < spec.attackS) genv = t / spec.attackS;
        else if (sustained && t > releaseStart) genv = Math.max(0, (spec.durationS - t) / releaseS);
        else genv = 1;

        // Optional tremolo (amplitude LFO).
        if (spec.tremoloHz) {
            const trem = 1 - spec.tremoloDepth! * 0.5 * (1 - Math.cos(2 * Math.PI * spec.tremoloHz * t));
            genv *= trem;
        }

        // Optional vibrato (pitch LFO) → a shared phase multiplier this sample.
        const vib = spec.vibratoHz
            ? 1 + spec.vibratoDepth! * Math.sin(2 * Math.PI * spec.vibratoHz * t)
            : 1;

        let s = 0;
        for (const p of spec.partials) {
            const stretch = spec.inharmonicity ? 1 + spec.inharmonicity * p.mult * p.mult : 1;
            const freq = ROOT_HZ * p.mult * stretch * vib;
            const penv = p.decay > 0 ? Math.exp(-p.decay * t) : 1;
            s += p.amp * penv * Math.sin(2 * Math.PI * freq * t);
        }

        if (spec.noise) {
            const white = rand() * 2 - 1;
            noiseLp += 0.25 * (white - noiseLp); // ~one-pole LP
            s += spec.noise * noiseLp;
        }

        const v = genv * s;
        pcm[i] = v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
    }

    // Peak-normalize to ~0.9 — healthy single voice, headroom for polyphony + limiter.
    if (peak > 0) {
        const g = 0.9 / peak;
        for (let i = 0; i < n; i++) pcm[i] *= g;
    }
    return pcm;
}

// Cache one rendered voice per FAMILY (12-ish renders, shared across the 171 ids).
const familyCache = new Map<VoiceFamily, SynthVoice>();

/** A stable per-family seed so the (deterministic) noise differs between families. */
function familySeed(family: VoiceFamily): number {
    let h = 2166136261;
    for (let i = 0; i < family.length; i++) {
        h ^= family.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Synthesize (and cache) the voice for a {@link VoiceFamily}. */
export function getFamilyVoice(family: VoiceFamily): SynthVoice {
    const hit = familyCache.get(family);
    if (hit) return hit;
    const voice: SynthVoice = {
        pcm: synthesize(FAMILY_SPECS[family], familySeed(family)),
        sampleRate: SAMPLE_RATE,
        rootNote: ROOT_NOTE,
    };
    familyCache.set(family, voice);
    return voice;
}

/**
 * The voice for a specific instrument selection: resolve its family, return that
 * family's (cached) synthesized one-shot. This is what the executors bind into
 * the engine sampler when an instrument node carries an `instrumentId`.
 */
export function getInstrumentVoice(
    instrumentId: string | undefined,
    name?: string,
    category?: string,
): SynthVoice {
    return getFamilyVoice(resolveVoiceFamily(instrumentId, name, category));
}

/** Test-only: clear the per-family render cache. */
export function _resetVoiceCacheForTests(): void {
    familyCache.clear();
}
