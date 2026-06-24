// src/song/songs/paperSketch.ts — "Paper Sketch No. 1", authored entirely through
// the timeline feature (an Arrangement) using the pure src/music library, never
// hand-rolled MIDI. A lofi/downtempo loop in A minor, 84 BPM, ~4 sections built by
// when each track's clip ENTERS (intro keys -> +bass -> +lead lift -> outro). All
// voices are Karplus (plucked guitar/bass) so they make real sound headless with
// zero bundled assets.

import { degreeToMidi } from '../../music/scale';
import { diatonicChord } from '../../music/chord';
import { arpeggiate } from '../../music/euclid';
import type { Arrangement, ArrangementClip, ArrangementNote, ArrangementTrack } from '../types';

const PPQ = 960;
const BAR = PPQ * 4; // 4/4
const EIGHTH = BAR / 8;

const CHORD_ROOT = 57; // A3 — the chord-voicing register
const BASS_ROOT = 45; // A2 — the bass register
const LEAD_ROOT = 69; // A4 — the lead register

// i – VI – III – VII (Am – F – C – G): the classic lofi loop, as A-minor scale degrees.
const PROG = [0, 5, 2, 6] as const;
const BARS = 16;

/** A pentatonic motif (relative scale degrees) for the lift-section lead. */
const LEAD_MOTIF = [0, 2, 1, 4, 2, 1, 0, -1] as const;

export function buildPaperSketch(): Arrangement {
    const chordNotes: ArrangementNote[] = [];
    const bassNotes: ArrangementNote[] = [];
    const leadNotes: ArrangementNote[] = [];

    for (let bar = 0; bar < BARS; bar++) {
        const deg = PROG[bar % PROG.length]!;
        const barStart = bar * BAR;

        // Chords (whole song): a gentle ascending nylon arpeggio, 8 eighth-notes/bar.
        const chord = diatonicChord(CHORD_ROOT, 'minor', deg);
        const arp = arpeggiate(chord, 8, 'up');
        for (let i = 0; i < 8; i++) {
            chordNotes.push({ tick: barStart + i * EIGHTH, durTick: EIGHTH, pitch: arp[i]!, vel: 64 });
        }

        // Bass (enters bar 2): the chord root in the bass register, two half-notes/bar.
        if (bar >= 2) {
            const bassPitch = degreeToMidi(BASS_ROOT, 'minor', deg);
            bassNotes.push({ tick: barStart, durTick: BAR / 2, pitch: bassPitch, vel: 90 });
            bassNotes.push({ tick: barStart + BAR / 2, durTick: BAR / 2, pitch: bassPitch, vel: 78 });
        }

        // Lead (enters the lift, bars 8–13): the pentatonic motif, one note per beat.
        if (bar >= 8 && bar < 14) {
            for (let i = 0; i < LEAD_MOTIF.length; i++) {
                const pitch = degreeToMidi(LEAD_ROOT, 'minorPentatonic', LEAD_MOTIF[i]! + deg);
                leadNotes.push({ tick: barStart + i * (BAR / 8), durTick: BAR / 8, pitch, vel: 72 });
            }
        }
    }

    const clip = (start: number, notes: ArrangementNote[]): ArrangementClip[] =>
        notes.length ? [{ startTick: start, notes: notes.map((n) => ({ ...n, tick: n.tick - start })) }] : [];

    // The "lift": a stepped sweep that opens the lowpass on the chords through the
    // lift section and settles it back for the outro — automation on the Biquad
    // frequency (param id 1), lowered to stepped setParam events that ride the
    // engine's per-sample smoother.
    const filterSweep = [
        { tick: 0, value: 900 },
        { tick: 8 * BAR, value: 700 },
        { tick: 10 * BAR, value: 3400 },
        { tick: 12 * BAR, value: 1800 },
        { tick: 14 * BAR, value: 1100 },
    ];

    const tracks: ArrangementTrack[] = [
        {
            name: 'Nylon Chords',
            ref: 'chords',
            clips: clip(0, chordNotes),
            automation: [{ ref: 'lpfChords', param: 1, points: filterSweep }],
        },
        { name: 'Bass', ref: 'bass', clips: clip(2 * BAR, bassNotes) },
        { name: 'Lead', ref: 'lead', clips: clip(8 * BAR, leadNotes) },
    ];

    return {
        name: 'Paper Sketch No. 1',
        tempoBpm: 84,
        ppq: PPQ,
        timeSignature: [4, 4],
        sampleRate: 48_000,
        blockSize: 256,
        sections: [
            { name: 'Intro', startBar: 1 },
            { name: 'Groove', startBar: 3 },
            { name: 'Lift', startBar: 9 },
            { name: 'Outro', startBar: 15 },
        ],
        graph: {
            nodes: [
                { ref: 'chords', type: 'instrument', data: { instrumentId: 'karplus-nylon' } },
                { ref: 'bass', type: 'instrument', data: { instrumentId: 'gm-electric-bass-finger' } },
                { ref: 'lead', type: 'instrument', data: { instrumentId: 'karplus-electric' } },
                // A warm lowpass on the chords (the filter-sweep target); a delay for
                // space on the lead; per-voice pan so the mix is genuinely stereo.
                { ref: 'lpfChords', type: 'effect', data: { effectType: 'filter', params: { q: 0.8 } } },
                { ref: 'delayLead', type: 'effect', data: { effectType: 'delay' } },
                { ref: 'panChords', type: 'pan', data: { pan: -0.35 } },
                { ref: 'panLead', type: 'pan', data: { pan: 0.4 } },
                { ref: 'spk', type: 'speaker' },
            ],
            connections: [
                { from: 'chords', to: 'lpfChords' },
                { from: 'lpfChords', to: 'panChords' },
                { from: 'panChords', to: 'spk' },
                { from: 'bass', to: 'spk' },
                { from: 'lead', to: 'delayLead' },
                { from: 'delayLead', to: 'panLead' },
                { from: 'panLead', to: 'spk' },
            ],
        },
        tracks,
        // The agent's OWN instrument: a lofi bass saturator it authored in faust,
        // spliced onto the bass (bass -> saturator -> speaker). Drives + soft-clips
        // for warmth; the engine's OutputGuard wraps it.
        codeNodes: [
            {
                id: 'ai.wasm.lofi-bass-sat',
                onTrack: 'bass',
                faustSource: 'process = max(-0.6, min(0.6, _ * 2.5));',
            },
        ],
    };
}
