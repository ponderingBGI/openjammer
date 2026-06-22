/**
 * Tests for the control-side MIDI -> voice router (U13).
 *
 * Exercises the four required behaviors:
 *  1. A note from a device bound to an instrument resolves to the correct node,
 *     note (row/keyIndex), and velocity.
 *  2. Per-row octave offset is applied to the resolved (row, keyIndex).
 *  3. Pad vs key routing for the MiniLab 3 preset.
 *  4. An unbound device is a no-op.
 *
 * The router is exercised through its injectable RoutingContext with fakes — no
 * graph store or audio singletons are touched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MIDIVoiceRouter } from '../MIDIVoiceRouter';
import type { GraphAccess, MIDISource, VoiceExecutor } from '../types';
import type { Connection, GraphNode } from '../../../engine/types';
import type { MIDIEvent, MIDINoteEvent } from '../../types';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface ExecCall {
    method: 'noteOn' | 'noteOff';
    keyboardId: string;
    row?: number;
    keyIndex?: number;
    velocity?: number;
}

class FakeExecutor implements VoiceExecutor {
    calls: ExecCall[] = [];
    /** Connection ids passed to activateControlSignal, in order. */
    activated: string[] = [];
    /** Connection ids passed to releaseControlSignal, in order. */
    released: string[] = [];
    noteOn(keyboardId: string, row: number, keyIndex: number, velocity?: number): void {
        this.calls.push({ method: 'noteOn', keyboardId, row, keyIndex, velocity });
    }
    noteOff(keyboardId: string, row: number, keyIndex: number): void {
        this.calls.push({ method: 'noteOff', keyboardId, row, keyIndex });
    }
    activateControlSignal(connectionId: string): void {
        this.activated.push(connectionId);
    }
    releaseControlSignal(connectionId: string): void {
        this.released.push(connectionId);
    }
}

class FakeMIDISource implements MIDISource {
    private allListeners = new Set<(e: MIDIEvent) => void>();
    subscribeCalls = 0;
    unsubscribeCalls = 0;

    subscribe(_deviceId: string, callback: (e: MIDIEvent) => void) {
        this.allListeners.add(callback);
        return { unsubscribe: () => this.allListeners.delete(callback) };
    }
    subscribeAll(callback: (e: MIDIEvent) => void) {
        this.subscribeCalls++;
        this.allListeners.add(callback);
        return {
            unsubscribe: () => {
                this.unsubscribeCalls++;
                this.allListeners.delete(callback);
            }
        };
    }
    /** Simulate a device emitting a parsed event. */
    emit(event: MIDIEvent): void {
        for (const l of this.allListeners) l(event);
    }
    listenerCount(): number {
        return this.allListeners.size;
    }
}

function makeGraph(nodes: GraphNode[], connections: Connection[] = []): GraphAccess {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const connMap = new Map(connections.map((c) => [c.id, c]));
    return {
        getNodes: () => nodeMap,
        getConnections: () => connMap
    };
}

// ---------------------------------------------------------------------------
// Node / event builders
// ---------------------------------------------------------------------------

function midiInputNode(
    id: string,
    deviceId: string | null,
    overrides: Partial<GraphNode['data']> = {},
    type: GraphNode['type'] = 'midi'
): GraphNode {
    return {
        id,
        type,
        category: 'input',
        position: { x: 0, y: 0 },
        data: {
            deviceId,
            deviceSignature: null,
            presetId: type === 'minilab-3' ? 'arturia-minilab-3' : 'generic',
            isConnected: deviceId !== null,
            activeChannel: 0,
            midiLearnMode: false,
            learnTarget: null,
            learnedMappings: {},
            ...overrides
        },
        ports: [],
        parentId: null,
        childIds: []
    };
}

function keyboardNode(
    id: string,
    deviceId: string | null,
    rowOctaves: number[],
    overrides: Partial<GraphNode['data']> = {}
): GraphNode {
    return {
        id,
        type: 'keyboard',
        category: 'input',
        position: { x: 0, y: 0 },
        data: {
            deviceId,
            isConnected: deviceId !== null,
            presetId: 'generic',
            activeChannel: 0,
            rowOctaves,
            ...overrides
        },
        ports: [],
        parentId: null,
        childIds: []
    };
}

let ts = 0;
function noteOn(deviceId: string, note: number, velocity: number, channel = 0): MIDINoteEvent {
    return {
        type: 'noteOn',
        note,
        velocity,
        normalizedVelocity: velocity / 127,
        channel,
        timestamp: ts++,
        deviceId
    };
}
function noteOff(deviceId: string, note: number, channel = 0): MIDINoteEvent {
    return {
        type: 'noteOff',
        note,
        velocity: 0,
        normalizedVelocity: 0,
        channel,
        timestamp: ts++,
        deviceId
    };
}
function cc(deviceId: string, value: number, channel = 0): MIDIEvent {
    return {
        type: 'cc',
        controller: 64,
        value,
        normalizedValue: value / 127,
        channel,
        timestamp: ts++,
        deviceId
    };
}
function conn(id: string, sourceNodeId: string, targetNodeId: string): Connection {
    return {
        id,
        sourceNodeId,
        sourcePortId: 'out',
        targetNodeId,
        targetPortId: 'in',
        type: 'control'
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MIDIVoiceRouter', () => {
    let exec: FakeExecutor;
    let midi: FakeMIDISource;

    beforeEach(() => {
        exec = new FakeExecutor();
        midi = new FakeMIDISource();
        ts = 0;
    });

    describe('bound device resolves to correct node + note + velocity', () => {
        it('routes a noteOn from a bound device to its input node', () => {
            // Generic MIDI node, default row octaves [4,3,2]. Note 60 = C4 -> row 1.
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));

            expect(exec.calls).toHaveLength(1);
            const call = exec.calls[0];
            expect(call.method).toBe('noteOn');
            expect(call.keyboardId).toBe('midi-1');
            expect(call.row).toBe(1); // octave 4 -> row 1
            expect(call.keyIndex).toBe(0); // C
            expect(call.velocity).toBeCloseTo(100 / 127);
        });

        it('routes noteOff with the matching row/keyIndex', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOff('dev-A', 62)); // D4 -> row 1, keyIndex 2

            expect(exec.calls).toEqual([
                { method: 'noteOff', keyboardId: 'midi-1', row: 1, keyIndex: 2 }
            ]);
        });

        it('respects the node activeChannel filter (rejects non-matching channel)', () => {
            // activeChannel 1 (1-indexed) accepts only event channel 0.
            const node = midiInputNode('midi-1', 'dev-A', { activeChannel: 1 });
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100, 5)); // channel 5 -> rejected
            expect(exec.calls).toHaveLength(0);

            midi.emit(noteOn('dev-A', 60, 100, 0)); // channel 0 -> accepted
            expect(exec.calls).toHaveLength(1);
        });
    });

    describe('signal glow on connection cables', () => {
        it('lights the input node\'s outgoing cables on noteOn and fades them on noteOff', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph(
                    [node],
                    [conn('c1', 'midi-1', 'inst-1'), conn('c2', 'midi-1', 'inst-2')]
                ),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.activated).toEqual(['c1', 'c2']);
            expect(exec.released).toEqual([]);

            midi.emit(noteOff('dev-A', 60));
            expect(exec.released).toEqual(['c1', 'c2']);
        });

        it('only glows cables leaving the node that played (not unrelated cables)', () => {
            const a = midiInputNode('midi-A', 'dev-A');
            const b = midiInputNode('midi-B', 'dev-B');
            const router = new MIDIVoiceRouter({
                graph: makeGraph(
                    [a, b],
                    [conn('ca', 'midi-A', 'inst-1'), conn('cb', 'midi-B', 'inst-1')]
                ),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.activated).toEqual(['ca']);
        });
    });

    describe('row offset applied', () => {
        it('maps a note to a non-default row based on the node row octaves', () => {
            // rowOctaves [4,3,2]: note 48 = C3 (octave 3) -> row 2, keyIndex 0.
            const node = keyboardNode('kb-1', 'dev-A', [4, 3, 2]);
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 48, 80));
            expect(exec.calls[0]).toMatchObject({ keyboardId: 'kb-1', row: 2, keyIndex: 0 });

            // note 36 = C2 (octave 2) -> row 3, keyIndex 0.
            midi.emit(noteOn('dev-A', 36, 80));
            expect(exec.calls[1]).toMatchObject({ keyboardId: 'kb-1', row: 3, keyIndex: 0 });
        });

        it('honors custom row octaves (offset shifts which row a note hits)', () => {
            // Custom octaves [5,4,3]: note 60 = C4 (octave 4) -> row 2 (not row 1).
            const node = keyboardNode('kb-1', 'dev-A', [5, 4, 3]);
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 64));
            expect(exec.calls[0]).toMatchObject({ keyboardId: 'kb-1', row: 2, keyIndex: 0 });
        });
    });

    describe('MiniLab 3 pad vs key routing', () => {
        it('routes a key note (48-72) to a pitched row', () => {
            const node = midiInputNode('ml-1', 'dev-ML', {}, 'minilab-3');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            // Note 60 (C4) on channel 0 -> a key, row 1 keyIndex 0.
            midi.emit(noteOn('dev-ML', 60, 90, 0));
            expect(exec.calls[0]).toMatchObject({
                keyboardId: 'ml-1',
                row: 1,
                keyIndex: 0
            });
        });

        it('routes a pad note (36-43 ch10) to the dedicated pad row by pad index', () => {
            const node = midiInputNode('ml-1', 'dev-ML', {}, 'minilab-3');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            // Pad 1 = note 36 on channel 9 (MIDI channel 10) -> pad index 0.
            midi.emit(noteOn('dev-ML', 36, 110, 9));
            // Pad 3 = note 38 on channel 9 -> pad index 2.
            midi.emit(noteOn('dev-ML', 38, 110, 9));

            expect(exec.calls[0]).toMatchObject({ keyboardId: 'ml-1', row: 1, keyIndex: 0 });
            expect(exec.calls[1]).toMatchObject({ keyboardId: 'ml-1', row: 1, keyIndex: 2 });
        });

        it('does not treat a pad note on the wrong channel as a pad', () => {
            const node = midiInputNode('ml-1', 'dev-ML', {}, 'minilab-3');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            // Note 36 on channel 0 (not pad channel 9) -> falls through to key mapping.
            // 36 = C2 (octave 2) -> row 3 with default octaves.
            midi.emit(noteOn('dev-ML', 36, 110, 0));
            expect(exec.calls[0]).toMatchObject({ keyboardId: 'ml-1', row: 3, keyIndex: 0 });
        });
    });

    describe('unbound device is a no-op', () => {
        it('emits nothing when no node references the device id', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-UNKNOWN', 60, 100));
            expect(exec.calls).toHaveLength(0);
        });

        it('emits nothing when the bound node is disconnected', () => {
            const node = midiInputNode('midi-1', 'dev-A', { isConnected: false });
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(0);
        });

        it('ignores non-input node types entirely', () => {
            const instrument: GraphNode = {
                id: 'piano-1',
                type: 'piano',
                category: 'instruments',
                position: { x: 0, y: 0 },
                data: { deviceId: 'dev-A', isConnected: true },
                ports: [],
                parentId: null,
                childIds: []
            };
            const router = new MIDIVoiceRouter({
                graph: makeGraph([instrument]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(0);
        });
    });

    describe('per-note sustain (CC 64)', () => {
        /** noteOff calls only, as [row, keyIndex] pairs in order. */
        const offsOf = (e: FakeExecutor) =>
            e.calls.filter((c) => c.method === 'noteOff').map((c) => [c.row, c.keyIndex]);

        it('holds note-offs while the pedal is down, then flushes each once on pedal up', () => {
            // Pedal down -> play + release 3 notes -> all 3 keep sounding ->
            // pedal up -> all 3 release exactly once each.
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127)); // pedal DOWN

            // C4 (60->1,0), D4 (62->1,2), E4 (64->1,4): press + release each.
            for (const n of [60, 62, 64]) {
                midi.emit(noteOn('dev-A', n, 100));
                midi.emit(noteOff('dev-A', n));
            }

            // No note-off has reached the engine yet — all 3 voices are held.
            expect(offsOf(exec)).toEqual([]);

            midi.emit(cc('dev-A', 0)); // pedal UP -> flush

            // Exactly one note-off per held voice.
            expect(offsOf(exec)).toEqual([
                [1, 0],
                [1, 2],
                [1, 4]
            ]);
        });

        it('a note PRESSED while the pedal is down then released stays held until flush', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127));
            midi.emit(noteOn('dev-A', 60, 100));
            midi.emit(noteOff('dev-A', 60));
            expect(offsOf(exec)).toEqual([]); // held, not released

            midi.emit(cc('dev-A', 0));
            expect(offsOf(exec)).toEqual([[1, 0]]); // released exactly once
        });

        it('re-pressing a held note does not leak a stuck voice (no double note-off)', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127)); // pedal down
            midi.emit(noteOn('dev-A', 60, 100));
            midi.emit(noteOff('dev-A', 60)); // held (1,0)
            midi.emit(noteOn('dev-A', 60, 100)); // RE-PRESS the held note
            // The held entry was dropped by the re-press; the fresh press is live
            // and not yet released.
            expect(offsOf(exec)).toEqual([]);

            midi.emit(cc('dev-A', 0)); // pedal up
            // Re-pressed note is still physically held (no note-off arrived for it
            // after the re-press), so the flush has nothing to release -> no
            // double-off, no stuck voice.
            expect(offsOf(exec)).toEqual([]);
        });

        it('re-pressed then released note flushes exactly once', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127));
            midi.emit(noteOn('dev-A', 60, 100));
            midi.emit(noteOff('dev-A', 60)); // held
            midi.emit(noteOn('dev-A', 60, 100)); // re-press (clears held)
            midi.emit(noteOff('dev-A', 60)); // held again (fresh)
            expect(offsOf(exec)).toEqual([]);

            midi.emit(cc('dev-A', 0));
            expect(offsOf(exec)).toEqual([[1, 0]]); // exactly one
        });

        it('releases immediately when the pedal is up (normal behavior)', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            midi.emit(noteOff('dev-A', 60));
            expect(offsOf(exec)).toEqual([[1, 0]]);
        });

        it('pedal up with no held notes is a no-op', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127));
            midi.emit(cc('dev-A', 0)); // up, nothing held
            expect(exec.calls).toEqual([]);
        });

        it('respects the channel filter for the pedal (CC on a rejected channel does not arm)', () => {
            // activeChannel 1 accepts only event channel 0.
            const node = midiInputNode('midi-1', 'dev-A', { activeChannel: 1 });
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            // Pedal-down on channel 5 is rejected -> pedal NOT armed for this node.
            midi.emit(cc('dev-A', 127, 5));
            midi.emit(noteOn('dev-A', 60, 100, 0));
            midi.emit(noteOff('dev-A', 60, 0));
            // Pedal never engaged on the accepted channel -> immediate release.
            expect(offsOf(exec)).toEqual([[1, 0]]);
        });

        it('two input nodes on the same device sustain independently', () => {
            // Both bound to dev-A but on different channels; pedal arms only node B.
            const a = midiInputNode('midi-A', 'dev-A', { activeChannel: 1 }); // ch 0
            const b = midiInputNode('midi-B', 'dev-A', { activeChannel: 2 }); // ch 1
            const router = new MIDIVoiceRouter({
                graph: makeGraph([a, b]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(cc('dev-A', 127, 1)); // pedal DOWN only for node B (ch 1)

            // Note on ch 0 -> node A (pedal up) releases immediately.
            midi.emit(noteOn('dev-A', 60, 100, 0));
            midi.emit(noteOff('dev-A', 60, 0));
            // Note on ch 1 -> node B (pedal down) is held.
            midi.emit(noteOn('dev-A', 60, 100, 1));
            midi.emit(noteOff('dev-A', 60, 1));

            expect(exec.calls.filter((c) => c.method === 'noteOff')).toEqual([
                { method: 'noteOff', keyboardId: 'midi-A', row: 1, keyIndex: 0 }
            ]);

            midi.emit(cc('dev-A', 0, 1)); // pedal UP for node B -> flush B only
            expect(exec.calls.filter((c) => c.method === 'noteOff')).toEqual([
                { method: 'noteOff', keyboardId: 'midi-A', row: 1, keyIndex: 0 },
                { method: 'noteOff', keyboardId: 'midi-B', row: 1, keyIndex: 0 }
            ]);
        });

        it('ignores non-sustain CC messages', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit({
                type: 'cc',
                controller: 1, // mod wheel
                value: 127,
                normalizedValue: 1,
                channel: 0,
                timestamp: ts++,
                deviceId: 'dev-A'
            });
            expect(exec.calls).toHaveLength(0);
        });
    });

    describe('multiple bound nodes', () => {
        it('fans a note out to every node bound to the device', () => {
            const a = midiInputNode('midi-1', 'dev-A');
            const b = keyboardNode('kb-1', 'dev-A', [4, 3, 2]);
            const router = new MIDIVoiceRouter({
                graph: makeGraph([a, b]),
                executor: exec,
                midi
            });
            router.start();

            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(2);
            expect(exec.calls.map((c) => c.keyboardId).sort()).toEqual(['kb-1', 'midi-1']);
        });
    });

    describe('malformed input', () => {
        it('ignores an undefined event instead of reading .type', () => {
            const router = new MIDIVoiceRouter({
                graph: makeGraph([]),
                executor: exec,
                midi
            });

            expect(() => router.handleEvent(undefined)).not.toThrow();
            expect(exec.calls).toHaveLength(0);
        });
    });

    describe('lifecycle', () => {
        it('start subscribes once; stop unsubscribes and halts routing', () => {
            const node = midiInputNode('midi-1', 'dev-A');
            const router = new MIDIVoiceRouter({
                graph: makeGraph([node]),
                executor: exec,
                midi
            });

            router.start();
            router.start(); // idempotent
            expect(midi.subscribeCalls).toBe(1);
            expect(midi.listenerCount()).toBe(1);

            router.stop();
            expect(midi.unsubscribeCalls).toBe(1);
            expect(midi.listenerCount()).toBe(0);

            // Events after stop are ignored.
            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(0);

            router.stop(); // idempotent
            expect(midi.unsubscribeCalls).toBe(1);
        });

        it('resolves against the live graph (newly bound nodes route)', () => {
            const nodeMap = new Map<string, GraphNode>();
            const graph: GraphAccess = {
                getNodes: () => nodeMap,
                getConnections: () => new Map()
            };
            const router = new MIDIVoiceRouter({ graph, executor: exec, midi });
            router.start();

            // No nodes yet -> no-op.
            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(0);

            // Bind a node, then the same event routes.
            const node = midiInputNode('midi-1', 'dev-A');
            nodeMap.set(node.id, node);
            midi.emit(noteOn('dev-A', 60, 100));
            expect(exec.calls).toHaveLength(1);
        });
    });
});
