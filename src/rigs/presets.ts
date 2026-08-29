/**
 * The three preset rigs, built from REAL registered node types.
 *
 * Every voice here is synthesised by the engine from a catalogue id — there are
 * no bundled sample assets in the repo, so a rig that leaned on the Sampler
 * would install a node that makes no sound until the player finds a WAV. That
 * would be a lie told in the first ten seconds. The beat rig therefore uses an
 * `instrument` on a percussion voice (`gm-synth-drum`), which is a real kernel
 * voice with no asset, exactly like "First Light"'s drum track.
 *
 * Density is the persona's, and it is expressed in REAL nodes rather than hidden
 * controls: a beginner gets the shortest chain that makes the promised sound, a
 * pro gets the extra stages worth reaching for.
 */

import type { Persona } from '../store/onboardingStore';
import type { RigNode, RigSpec, RigWire } from './types';

/** The keyboard's three rows all reach the instrument — "press the keys" is literal. */
const KEY_ROWS = ['Row 1', 'Row 2', 'Row 3'] as const;

/**
 * Horizontal pitch between stages. Nodes are wider than their registry
 * `dimensions` once their faceplate is on (an instrument grows three key bundles,
 * an `ui: 'auto'` node renders a 220px dial panel), so the rigs lay out on a pitch
 * that clears the widest of them rather than on the declared numbers.
 */
const STAGE_PITCH = 265;

function keyboardWires(keyboardRef: string, instrumentRef: string): RigWire[] {
    // Three control cables into the instrument's bundle input — the same gesture
    // as dragging Row 1, 2 and 3 across by hand, and the same result: the
    // instrument's panel expands into three named key bundles.
    return KEY_ROWS.map((row) => ({ from: `${keyboardRef}:${row}`, to: instrumentRef, signal: 'control' as const }));
}

/**
 * Jam — "a warm playable synth with space on it."
 * keyboard -> instrument (electric piano) -> delay -> speaker.
 * The effect is a DELAY, not the registry's default distortion: the promise is
 * space, and a beginner's first sound should not be a fuzz box.
 */
function jamRig(persona: Persona): RigSpec {
    const pro = persona === 'pro';
    const nodes: RigNode[] = [
        { ref: 'keys', type: 'keyboard', position: { x: 40, y: 120 } },
        {
            ref: 'inst',
            type: 'instrument',
            position: { x: 320, y: 150 },
            data: { instrumentId: 'gm-electric-piano-1' },
        },
        {
            ref: 'space',
            type: 'effect',
            position: { x: 590, y: 160 },
            data: { effectType: 'delay', params: { time: 0.3, feedback: 0.34, mix: 0.28 } },
        },
        { ref: 'out', type: 'speaker', position: { x: 830, y: 150 } },
    ];
    const wires: RigWire[] = [
        ...keyboardWires('keys', 'inst'),
        { from: 'inst', to: 'space' },
        { from: 'space', to: 'out' },
    ];

    // A pro gets the stereo stage worth having: the delay lands in a field, not
    // a point. Its `width` knob is a real AutoParamPanel control.
    if (pro) {
        nodes.splice(3, 0, { ref: 'wide', type: 'width', position: { x: 830, y: 165 }, data: { width: 1.4 } });
        nodes[4]!.position = { x: 830 + STAGE_PITCH, y: 150 };
        wires[wires.length - 1] = { from: 'space', to: 'wide' };
        wires.push({ from: 'wide', to: 'out' });
    }

    return {
        id: 'jam',
        label: 'Jam rig',
        blurb: 'An electric piano with a delay on it. Press Q–P, A–L or Z–/ to play.',
        nodes,
        wires,
    };
}

/**
 * Beat — "drums and an 8-step groove, running."
 * keyboard -> instrument (synth drum) -> speaker for the hands, plus a Song
 * whose looping 8-step clip is what actually runs. The loop is a real
 * arrangement on the real transport, never a `setInterval` pretending to be one.
 */
function beatRig(persona: Persona): RigSpec {
    const pro = persona === 'pro';
    const nodes: RigNode[] = [
        { ref: 'pads', type: 'keyboard', position: { x: 40, y: 120 } },
        {
            ref: 'kit',
            type: 'instrument',
            position: { x: 320, y: 150 },
            data: { instrumentId: 'gm-synth-drum' },
        },
        {
            ref: 'room',
            type: 'effect',
            position: { x: 590, y: 160 },
            data: { effectType: 'reverb', params: { mix: 0.22 } },
        },
        { ref: 'out', type: 'speaker', position: { x: 830, y: 150 } },
        // Centred below the chain, clear of the instrument (three key bundles
        // make that node grow) and of both bottom corners, where the beginner's
        // hint and the shortcut card live. A Song nobody can find is no Song.
        { ref: 'song', type: 'song', position: { x: 600, y: 500 } },
    ];
    const wires: RigWire[] = [
        ...keyboardWires('pads', 'kit'),
        { from: 'kit', to: 'room' },
        { from: 'room', to: 'out' },
    ];

    if (pro) {
        nodes.splice(3, 0, { ref: 'wide', type: 'width', position: { x: 830, y: 168 }, data: { width: 1.3 } });
        nodes[4]!.position = { x: 830 + STAGE_PITCH, y: 150 };
        wires[wires.length - 1] = { from: 'room', to: 'wide' };
        wires.push({ from: 'wide', to: 'out' });
    }

    return {
        id: 'beat',
        label: 'Beat rig',
        blurb: 'An 8-step groove already looping, with the kit under your fingers.',
        nodes,
        wires,
        song: 'beat-loop',
    };
}

/**
 * Sound design — "an oscillator, a filter, knobs to sculpt."
 *
 * HONEST DEVIATION: there is no standalone oscillator or filter NODE in the
 * registry (they are DSP, and DSP is plugin territory — see the master plan's
 * owner flag). The rig is expressed with what really exists: a sustaining voice
 * into the `filter` effect, whose cutoff and Q are the sculpting controls, plus
 * a `pan` stage whose single parameter renders as a real Knob. A beginner is
 * spared the pan stage; a pro also gets stereo width.
 */
function soundRig(persona: Persona): RigSpec {
    const beginner = persona === 'first';
    const pro = persona === 'pro';

    const nodes: RigNode[] = [
        { ref: 'keys', type: 'keyboard', position: { x: 40, y: 120 } },
        {
            ref: 'osc',
            type: 'instrument',
            position: { x: 320, y: 150 },
            data: { instrumentId: 'gm-pad-warm' },
        },
        {
            ref: 'filter',
            type: 'effect',
            position: { x: 580, y: 160 },
            data: { effectType: 'filter', params: { frequency: 900, q: 2.4 } },
        },
    ];
    const wires: RigWire[] = [
        ...keyboardWires('keys', 'osc'),
        { from: 'osc', to: 'filter' },
    ];

    let last = 'filter';
    let x = 580 + STAGE_PITCH;
    if (!beginner) {
        nodes.push({ ref: 'pan', type: 'pan', position: { x, y: 168 }, data: { pan: -0.25 } });
        wires.push({ from: last, to: 'pan' });
        last = 'pan';
        x += STAGE_PITCH;
    }
    if (pro) {
        nodes.push({ ref: 'wide', type: 'width', position: { x, y: 168 }, data: { width: 1.5 } });
        wires.push({ from: last, to: 'wide' });
        last = 'wide';
        x += STAGE_PITCH;
    }
    nodes.push({ ref: 'out', type: 'speaker', position: { x, y: 150 } });
    wires.push({ from: last, to: 'out' });

    return {
        id: 'sound',
        label: 'Sound design rig',
        blurb: 'A warm pad through a filter. Turn the knobs while you hold a key.',
        nodes,
        wires,
    };
}

/** Build the rig for a goal at a persona's density. */
export function rigFor(goal: RigSpec['id'], persona: Persona): RigSpec {
    if (goal === 'beat') return beatRig(persona);
    if (goal === 'sound') return soundRig(persona);
    return jamRig(persona);
}

/** The label shown in the topbar's project chip after a rig is installed. */
export const RIG_LABEL: Record<RigSpec['id'], string> = {
    jam: 'Jam rig',
    beat: 'Beat rig',
    sound: 'Sound design rig',
};
