/**
 * MIDIVoiceRouter — control-side MIDI -> voice routing (U13).
 *
 * Turns incoming parsed MIDI events into {@link VoiceExecutor} calls by
 * resolving, against the current node graph, *which* input node a device drives
 * and *which* row/key/velocity the event maps to. This is pure control-side TS
 * resolution: it computes the address and forwards to the existing audio
 * Executor seam (`noteOn`/`noteOff`) — it is not a per-sample audio edge.
 *
 * Responsibilities:
 *  - Device -> node binding: an input node (`midi` / `minilab-3` / `keyboard`)
 *    is bound to a device via its `data.deviceId`; only connected nodes route.
 *  - Channel filtering: a node's `activeChannel` (0 = omni, 1-16 specific) gates
 *    which MIDI channels it accepts.
 *  - MiniLab 3 key-vs-pad split: pad notes (36-43, channel 10) and key notes are
 *    classified via the device preset; pads map to a dedicated pad row.
 *  - Note/velocity mapping: raw MIDI note -> (row, keyIndex) using the node's
 *    per-row octaves; raw velocity -> normalized 0-1.
 *  - Sustain pedal (CC 64) -> per-note hold: while down, note-offs are held;
 *    on release every held voice gets exactly one note-off (see
 *    {@link SustainController}). Shared with the computer-keyboard sustain key.
 *
 * Unbound devices (no input node references the device id) are a no-op.
 */

import {
    midiNoteToRowKey,
    isRowKeyInRange,
    MIN_KEY_INDEX,
    type RowKey
} from './noteMapping';
import type {
    GraphAccess,
    ResolvedVoice,
    RoutingContext,
    MIDISubscriptionLike,
    VoiceExecutor
} from './types';
import { getPresetRegistry } from '../MIDIDevicePresets';
import { SustainController } from './SustainController';
import type { GraphNode, MIDIInputNodeData } from '../../engine/types';
import type { MIDIDevicePreset, MIDIEvent, MIDINoteEvent } from '../types';

/** Sustain pedal CC number. */
const SUSTAIN_CC = 64;
/** A CC >= this threshold is treated as "engaged" (pedal down). */
const CC_ENGAGED_THRESHOLD = 64;

/** Input node types that can be bound to a MIDI device and routed. */
const MIDI_INPUT_NODE_TYPES: ReadonlySet<string> = new Set([
    'midi',
    'minilab-3',
    'keyboard'
]);

/**
 * Pads are routed to a dedicated row so they never collide with the keyboard's
 * pitched rows (rows 1-3). The executor clamps rows to 1-3, so pads map onto
 * row 1 with a chromatic key per pad. Pad index 0-7 -> keyIndex 0-7.
 */
const PAD_ROW = 1;

/** Read-side view of an input node bound to a device. */
interface BoundInputNode {
    node: GraphNode;
    data: MIDIInputNodeData;
    preset: MIDIDevicePreset | null;
}

/** Narrow node data to the MIDI input shape (deviceId / isConnected present). */
function asInputNodeData(node: GraphNode): MIDIInputNodeData | null {
    const data = node.data as Partial<MIDIInputNodeData>;
    if (typeof data.deviceId === 'undefined') return null;
    return node.data as MIDIInputNodeData;
}

/** Read per-row octaves from a node (keyboard nodes carry `rowOctaves`). */
function rowOctavesOf(node: GraphNode): readonly number[] | undefined {
    const data = node.data as { rowOctaves?: number[] };
    return Array.isArray(data.rowOctaves) ? data.rowOctaves : undefined;
}

/**
 * Does `event.channel` (0-15) pass a node's `activeChannel` filter?
 * `activeChannel` is 1-indexed (1-16) with 0 meaning omni (accept all).
 */
function channelMatches(activeChannel: number | undefined, eventChannel: number): boolean {
    if (!activeChannel || activeChannel === 0) return true; // omni
    return activeChannel - 1 === eventChannel;
}

/**
 * Classify a MiniLab 3 note event as a pad (and which pad index) using the
 * device preset. Returns the 0-based pad index, or null if it is a key.
 */
function padIndexFor(preset: MIDIDevicePreset | null, event: MIDINoteEvent): number | null {
    const pads = preset?.controls.pads;
    if (!pads || pads.length === 0) return null;
    const idx = pads.findIndex(
        // Preset pad channel is 1-indexed (e.g. 10); events are 0-indexed (9).
        (pad) => pad.note === event.note && pad.channel - 1 === event.channel
    );
    return idx >= 0 ? idx : null;
}

export class MIDIVoiceRouter {
    private readonly graph: GraphAccess;
    private readonly executor: VoiceExecutor;
    private readonly midi: RoutingContext['midi'];
    private subscription: MIDISubscriptionLike | null = null;
    /**
     * Per-note sustain state (CC64 / spacebar). Runtime control state only —
     * never persisted, never in undo history. Exposed via {@link sustain} so the
     * computer-keyboard path shares this exact mechanism.
     */
    private readonly sustainCtl = new SustainController();

    constructor(ctx: RoutingContext) {
        this.graph = ctx.graph;
        this.executor = ctx.executor;
        this.midi = ctx.midi;
    }

    /**
     * The shared per-note sustain controller. The computer-keyboard path
     * (audioStore spacebar) drives this directly so hardware CC64 and the
     * keyboard sustain key flow through one mechanism.
     */
    get sustain(): SustainController {
        return this.sustainCtl;
    }

    /**
     * Subscribe to all incoming MIDI and begin routing. Idempotent: a second
     * call is a no-op while already started.
     */
    start(): void {
        if (this.subscription) return;
        this.subscription = this.midi.subscribeAll((event) => {
            try {
                this.handleEvent(event);
            } catch (err) {
                console.error('[MIDIVoiceRouter] routing error:', err);
            }
        });
    }

    /** Tear down the subscription cleanly. Idempotent. */
    stop(): void {
        if (!this.subscription) return;
        this.subscription.unsubscribe();
        this.subscription = null;
    }

    /** Route a single parsed MIDI event. Public for direct/unit invocation. */
    handleEvent(event: MIDIEvent | null | undefined): void {
        // MIDIManager only publishes parsed events, but this is an external/control
        // boundary. Ignore malformed callbacks instead of throwing
        // "Cannot read properties of undefined (reading 'type')" mid-performance.
        if (!event || typeof (event as { type?: unknown }).type !== 'string') return;

        switch (event.type) {
            case 'noteOn':
            case 'noteOff':
                this.handleNoteEvent(event);
                break;
            case 'cc':
                this.handleCCEvent(event.deviceId, event.channel, event.controller, event.value);
                break;
            // pitchBend / aftertouch / programChange: not voice-routed (yet).
            default:
                break;
        }
    }

    private handleNoteEvent(event: MIDINoteEvent): void {
        const voices = this.resolveNoteVoices(event);
        for (const voice of voices) {
            if (event.type === 'noteOn') {
                // Re-pressing a held (sustained) note must own the voice cleanly:
                // drop any stale held entry so pedal-up never double-releases it.
                this.sustainCtl.onNoteOn(voice.nodeId, voice.row, voice.keyIndex);
                this.executor.noteOn(voice.nodeId, voice.row, voice.keyIndex, voice.velocity);
                // Light the cables leaving this input node so the player sees the
                // signal flow — parity with the computer-keyboard path
                // (audioStore.emitKeyboardSignal). A hardware device's keys map to
                // per-note ports rather than the keyboard's tidy row ports, so we
                // glow every outgoing cable: the honest "signal is flowing from
                // this device" indicator, and exactly right for the common
                // single-cable (device -> instrument) patch.
                for (const id of this.outgoingConnectionIds(voice.nodeId)) {
                    this.executor.activateControlSignal(id);
                }
            } else {
                // Pedal down -> hold the voice (suppress note-off) until flush.
                if (this.sustainCtl.onNoteOff(voice.nodeId, voice.row, voice.keyIndex)) {
                    continue;
                }
                this.executor.noteOff(voice.nodeId, voice.row, voice.keyIndex);
                for (const id of this.outgoingConnectionIds(voice.nodeId)) {
                    this.executor.releaseControlSignal(id);
                }
            }
        }
    }

    /** Ids of the connections whose source is `nodeId` (the cables it feeds). */
    private outgoingConnectionIds(nodeId: string): string[] {
        const ids: string[] = [];
        for (const conn of this.graph.getConnections().values()) {
            if (conn.sourceNodeId === nodeId) ids.push(conn.id);
        }
        return ids;
    }

    private handleCCEvent(
        deviceId: string,
        channel: number,
        controller: number,
        value: number
    ): void {
        if (controller !== SUSTAIN_CC) return; // only sustain is voice-relevant today
        const engaged = value >= CC_ENGAGED_THRESHOLD;
        for (const bound of this.boundInputNodes(deviceId)) {
            if (!channelMatches(bound.data.activeChannel, channel)) continue;
            this.applySustain(bound.node.id, engaged);
        }
    }

    /**
     * Apply a per-note sustain (damper) transition to one input node. Down arms
     * the hold; up flushes every voice held while the pedal was down, releasing
     * each exactly once. The pedal's own UI/cable glow lives in audioStore; this
     * router only emits the held note releases.
     */
    applySustain(nodeId: string, down: boolean): void {
        const released = this.sustainCtl.setPedal(nodeId, down);
        if (released.length === 0) return;
        for (const voice of released) {
            this.executor.noteOff(nodeId, voice.row, voice.keyIndex);
        }
        // Fade the input node's outgoing cables once the held voices let go,
        // mirroring the immediate-release path's signal-flow glow.
        for (const id of this.outgoingConnectionIds(nodeId)) {
            this.executor.releaseControlSignal(id);
        }
    }

    /**
     * Resolve a note event to the set of voices it should drive. Pure with
     * respect to the executor — returns decisions rather than emitting them, so
     * it is straightforward to unit-test.
     */
    resolveNoteVoices(event: MIDINoteEvent): ResolvedVoice[] {
        const voices: ResolvedVoice[] = [];
        for (const bound of this.boundInputNodes(event.deviceId)) {
            if (!channelMatches(bound.data.activeChannel, event.channel)) continue;

            const rowKey = this.resolveRowKey(bound, event);
            if (!rowKey || !isRowKeyInRange(rowKey)) continue;

            voices.push({
                nodeId: bound.node.id,
                row: rowKey.row,
                keyIndex: rowKey.keyIndex,
                velocity: event.normalizedVelocity
            });
        }
        return voices;
    }

    /**
     * Resolve a note to a (row, keyIndex) for a bound node, splitting MiniLab 3
     * pads from keys. Pads map to a dedicated pad row; keys (and generic MIDI)
     * map via the node's per-row octaves.
     */
    private resolveRowKey(bound: BoundInputNode, event: MIDINoteEvent): RowKey | null {
        // MiniLab 3 (and any preset with pads): split pads from keys.
        if (bound.node.type === 'minilab-3' || bound.preset?.controls.pads) {
            const padIndex = padIndexFor(bound.preset, event);
            if (padIndex !== null) {
                return { row: PAD_ROW, keyIndex: MIN_KEY_INDEX + padIndex };
            }
        }
        return midiNoteToRowKey(event.note, rowOctavesOf(bound.node));
    }

    /**
     * All input nodes currently bound to (and connected for) a device id. An
     * unbound device yields an empty list -> a no-op upstream.
     */
    private boundInputNodes(deviceId: string): BoundInputNode[] {
        const registry = getPresetRegistry();
        const bound: BoundInputNode[] = [];
        for (const node of this.graph.getNodes().values()) {
            if (!MIDI_INPUT_NODE_TYPES.has(node.type)) continue;
            const data = asInputNodeData(node);
            if (!data) continue;
            if (data.deviceId !== deviceId) continue;
            if (data.isConnected === false) continue;
            const preset = data.presetId ? registry.getPreset(data.presetId) : null;
            bound.push({ node, data, preset });
        }
        return bound;
    }
}
