/**
 * Keyboard -> instrument note routing (U17), shared by the ojcore executors.
 *
 * The {@link Executor} note seam speaks in keyboard terms — `(keyboardId, row,
 * keyIndex, velocity)` — but the ojcore engines speak `RtCommand::NoteOn/NoteOff`
 * addressed by `(NodeIdx, midiNote, velocity)`. This pure helper bridges the two
 * by resolving keyboard rows -> instrument targets from the graph maps, so the
 * native and wasm engines compute the same MIDI note for the same key press:
 *
 *   • find the keyboard's source output port for `row` (bundle or per-row),
 *   • follow every connection from that port to an instrument/sampler target,
 *   • compute the MIDI note from the matching InstrumentRow / SamplerRow (spread,
 *     base octave/note/offset) or the per-port offsets map,
 *   • scale velocity by the per-key / per-row gain.
 *
 * Pure: depends only on the graph maps passed in (no store/audio access).
 */

import type { GraphNode, Connection, InstrumentNodeData, SamplerNodeData } from '../../engine/types';

/** Instrument node types that respond to keyboard note triggers. */
const INSTRUMENT_NODE_TYPES = new Set<string>([
    'piano',
    'cello',
    'electricCello',
    'violin',
    'saxophone',
    'strings',
    'keys',
    'winds',
    'instrument',
    'sampler',
]);

const MIN_ROW = 1;
const MAX_ROW = 3;
const MIN_KEY = 0;
const MAX_KEY = 11;

/** A resolved note to send to one instrument target. */
export interface ResolvedNote {
    /** The target instrument GraphNode id (the executor interns this -> NodeIdx). */
    targetNodeId: string;
    /** MIDI note number (0-127, C4 = 60). */
    midiNote: number;
    /** Velocity 0-1, already scaled by per-key / per-row gain. */
    velocity: number;
}

/** Convert a (noteIndexWithinOctave, octave) pair to a MIDI note (C4 = 60). */
function toMidi(noteIndex: number, octave: number): number {
    return (octave + 1) * 12 + noteIndex;
}

/**
 * Find the keyboard's source output port id for a given row, mirroring
 * `AudioGraphManager.getKeyboardSourcePort`.
 */
function keyboardSourcePort(keyboard: GraphNode, row: number): string | undefined {
    const bundle = keyboard.ports.find((p) => p.id === 'bundle-out');
    if (bundle) return 'bundle-out';
    const rowPort = keyboard.ports.find(
        (p) => p.direction === 'output' && p.name.toLowerCase().includes(`row ${row}`),
    );
    if (rowPort) return rowPort.id;
    // Hardware MIDI devices (e.g. minilab-3) expose a single composite keys-bundle
    // output (id `<panelId>:bundle-keys`, name 'Keys') rather than `bundle-out` or
    // `Row N` ports. Match it by intent so routing stays deterministic even once
    // the device also exposes pad/knob outputs — otherwise the "first output port"
    // fallback below could pick a pad/knob port and silently misroute the keys.
    const keysBundle = keyboard.ports.find(
        (p) =>
            p.direction === 'output' &&
            (p.id.endsWith(':bundle-keys') || p.name.toLowerCase().includes('keys')),
    );
    if (keysBundle) return keysBundle.id;
    return keyboard.ports.find((p) => p.direction === 'output')?.id;
}

function findInstrumentRow(data: InstrumentNodeData, sourceNodeId: string, sourcePortId: string) {
    if (!data.rows || data.rows.length === 0) return undefined;
    return data.rows.find(
        (r) =>
            r.sourceNodeId === sourceNodeId &&
            (r.sourcePortId === sourcePortId || sourcePortId.includes(r.sourcePortId)),
    );
}

function findSamplerRow(data: SamplerNodeData, sourceNodeId: string, sourcePortId: string) {
    if (!data.rows || data.rows.length === 0) return undefined;
    return data.rows.find(
        (r) =>
            r.sourceNodeId === sourceNodeId &&
            (r.sourcePortId === sourcePortId || sourcePortId.includes(r.sourcePortId)),
    );
}

/**
 * Resolve a keyboard key press into the MIDI note(s) to trigger on connected
 * instruments. Returns one {@link ResolvedNote} per connected instrument target.
 * Empty when the keyboard / row / key is out of range or unconnected.
 *
 * @param keyboardId  keyboard GraphNode id
 * @param row         1-based row (1..3)
 * @param keyIndex    0-based key within the row (0..11)
 * @param velocity    normalized 0-1 velocity
 * @param nodes       all graph nodes (flat)
 * @param connections all graph connections (flat)
 */
export function resolveKeyboardNotes(
    keyboardId: string,
    row: number,
    keyIndex: number,
    velocity: number,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>,
): ResolvedNote[] {
    if (row < MIN_ROW || row > MAX_ROW) return [];
    if (keyIndex < MIN_KEY || keyIndex > MAX_KEY) return [];

    const keyboard = nodes.get(keyboardId);
    if (!keyboard) return [];

    const vel = Math.max(0, Math.min(1, velocity));
    const rowOctaves = (keyboard.data as { rowOctaves?: number[] }).rowOctaves ?? [4, 3, 2];
    const baseOctave = rowOctaves[row - 1] ?? 4;

    const sourcePortId = keyboardSourcePort(keyboard, row);
    if (!sourcePortId) return [];

    const out: ResolvedNote[] = [];
    for (const conn of connections.values()) {
        if (conn.sourceNodeId !== keyboardId || conn.sourcePortId !== sourcePortId) continue;
        const target = nodes.get(conn.targetNodeId);
        if (!target || !INSTRUMENT_NODE_TYPES.has(target.type)) continue;

        if (target.type === 'sampler') {
            const data = target.data as SamplerNodeData;
            const samplerRow = findSamplerRow(data, keyboardId, sourcePortId);
            const rootNote = data.rootNote ?? 60;
            const pitchOffset = samplerRow ? keyIndex * (samplerRow.spread ?? 1) : keyIndex;
            const rowGain = samplerRow ? (samplerRow.gain ?? 1) : (data.gain ?? 1);
            out.push({
                targetNodeId: conn.targetNodeId,
                midiNote: Math.round(rootNote + pitchOffset),
                velocity: Math.max(0, Math.min(1, vel * rowGain)),
            });
            continue;
        }

        const data = target.data as InstrumentNodeData;
        const instRow = findInstrumentRow(data, keyboardId, sourcePortId);
        let noteIndex: number;
        let octave: number;
        let scaledVel = vel;
        if (instRow) {
            const spreadOffset = instRow.baseOffset + keyIndex * instRow.spread;
            octave = instRow.baseOctave + Math.floor(spreadOffset / 12);
            noteIndex = instRow.baseNote + (spreadOffset % 12);
            const keyGain = instRow.keyGains?.[keyIndex] ?? 1;
            scaledVel = Math.max(0, Math.min(1, vel * keyGain));
        } else {
            const semitoneOffset = data.offsets?.[conn.targetPortId] ?? 0;
            const octaveOffset = data.octaveOffsets?.[conn.targetPortId] ?? 0;
            const noteOffset = data.noteOffsets?.[conn.targetPortId] ?? 0;
            octave = baseOctave + octaveOffset;
            noteIndex = keyIndex + noteOffset + semitoneOffset;
        }
        out.push({
            targetNodeId: conn.targetNodeId,
            midiNote: Math.round(toMidi(noteIndex, octave)),
            velocity: scaledVel,
        });
    }
    return out;
}
