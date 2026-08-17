// "First Light" — Wave 9a's end-to-end song proof. The graph is the fixed routing
// substrate; all editable timeline data is authored with the public Verb API.
import { arpeggiate, euclid } from '../../music/euclid';
import { diatonicChord, triad } from '../../music/chord';
import { degreeToMidi, scaleNotes } from '../../music/scale';
import { INSTRUMENT_DEFINITIONS, type InstrumentCategory } from '../../audio/instrumentCatalog';
import { outputStageRefs } from '../automation';
import { normalizeArrangement } from '../normalize';
import type { Arrangement, ArrangementNote, MidiSource } from '../types';
import { applyVerbs, type Verb } from '../verbs';

export const FIRST_LIGHT_PPQ = 960;
export const FIRST_LIGHT_BAR = FIRST_LIGHT_PPQ * 4;
export const FIRST_LIGHT_BARS = 24;
const trackIds = ['first-light-drums', 'first-light-bass', 'first-light-keys', 'first-light-lead', 'first-light-pad'] as const;
const refs = ['drums', 'bass', 'keys', 'lead', 'pad'] as const;
const sourceIds = refs.map((ref) => `src:midi:first-light-${ref}`);

function instrument(category: InstrumentCategory, preferred: RegExp): string {
    const found = INSTRUMENT_DEFINITIONS.find((item) => item.category === category && preferred.test(item.id));
    if (!found) throw new Error(`First Light: no ${category} instrument matches ${preferred}`);
    return found.id;
}
const instruments = {
    drums: instrument('percussion', /synth-drum/), bass: instrument('bass', /electric-bass-finger/),
    keys: instrument('piano', /electric-piano-1/), lead: instrument('woodwinds', /flute$/), pad: instrument('synth', /pad-warm/),
};
const note = (tick: number, durTick: number, pitch: number, vel: number): ArrangementNote => ({ tick, durTick, pitch, vel });

function harmony(): number[][] {
    const firstThree = [0, 5, 2].map((degree) => diatonicChord(57, 'minor', degree, 1));
    const g6 = [...triad(degreeToMidi(57, 'minor', 6), 'major'), degreeToMidi(57, 'minor', 4)];
    return [...firstThree, g6].map((chord) => [...chord].sort((a, b) => a - b));
}

function keysNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    const chords = harmony();
    for (let bar = 0; bar < FIRST_LIGHT_BARS; bar++) {
        const chord = chords[bar % 4]!;
        const start = bar * FIRST_LIGHT_BAR;
        const voiced = arpeggiate(chord, 4, bar % 2 ? 'downup' : 'up');
        for (let voice = 0; voice < 4; voice++) notes.push(note(start, FIRST_LIGHT_PPQ * 3, voiced[voice]!, 52 + ((bar + voice * 3) % 15)));
        notes.push(note(start + FIRST_LIGHT_PPQ * 2.5, FIRST_LIGHT_PPQ * 1.5, chord.at(-1)! + (bar % 2 ? 0 : 12), 58 + (bar % 8)));
    }
    return notes;
}

function drumNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    const hats = euclid(8, 8);
    for (let bar = 2; bar < FIRST_LIGHT_BARS; bar++) {
        const number = bar + 1;
        const start = bar * FIRST_LIGHT_BAR;
        if (number <= 22) {
            if (number >= 5) {
                notes.push(note(start, 180, 36, 96), note(start + 2 * FIRST_LIGHT_PPQ, 180, 36, 96));
                notes.push(note(start + FIRST_LIGHT_PPQ, 180, 38, 84), note(start + 3 * FIRST_LIGHT_PPQ, 180, 38, 84));
                if (number % 4 === 0) notes.push(note(start + 2.5 * FIRST_LIGHT_PPQ, 120, 38, 38));
                if (number === 12 || number === 20) notes.push(note(start + 3.5 * FIRST_LIGHT_PPQ, 180, 36, 70));
            }
            if (number <= 20) hats.forEach((hit, step) => {
                if (hit) notes.push(note(start + step * FIRST_LIGHT_PPQ / 2, 120, number % 2 === 0 && step === 5 ? 46 : 42, number % 2 === 0 && step === 5 ? 74 : step % 2 ? 42 : 58));
            });
        } else if (number === 23) notes.push(note(start, 180, 36, 96));
    }
    return notes;
}

function bassNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    const degrees = [0, 5, 2, 6] as const;
    for (let bar = 4; bar < FIRST_LIGHT_BARS; bar++) {
        const start = bar * FIRST_LIGHT_BAR;
        const root = degreeToMidi(33, 'minor', degrees[bar % 4]!);
        if (bar >= 20) notes.push(note(start, FIRST_LIGHT_BAR, root, 78));
        else {
            notes.push(note(start, FIRST_LIGHT_PPQ * 2, root, 78), note(start + 2 * FIRST_LIGHT_PPQ, FIRST_LIGHT_PPQ, root + 7, 64));
            notes.push(note(start + 3.5 * FIRST_LIGHT_PPQ, FIRST_LIGHT_PPQ / 2, root + 12, 58));
        }
    }
    return notes;
}

function leadNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    const pent = scaleNotes(69, 'minorPentatonic', 10);
    const p = (index: number) => pent[index]!;
    const ninth = degreeToMidi(69, 'minor', 8);
    const phrases = [
        [[0, 0, 720, p(1), 60], [0, 960, 960, p(2), 66], [0, 2160, 720, p(3), 70], [0, 3360, 240, p(2), 62]],
        [[1, 240, 720, p(1), 64], [1, 1200, 960, p(0), 60], [1, 2640, 720, p(2), 68]],
        [[2, 0, 720, p(2), 68], [2, 960, 960, p(3), 72], [2, 2160, 720, ninth, 75], [2, 3360, 240, p(3), 68]],
        [[3, 240, 720, p(2), 66], [3, 1200, 960, p(1), 64], [3, 2640, 720, p(0), 62]],
        [[4, 0, 240, p(3), 74], [4, 960, 960, p(5), 84], [4, 2160, 720, ninth, 78], [4, 3120, 720, p(3), 72]],
        [[5, 240, 720, p(2), 70], [5, 1200, 960, p(1), 66], [5, 2640, 720, p(0), 62]],
        [[6, 0, 720, p(1), 68], [6, 960, 960, p(2), 72], [6, 2400, 720, p(3), 74]],
        [[7, 240, 720, p(2), 68], [7, 1200, 960, p(1), 64], [7, 2640, 960, p(0), 60]],
    ] as const;
    for (const phrase of phrases) for (const [bar, tick, duration, pitch, velocity] of phrase) notes.push(note((12 + bar) * FIRST_LIGHT_BAR + tick, duration, pitch, velocity));
    return notes;
}

function padNotes(): ArrangementNote[] {
    const notes: ArrangementNote[] = [];
    const add9 = [...diatonicChord(57, 'minor', 0), degreeToMidi(57, 'minor', 8)];
    for (let bar = 16; bar < FIRST_LIGHT_BARS; bar++) for (const pitch of add9) notes.push(note(bar * FIRST_LIGHT_BAR, FIRST_LIGHT_BAR, pitch, 40));
    notes.push(note(22 * FIRST_LIGHT_BAR, 2 * FIRST_LIGHT_BAR, 45, 40));
    return notes;
}

const source = (id: string, name: string, notes: ArrangementNote[]): MidiSource => ({ id, kind: 'midi', name, notes, lengthTick: FIRST_LIGHT_BARS * FIRST_LIGHT_BAR });
function gainLane(ref: string, id: string, base: number, extra: { tick: number; value: number }[] = []): Verb {
    return { kind: 'addAutomationLane', trackId: id, index: 0, lane: { id: `${id}-gain`, ref: outputStageRefs({ id, ref }).gain, param: 0, state: 'Play', interp: 'Linear', points: [
        ...extra, { tick: 20 * FIRST_LIGHT_BAR, value: base }, { tick: 23 * FIRST_LIGHT_BAR, value: base - 1.5 },
        { tick: 23.75 * FIRST_LIGHT_BAR, value: base - 6 }, { tick: 24 * FIRST_LIGHT_BAR, value: -60 },
    ] } };
}

export function buildFirstLight(apply: typeof applyVerbs = applyVerbs): Arrangement {
    const seed: Arrangement = { name: 'First Light', tempoBpm: 120, ppq: FIRST_LIGHT_PPQ, timeSignature: [4, 4], sampleRate: 48_000, blockSize: 256,
        // The catalogue ids are the live/UI timbres. The render CLI has no executor
        // to bind its generated PCM voice bank, so this proof opts into the existing
        // asset-free physical model while preserving those family bindings.
        graph: { nodes: [...refs.map((ref) => ({ ref, type: 'instrument', data: { instrumentId: instruments[ref], physicalModelFallback: true } })), { ref: 'master', type: 'speaker' }], connections: refs.map((ref) => ({ from: ref, to: 'master' })) }, tracks: [] };
    const noteSets = [drumNotes(), bassNotes(), keysNotes(), leadNotes(), padNotes()];
    const verbs: Verb[] = [{ kind: 'setTempo', tempoBpm: 84 }];
    for (let index = 0; index < refs.length; index++) verbs.push(
        { kind: 'addSource', source: source(sourceIds[index]!, refs[index]!, noteSets[index]!) },
        { kind: 'addTrack', index, track: { id: trackIds[index], name: ['Drums', 'Bass', 'Keys', 'Lead', 'Pad'][index], ref: refs[index]!, clips: [] } },
        { kind: 'addClip', trackId: trackIds[index]!, clip: { id: `${trackIds[index]}-clip`, sourceId: sourceIds[index]!, startTick: 0, lengthTick: FIRST_LIGHT_BARS * FIRST_LIGHT_BAR } },
    );
    // The requested staging (-4/-6/-8/-7/-12 dB) rendered at -8.11 dBFS on the
    // first native proof. Preserve its balances and lift every track by 5.7 dB.
    const gains = [1.7, -0.3, -2.3, -1.3, -6.3] as const;
    const pans = [0, 0, -0.18, 0.12, 0] as const;
    for (let index = 0; index < trackIds.length; index++) verbs.push(
        { kind: 'setTrackGain', trackId: trackIds[index]!, gainDb: gains[index]! }, { kind: 'setTrackPan', trackId: trackIds[index]!, pan: pans[index]! },
    );
    verbs.push(
        gainLane('drums', trackIds[0], gains[0]), gainLane('bass', trackIds[1], gains[1]),
        gainLane('keys', trackIds[2], gains[2], [{ tick: 12 * FIRST_LIGHT_BAR, value: -2.3 }, { tick: 14 * FIRST_LIGHT_BAR, value: -0.8 }, { tick: 16 * FIRST_LIGHT_BAR, value: -2.3 }]),
        gainLane('lead', trackIds[3], gains[3]), gainLane('pad', trackIds[4], gains[4]),
        { kind: 'addAutomationLane', trackId: trackIds[3], index: 1, lane: { id: 'first-light-lead-pan', ref: outputStageRefs({ id: trackIds[3], ref: 'lead' }).pan, param: 0, state: 'Play', interp: 'Linear', points: [
            { tick: 16 * FIRST_LIGHT_BAR, value: 0.12 }, { tick: 20 * FIRST_LIGHT_BAR, value: -0.08 },
        ] } },
    );
    const sections: readonly (readonly [string, number, number])[] = [['Intro', 0, 4], ['Groove', 4, 12], ['Lift', 12, 20], ['Outro', 20, 24]];
    for (const [index, [name, start, end]] of sections.entries()) verbs.push(
        { kind: 'addLocation', index, location: { id: `first-light-${name.toLowerCase()}`, name, kind: 'section', startTick: start * FIRST_LIGHT_BAR, endTick: end * FIRST_LIGHT_BAR } },
    );
    verbs.push({ kind: 'addLocation', index: 4, location: { id: 'first-light-peak', name: 'peak', kind: 'mark', startTick: 16 * FIRST_LIGHT_BAR } });
    return normalizeArrangement(apply(seed, verbs).next);
}

export default buildFirstLight;
