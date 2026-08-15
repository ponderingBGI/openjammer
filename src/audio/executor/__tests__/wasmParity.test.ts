/**
 * U-WASM-PARITY gate tests.
 *
 * Pin the two browser-parity paths of {@link OjcoreWasmExecutor} against a
 * MOCKED AudioWorklet / getUserMedia (no real audio in the sandbox):
 *
 *  1. SAMPLER LIVE-LOAD: `getSamplerAdapter(nodeId).setBuffer(buffer)` transfers
 *     mono PCM into the worklet (a `load-sample` message), and when the worklet
 *     replies `sample-stored` the executor binds the returned `AssetId` onto the
 *     node's `AssetRef` and re-pushes the graph (so the worklet recompiles-with-
 *     assets and the live Sampler plays the sample) — mirroring the native flow.
 *  2. MIC INPUT: `setMicrophoneInput` makes the executor the SINGLE owner of the
 *     OS mic device — it opens exactly ONE `getUserMedia` and wires the
 *     `MediaStreamSource` into the worklet input. Muting DISCONNECTS that source
 *     so the engine's `MicIn` reads silence (provably off at the seam). A device
 *     change re-acquires one stream; permission denial does NOT throw.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { OjGraph } from '../../../../packages/oj-protocol-ts/src/index';
import { getNodeDefinition } from '../../../engine/registry';
import type { Connection, GraphNode, NodeType } from '../../../engine/types';
import { useEngineHealthStore } from '../../../store/engineHealthStore';

// The wasm bytes + worklet module are vite `?url` / `?worker&url` imports; under
// vitest they resolve to plain strings, so no extra mock is needed for those.

// Mock the AudioContext provider so the executor's async `setup()` runs against a
// fake graph-capable context with the hooks the mic path uses.
const fakeMediaStreamSource = { connect: vi.fn(), disconnect: vi.fn() };
const fakeContext = {
    sampleRate: 48000,
    destination: {},
    audioWorklet: { addModule: vi.fn(() => Promise.resolve()) },
    createMediaStreamSource: vi.fn(() => fakeMediaStreamSource),
    // The default-voice path builds an AudioBuffer from synthesized PCM; a minimal
    // mono buffer is enough for `OjcoreSamplerHandle.setBuffer` to downmix + load.
    createBuffer: (channels: number, length: number, sampleRate: number) => {
        const data = new Float32Array(length);
        return {
            numberOfChannels: channels,
            length,
            sampleRate,
            getChannelData: () => data,
            // Stage 3 finalize-PCM: the looper handle builds a real AudioBuffer
            // from the take PCM via copyToChannel, then reads it back for the true
            // waveform — so the fake must actually store the copied samples.
            copyToChannel: (src: Float32Array, _ch: number) => {
                data.set(src.subarray(0, length));
            },
        };
    },
};
vi.mock('../../audioContext', () => ({
    getAudioContext: () => fakeContext,
}));

// ---------------------------------------------------------------------------
// A capturing mock AudioWorkletNode: records posted messages and lets a test
// simulate worklet -> UI replies via the captured `port.onmessage`.
// ---------------------------------------------------------------------------

interface PostedMsg {
    type?: string;
    [k: string]: unknown;
}

class MockPort {
    posted: PostedMsg[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage(msg: PostedMsg, _transfer?: Transferable[]): void {
        this.posted.push(msg);
    }
    /** Simulate the worklet posting a message back to the UI thread. */
    emit(data: PostedMsg): void {
        this.onmessage?.({ data } as MessageEvent);
    }
}

class MockWorkletNode {
    static last: MockWorkletNode | null = null;
    port = new MockPort();
    options: unknown;
    connect = vi.fn();
    disconnect = vi.fn();
    constructor(_ctx: unknown, _name: string, options: unknown) {
        this.options = options;
        MockWorkletNode.last = this;
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(type: NodeType, id: string): GraphNode {
    const def = getNodeDefinition(type);
    return {
        id,
        type,
        category: def.category,
        position: { x: 0, y: 0 },
        data: { ...def.defaultData },
        ports: [...def.defaultPorts],
        parentId: null,
        childIds: [],
    };
}

function makeConn(
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string,
): Connection {
    return {
        id: `${sourceNodeId}:${sourcePortId}->${targetNodeId}:${targetPortId}`,
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
        type: 'audio',
    };
}

/** A sampler -> speaker graph so the sampler interns to a stable NodeIdx. */
function samplerGraph(): { nodes: Map<string, GraphNode>; connections: Map<string, Connection> } {
    const sampler = makeNode('sampler', 'sampler-1');
    const speaker = makeNode('speaker', 'speaker-1');
    const out = sampler.ports.find((p) => p.direction === 'output');
    const spkIn = speaker.ports.find((p) => p.direction === 'input');
    const conns = new Map<string, Connection>();
    if (out && spkIn) {
        const c = makeConn(sampler.id, out.id, speaker.id, spkIn.id);
        conns.set(c.id, c);
    }
    return {
        nodes: new Map([
            [sampler.id, sampler],
            [speaker.id, speaker],
        ]),
        connections: conns,
    };
}

/** A microphone -> speaker graph (mic node present so the engine sources it). */
function micGraph(): { nodes: Map<string, GraphNode>; connections: Map<string, Connection> } {
    const mic = makeNode('microphone', 'mic-1');
    const speaker = makeNode('speaker', 'speaker-1');
    const out = mic.ports.find((p) => p.direction === 'output');
    const spkIn = speaker.ports.find((p) => p.direction === 'input');
    const conns = new Map<string, Connection>();
    if (out && spkIn) {
        const c = makeConn(mic.id, out.id, speaker.id, spkIn.id);
        conns.set(c.id, c);
    }
    return {
        nodes: new Map([
            [mic.id, mic],
            [speaker.id, speaker],
        ]),
        connections: conns,
    };
}

/** A looper -> speaker graph so the looper interns to a stable NodeIdx (0). */
function looperGraph(): { nodes: Map<string, GraphNode>; connections: Map<string, Connection> } {
    const looper = makeNode('looper', 'looper-1');
    const speaker = makeNode('speaker', 'speaker-1');
    const out = looper.ports.find((p) => p.direction === 'output');
    const spkIn = speaker.ports.find((p) => p.direction === 'input');
    const conns = new Map<string, Connection>();
    if (out && spkIn) {
        const c = makeConn(looper.id, out.id, speaker.id, spkIn.id);
        conns.set(c.id, c);
    }
    return {
        nodes: new Map([
            [looper.id, looper],
            [speaker.id, speaker],
        ]),
        connections: conns,
    };
}

/** A mono fake AudioBuffer the sampler handle interleaves (1 channel = unchanged). */
function fakeBuffer(): AudioBuffer {
    return {
        numberOfChannels: 1,
        length: 8,
        sampleRate: 44100,
        getChannelData: () => new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    } as unknown as AudioBuffer;
}

// ---------------------------------------------------------------------------
// Async setup helper: bring the executor up against the mock worklet + wasm.
// ---------------------------------------------------------------------------

interface BroughtUp {
    port: MockPort;
    /** Fire the node-change subscription to trigger a real `pushGraph`. */
    fireNodeChange: () => void;
}

/** Replace fetch + WebAssembly.compile + AudioWorkletNode with mocks, init the
 *  executor over `graph`, await its async `setup`, and drive it to `ready`. */
async function bringUp(
    ex: import('../OjcoreWasmExecutor').OjcoreWasmExecutor,
    graph: { nodes: Map<string, GraphNode>; connections: Map<string, Connection> },
): Promise<BroughtUp> {
    let nodeCb: (() => void) | null = null;
    ex.initialize(
        () => () => {},
        (cb) => {
            nodeCb = cb as unknown as () => void;
            return () => {};
        },
        () => graph.nodes,
        () => graph.connections,
    );
    // Let setup()'s awaits (addModule, fetch, compile) settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const port = MockWorkletNode.last!.port;
    // Simulate the worklet reaching `init` and announcing readiness.
    port.emit({ type: 'ready' });
    return { port, fireNodeChange: () => nodeCb?.() };
}

// ---------------------------------------------------------------------------

describe('OjcoreWasmExecutor sampler live-load (mocked worklet)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        fakeMediaStreamSource.connect.mockClear();
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('setBuffer transfers PCM as a load-sample message to the worklet', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, samplerGraph());

        port.posted.length = 0;
        ex.getSamplerAdapter('sampler-1').setBuffer(fakeBuffer());

        const load = port.posted.find((m) => m.type === 'load-sample');
        expect(load, 'a load-sample message was posted').toBeTruthy();
        expect(load!.node).toBeTypeOf('number');
        expect((load!.pcm as Float32Array).length).toBe(8);
        expect(load!.channels).toBe(1); // mono interleave = unchanged
        expect(load!.sampleRate).toBe(44100);
        expect(load!.rootNote).toBe(60);
        ex.dispose();
    });

    it('publishes graph + tempo + whole timeline and frames timed commands without TS scheduling', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, samplerGraph());
        port.posted.length = 0;
        const graph: OjGraph = { ir_version: 1, sample_rate: 48_000, block_size: 128, nodes: [], edges: [], schedule: [] };
        const tempoMap = {
            ppq: 960, sample_rate: 48_000,
            tempos: [{ tick: 0, sample: 0, bpm_start: 120, bpm_end: 120, continuing: false }],
            meters: [{ tick: 0, sample: 0, bar: 1, divisions_per_bar: 4, note_value: 4 }],
        };
        const timeline = { sample_rate: 48_000, events: [], loop_range: [12_000, 24_000] as [number, number], punch_range: null, armed_tracks: [], count_in_beats: 0, end: 96_000 };

        ex.startArrangementPreview({ graph, tempoMap, timeline }, 0);
        expect(port.posted.map((message) => message.type)).toEqual([
            'graph', 'load_tempo_map', 'load_timeline', 'command',
        ]);
        const play = JSON.parse(new TextDecoder().decode(port.posted[3]!.bytes as Uint8Array));
        expect(play).toBe('TransportPlay');

        ex.sendTimed(22_000, { NoteOff: { node: 3, note: 60 } });
        const timed = JSON.parse(new TextDecoder().decode(port.posted.at(-1)!.bytes as Uint8Array));
        expect(timed).toEqual({ at: 22_000, cmd: { NoteOff: { node: 3, note: 60 } } });

        port.posted.length = 0;
        ex.stopArrangementPreview();
        const stopCommands = port.posted
            .filter((message) => message.type === 'command')
            .map((message) => JSON.parse(new TextDecoder().decode(message.bytes as Uint8Array)));
        expect(stopCommands).toEqual(['TransportPause']);
        ex.dispose();
    });

    it('a sample-stored reply binds the AssetRef onto the node and re-pushes the graph', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, samplerGraph());

        ex.getSamplerAdapter('sampler-1').setBuffer(fakeBuffer());
        const load = port.posted.find((m) => m.type === 'load-sample')!;
        const node = load.node as number;

        port.posted.length = 0;
        // Worklet stored the PCM and assigned an AssetId.
        port.emit({ type: 'sample-stored', node, assetId: 0xabcdef, rootNote: 60 });

        // The executor must re-push a graph whose sampler node now carries the
        // bound AssetRef in slot 0 + the root-note param (16).
        const graphMsg = port.posted.find((m) => m.type === 'graph');
        expect(graphMsg, 'graph re-pushed after sample-stored').toBeTruthy();
        const bytes = graphMsg!.bytes as Uint8Array;
        const pushed = JSON.parse(new TextDecoder().decode(bytes)) as OjGraph;
        const sampler = pushed.nodes.find((n) => n.id === node)!;
        expect(sampler.assets).toContainEqual({ slot: 0, asset: 0xabcdef });
        expect(sampler.params.some((p) => p.id === 16 && p.value === 60)).toBe(true);
        ex.dispose();
    });

    it('sendSampleBuffer feeds a wired Library -> Sampler (DEFECT 2 feed reaches the sampler)', async () => {
        // The library's one live seam: a Library -> Sampler connection makes
        // `sendSampleBuffer(library, buffer)` install the PCM into that sampler. The
        // executor fans out by TARGET node type (sampler), so the connection just has
        // to exist (the sampler has no dedicated sample-in port — bundle-in is fine).
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const library = makeNode('library', 'library-1');
        const sampler = makeNode('sampler', 'sampler-1');
        const speaker = makeNode('speaker', 'speaker-1');
        const libOut = library.ports.find((p) => p.id === 'sample-out')!;
        const samplerIn = sampler.ports.find((p) => p.direction === 'input')!;
        const samplerOut = sampler.ports.find((p) => p.direction === 'output')!;
        const spkIn = speaker.ports.find((p) => p.direction === 'input')!;
        const conns = new Map<string, Connection>();
        const c1 = makeConn(library.id, libOut.id, sampler.id, samplerIn.id);
        const c2 = makeConn(sampler.id, samplerOut.id, speaker.id, spkIn.id);
        conns.set(c1.id, c1);
        conns.set(c2.id, c2);
        const graph = {
            nodes: new Map([
                [library.id, library],
                [sampler.id, sampler],
                [speaker.id, speaker],
            ]),
            connections: conns,
        };

        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, graph);

        port.posted.length = 0;
        ex.sendSampleBuffer('library-1', fakeBuffer());

        const load = port.posted.find((m) => m.type === 'load-sample');
        expect(load, 'the library feed reached the sampler as a load-sample').toBeTruthy();
        const samplerIdx = (ex as unknown as { index: Map<string, number> }).index.get('sampler-1');
        expect(load!.node).toBe(samplerIdx);
        expect((load!.pcm as Float32Array).length).toBe(8);
        ex.dispose();
    });

    it('the binding survives a later graph push (node/connection edit)', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const graph = samplerGraph();
        const ex = new OjcoreWasmExecutor();
        const { port, fireNodeChange } = await bringUp(ex, graph);

        ex.getSamplerAdapter('sampler-1').setBuffer(fakeBuffer());
        const node = port.posted.find((m) => m.type === 'load-sample')!.node as number;
        port.emit({ type: 'sample-stored', node, assetId: 7, rootNote: 48 });

        // A later UI-driven edit (another node added) re-emits + re-pushes the
        // graph; the binding must be re-applied onto the freshly emitted IR.
        graph.nodes.set('keys-1', makeNode('keys', 'keys-1'));
        port.posted.length = 0;
        fireNodeChange();

        const graphMsg = [...port.posted].reverse().find((m) => m.type === 'graph');
        expect(graphMsg, 'a graph was re-pushed on the node edit').toBeTruthy();
        const pushed = JSON.parse(new TextDecoder().decode(graphMsg!.bytes as Uint8Array)) as OjGraph;
        // Two nodes now lower to builtin.sampler (sampler-1 + keys-1); the binding
        // must land on exactly the one that was loaded — assert SOME sampler node
        // carries the bound AssetRef + root note in the re-pushed graph.
        const samplers = pushed.nodes.filter((n) => n.manifest_id === 'builtin.sampler');
        const bound = samplers.find((n) => n.assets.some((a) => a.slot === 0 && a.asset === 7));
        expect(bound, 'the loaded sampler keeps its binding after a later push').toBeTruthy();
        expect(bound!.params.some((p) => p.id === 16 && p.value === 48)).toBe(true);
        void node;
        ex.dispose();
    });
});

describe('OjcoreWasmExecutor looper return path (mocked worklet)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('routes a worklet looper frame to the looper handle onEngineFrame', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        // The worklet posts a flat [node, state, pos, loop_len, peak] frame for the
        // looper node (interned to NodeIdx 0).
        const frames = new Float32Array([0, 3 /* PLAYING */, 240, 480, 0.5]);
        port.emit({ type: 'looper', frames });

        const looper = ex.getLooper('looper-1') as unknown as { getEngineState(): number };
        expect(looper.getEngineState()).toBe(3);
        ex.dispose();
    });

    it('routes a worklet LooperEdge event (on the events message) to onEngineEdge — creates a row', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        const looper = ex.getLooper('looper-1');
        const added: string[] = [];
        (
            looper as unknown as { setOnLoopAdded(cb: (l: { id: string }) => void): void }
        ).setOnLoopAdded((l) => added.push(l.id));

        // A LooperEdge RECORDING->PLAYING rides the existing `events` postMessage as a
        // JSON Event[] (the same wire shape faults use).
        const event = {
            v: 1,
            seq: 1,
            severity: 'Info',
            kind: { LooperEdge: { node: 0, from: 2 /* RECORDING */, to: 3 /* PLAYING */ } },
            source: 'Wasm',
            ts_us: 0,
            corr_id: 0,
        };
        const bytes = new TextEncoder().encode(JSON.stringify([event]));
        port.emit({ type: 'events', bytes });

        expect(added).toHaveLength(1);
        expect(looper.getLoops()).toHaveLength(1);
        ex.dispose();
    });

    it('routes a worklet looper-take message to onLayerPcm — the committed row gains a real buffer + true waveform', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        const looper = ex.getLooper('looper-1');
        // Create the committed row first (the commit edge, as Stage 2 does).
        const event = {
            v: 1,
            seq: 1,
            severity: 'Info',
            kind: { LooperEdge: { node: 0, from: 2 /* RECORDING */, to: 3 /* PLAYING */ } },
            source: 'Wasm',
            ts_us: 0,
            corr_id: 0,
        };
        port.emit({ type: 'events', bytes: new TextEncoder().encode(JSON.stringify([event])) });
        expect(looper.getLoops()[0].buffer, 'row starts with no real buffer').toBeNull();

        // The worklet ships the just-committed take's TRUE PCM (a ramp) on the
        // dedicated `looper-take` message — the buffer is transferred.
        const pcm = new Float32Array([0, 0.25, 0.5, 1.0]);
        port.emit({ type: 'looper-take', node: 0, pcm, sampleRate: 48000 });

        const layer = looper.getLoops()[0];
        expect(layer.buffer, 'row now carries a real AudioBuffer (drag/export light up)').not.toBeNull();
        expect(layer.buffer!.getChannelData(0)[3]).toBeCloseTo(1.0, 5);
        // The true waveform replaced the meter envelope — its peak is the PCM peak.
        expect(Math.max(...layer.waveformData)).toBeCloseTo(1.0, 5);
        ex.dispose();
    });

    it('a looper-take that races AHEAD of its commit edge still lands on the row', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        const looper = ex.getLooper('looper-1');
        // PCM arrives BEFORE the commit edge (the two seams race; either can win).
        port.emit({ type: 'looper-take', node: 0, pcm: new Float32Array([0.2, 0.8]), sampleRate: 48000 });
        expect(looper.getLoops(), 'no row yet — PCM is buffered').toHaveLength(0);

        // Now the commit edge creates the row; the buffered PCM attaches to it.
        const event = {
            v: 1,
            seq: 1,
            severity: 'Info',
            kind: { LooperEdge: { node: 0, from: 2, to: 3 } },
            source: 'Wasm',
            ts_us: 0,
            corr_id: 0,
        };
        port.emit({ type: 'events', bytes: new TextEncoder().encode(JSON.stringify([event])) });

        const layer = looper.getLoops()[0];
        expect(layer.buffer, 'the buffered PCM attached to the new row').not.toBeNull();
        expect(layer.buffer!.getChannelData(0)[1]).toBeCloseTo(0.8, 5);
        ex.dispose();
    });
});

describe('OjcoreWasmExecutor speaker volume (mocked worklet)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** Decode every posted `command` message into its RtCommand JSON. */
    function sentCommands(port: MockPort): unknown[] {
        return port.posted
            .filter((m) => m.type === 'command')
            .map((m) => JSON.parse(new TextDecoder().decode(m.bytes as Uint8Array)));
    }

    it('routes volume + mute as SetParam(VOLUME=0)+SetParam(MUTE=1) to the engine — applied ONCE', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        port.posted.length = 0;
        // speaker-1 interns to NodeIdx 1 (sorted ids: looper-1 < speaker-1).
        ex.setSpeakerVolume('speaker-1', 0.5, false);

        const cmds = sentCommands(port) as Array<{ SetParam?: { node: number; param: number; value: number } }>;
        // Exactly two SetParams: master VOLUME then master MUTE.
        const setParams = cmds.filter((c) => 'SetParam' in c).map((c) => c.SetParam!);
        expect(setParams).toHaveLength(2);
        const vol = setParams.find((p) => p.param === 0);
        const mute = setParams.find((p) => p.param === 1);
        expect(vol, 'master VOLUME (param 0) was sent').toBeTruthy();
        expect(vol!.value).toBeCloseTo(0.5, 5);
        expect(mute, 'master MUTE (param 1) was sent').toBeTruthy();
        expect(mute!.value).toBe(0);
        // Both SetParams address the SAME interned SpeakerOut NodeIdx.
        expect(vol!.node).toBe(mute!.node);

        // NO double gain: the old worklet `master-gain` postMessage must be GONE —
        // volume is applied exactly once, by the engine's master_gain.
        expect(port.posted.some((m) => m.type === 'master-gain')).toBe(false);
        ex.dispose();
    });

    it('mute sends MUTE=1 (engine zeroes the master mix), not a worklet gain', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, looperGraph());

        port.posted.length = 0;
        ex.setSpeakerVolume('speaker-1', 0.8, true);

        const cmds = sentCommands(port) as Array<{ SetParam?: { param: number; value: number } }>;
        const setParams = cmds.filter((c) => 'SetParam' in c).map((c) => c.SetParam!);
        const mute = setParams.find((p) => p.param === 1);
        expect(mute!.value, 'muted => MUTE param 1.0').toBe(1);
        // Volume value is still sent verbatim (the engine forces gain to 0 on mute).
        const vol = setParams.find((p) => p.param === 0);
        expect(vol!.value).toBeCloseTo(0.8, 5);
        expect(port.posted.some((m) => m.type === 'master-gain')).toBe(false);
        ex.dispose();
    });
});

describe('OjcoreWasmExecutor microphone input (mocked getUserMedia)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        fakeMediaStreamSource.connect.mockClear();
        fakeMediaStreamSource.disconnect.mockClear();
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('grants: opens exactly ONE getUserMedia and wires the source into the worklet input', async () => {
        const tracks = [{ stop: vi.fn(), onended: null as null | (() => void) }];
        const stream = { getTracks: () => tracks } as unknown as MediaStream;
        const getUserMedia = vi.fn(() => Promise.resolve(stream));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        // Declare intent (unmuted). The EXECUTOR owns the device — the UI never
        // opens its own stream, so this is the ONLY getUserMedia in the system.
        ex.setMicrophoneInput('mic-1', { isMuted: false });
        await Promise.resolve();
        await Promise.resolve();

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(fakeContext.createMediaStreamSource).toHaveBeenCalledWith(stream);
        // Live (unmuted) => the source is connected to feed the engine MicIn.
        expect(fakeMediaStreamSource.connect).toHaveBeenCalledTimes(1);

        // A redundant same-device, same-mute call does NOT open a second stream.
        ex.setMicrophoneInput('mic-1', { isMuted: false });
        await Promise.resolve();
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        ex.dispose();
        // dispose stops the captured tracks.
        expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('muting disconnects the worklet input so the engine-fed mic block is silent', async () => {
        const tracks = [{ stop: vi.fn(), onended: null as null | (() => void) }];
        const stream = { getTracks: () => tracks } as unknown as MediaStream;
        const getUserMedia = vi.fn(() => Promise.resolve(stream));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        // Go live: source connected to the worklet input (engine hears the mic).
        ex.setMicrophoneInput('mic-1', { isMuted: false });
        await Promise.resolve();
        await Promise.resolve();
        expect(fakeMediaStreamSource.connect).toHaveBeenCalledTimes(1);
        expect(fakeMediaStreamSource.disconnect).not.toHaveBeenCalled();

        // Mute: the source is DISCONNECTED from the worklet input. The worklet's
        // feedMicInput then sees no input and the engine's MicIn reads zeros — the
        // mic is provably off at the engine, not merely dimmed in the UI. No new
        // getUserMedia (single owner).
        ex.setMicrophoneInput('mic-1', { isMuted: true });
        await Promise.resolve();
        expect(fakeMediaStreamSource.disconnect).toHaveBeenCalled();
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        // Unmute reconnects the SAME owned stream (still one getUserMedia).
        ex.setMicrophoneInput('mic-1', { isMuted: false });
        await Promise.resolve();
        expect(fakeMediaStreamSource.connect).toHaveBeenCalledTimes(2);
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        ex.dispose();
    });

    it('a device change re-acquires exactly one stream (single owner)', async () => {
        const mkStream = () => {
            const tracks = [{ stop: vi.fn(), onended: null as null | (() => void) }];
            return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
        };
        const a = mkStream();
        const b = mkStream();
        const getUserMedia = vi
            .fn()
            .mockResolvedValueOnce(a.stream)
            .mockResolvedValueOnce(b.stream);
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        ex.setMicrophoneInput('mic-1', { isMuted: false, deviceId: 'default' });
        await Promise.resolve();
        await Promise.resolve();
        expect(getUserMedia).toHaveBeenCalledTimes(1);

        // Switch device: the prior owned stream is torn down and exactly one new
        // stream is acquired for the new device.
        ex.setMicrophoneInput('mic-1', { isMuted: false, deviceId: 'usb-mic' });
        await Promise.resolve();
        await Promise.resolve();
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(a.tracks[0].stop).toHaveBeenCalled();
        const lastConstraints = getUserMedia.mock.calls[1][0] as MediaStreamConstraints;
        expect(lastConstraints.audio).toMatchObject({ deviceId: { exact: 'usb-mic' } });

        ex.dispose();
    });

    it('denied: does not throw and leaves the mic unrouted', async () => {
        const getUserMedia = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        // Must not throw synchronously...
        expect(() => ex.setMicrophoneInput('mic-1', { isMuted: false })).not.toThrow();
        // ...nor reject (the rejection is caught internally).
        await Promise.resolve();
        await Promise.resolve();
        expect(getUserMedia).toHaveBeenCalled();
        expect(fakeMediaStreamSource.connect).not.toHaveBeenCalled();
        ex.dispose();
    });

    it('missing getUserMedia: no throw, no routing', async () => {
        vi.stubGlobal('navigator', { mediaDevices: {} });
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());
        expect(() => ex.setMicrophoneInput('mic-1', { isMuted: false })).not.toThrow();
        await Promise.resolve();
        expect(fakeMediaStreamSource.connect).not.toHaveBeenCalled();
        ex.dispose();
    });

    it('muting BEFORE the stream is acquired never connects the source (silent on load)', async () => {
        // PERSIST-1: a project saved muted reloads muted. The first intent the node
        // declares on load is `isMuted: true`; the executor must acquire the stream
        // but leave it DISCONNECTED, so the engine MicIn reads silence from block 0.
        const tracks = [{ stop: vi.fn(), onended: null as null | (() => void) }];
        const stream = { getTracks: () => tracks } as unknown as MediaStream;
        const getUserMedia = vi.fn(() => Promise.resolve(stream));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        ex.setMicrophoneInput('mic-1', { isMuted: true });
        await Promise.resolve();
        await Promise.resolve();
        // The stream was acquired (so unmute is instant) but never connected.
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(fakeMediaStreamSource.connect).not.toHaveBeenCalled();
        ex.dispose();
    });
});

describe('OjcoreWasmExecutor health on startup failure (mocked worklet)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })),
        );
        useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
    });

    it('flips engine health to DEAD when the worklet module fails to load', async () => {
        // The most consequential browser failure: addModule rejects, so the worklet
        // never registers (`registerProcessor` never takes effect) and the engine
        // makes NO sound. Health must NOT sit at IDLE — a silent failure the dot
        // cannot show — it must surface DEAD so the performer sees it.
        (fakeContext.audioWorklet.addModule as ReturnType<typeof vi.fn>).mockImplementationOnce(
            () => Promise.reject(new Error('addModule failed')),
        );
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        ex.initialize(
            () => () => {},
            () => () => {},
            () => new Map(),
            () => new Map(),
        );
        // Let setup()'s rejected addModule propagate into the .catch handler.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(useEngineHealthStore.getState().health).toBe('DEAD');
        ex.dispose();
    });

    it('flips engine health to DEAD when the wasm fetch is not OK (404/500)', async () => {
        // A non-OK fetch returns a Response whose body is an HTML error page, not
        // wasm. We must FAIL FAST in setup() rather than post that garbage to the
        // worklet (where `instantiate` would throw on its own thread and die silently,
        // unseen by setup().catch). The non-OK fetch throws straight into the catch,
        // which surfaces DEAD.
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
            Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' }),
        );
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        ex.initialize(
            () => () => {},
            () => () => {},
            () => new Map(),
            () => new Map(),
        );
        // Let setup()'s addModule + the rejected fetch propagate into the .catch.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(useEngineHealthStore.getState().health).toBe('DEAD');
        ex.dispose();
    });
});

// ---------------------------------------------------------------------------
// Instrument-switch voice binding (browser parity with the native fix). The
// built-in default voice must NOT read back as a USER sample, so a picker change
// always re-binds; and a node that switches to a plucked/bass (Karplus) instrument
// must never receive a stale sampler asset.
// ---------------------------------------------------------------------------

describe('OjcoreWasmExecutor instrument-switch voice binding (mocked worklet)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        fakeMediaStreamSource.connect.mockClear();
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    /** A `keys` instrument -> speaker graph carrying a picker `instrumentId`. */
    function instrumentGraph(instrumentId: string): {
        nodes: Map<string, GraphNode>;
        connections: Map<string, Connection>;
    } {
        const inst = makeNode('keys', 'keys-1');
        inst.data = { ...inst.data, instrumentId };
        const speaker = makeNode('speaker', 'speaker-1');
        const out = inst.ports.find((p) => p.direction === 'output' && p.type === 'audio');
        const spkIn = speaker.ports.find((p) => p.direction === 'input');
        const conns = new Map<string, Connection>();
        if (out && spkIn) {
            const c = makeConn(inst.id, out.id, speaker.id, spkIn.id);
            conns.set(c.id, c);
        }
        return {
            nodes: new Map([
                [inst.id, inst],
                [speaker.id, speaker],
            ]),
            connections: conns,
        };
    }

    it('re-binds the voice on a picker change (a default voice is NOT a user sample)', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const graph = instrumentGraph('gm-acoustic-grand-piano');
        const ex = new OjcoreWasmExecutor();
        const { port, fireNodeChange } = await bringUp(ex, graph);

        // On ready, the piano default voice loads (a load-sample for the keys node).
        const firstLoad = port.posted.find((m) => m.type === 'load-sample');
        expect(firstLoad, 'a default voice was loaded on ready').toBeTruthy();
        const node = firstLoad!.node as number;
        // Complete the round trip so the default voice is recorded — in
        // `defaultVoiceBindings`, NOT `sampleBindings` (the conflation that used to
        // make the next picker change a no-op).
        port.emit({ type: 'sample-stored', node, assetId: 100, rootNote: 60 });

        // Switch to another piano (same family). It MUST re-bind a new voice.
        const inst = graph.nodes.get('keys-1') as GraphNode;
        inst.data = { ...inst.data, instrumentId: 'gm-bright-acoustic-piano' };
        port.posted.length = 0;
        fireNodeChange();
        const reload = port.posted.find((m) => m.type === 'load-sample');
        expect(reload, 'switching instruments re-binds a new voice').toBeTruthy();
        ex.dispose();
    });

    it('one node\'s default-voice failure does NOT starve later nodes (per-node try/catch)', async () => {
        // DEFECT 3: a single node's buffer build throwing must not `return` out of the
        // whole pass and leave LATER instrument nodes without their default voice. We
        // make the FIRST instrument's `createBuffer` throw; the SECOND must still load.
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');

        // Two distinct piano instruments (different voice keys => two createBuffer
        // calls). Insertion order fixes the iteration order: bad node first.
        const bad = makeNode('keys', 'bad-1');
        bad.data = { ...bad.data, instrumentId: 'gm-acoustic-grand-piano' };
        const good = makeNode('keys', 'good-1');
        good.data = { ...good.data, instrumentId: 'gm-bright-acoustic-piano' };
        const speaker = makeNode('speaker', 'speaker-1');
        const graph = {
            nodes: new Map([
                [bad.id, bad],
                [good.id, good],
                [speaker.id, speaker],
            ]),
            connections: new Map<string, Connection>(),
        };

        // Throw on the FIRST createBuffer (the bad node), succeed afterwards.
        const realCreateBuffer = fakeContext.createBuffer;
        let calls = 0;
        const spy = vi
            .spyOn(fakeContext, 'createBuffer')
            .mockImplementation((ch: number, len: number, sr: number) => {
                calls += 1;
                if (calls === 1) throw new Error('boom: bad PCM build');
                return realCreateBuffer(ch, len, sr);
            });

        const ex = new OjcoreWasmExecutor();
        const { port } = await bringUp(ex, graph);

        // The good node must still receive its default voice despite the bad node's
        // throw — proof the pass CONTINUED instead of aborting on the first failure.
        const loads = port.posted.filter((m) => m.type === 'load-sample');
        const goodIdx = (ex as unknown as { index: Map<string, number> }).index.get('good-1');
        expect(goodIdx, 'good node was interned').toBeTypeOf('number');
        expect(
            loads.some((m) => m.node === goodIdx),
            'the later node still got its default voice',
        ).toBe(true);

        spy.mockRestore();
        ex.dispose();
    });

    it('does not bind a stale sampler asset onto a node that switched to Karplus', async () => {
        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const graph = instrumentGraph('gm-acoustic-grand-piano');
        const ex = new OjcoreWasmExecutor();
        const { port, fireNodeChange } = await bringUp(ex, graph);

        const firstLoad = port.posted.find((m) => m.type === 'load-sample')!;
        const node = firstLoad.node as number;
        port.emit({ type: 'sample-stored', node, assetId: 100, rootNote: 60 });

        // Switch to Harpsichord (a 'piano'-category instrument that lowers to the
        // Karplus primitive). The re-pushed graph node must NOT carry the stale piano
        // sampler asset/param, and no PCM is loaded — Karplus is note-triggered.
        const inst = graph.nodes.get('keys-1') as GraphNode;
        inst.data = { ...inst.data, instrumentId: 'gm-harpsichord' };
        port.posted.length = 0;
        fireNodeChange();

        const graphMsg = [...port.posted].reverse().find((m) => m.type === 'graph');
        expect(graphMsg, 'a graph was re-pushed for the Karplus switch').toBeTruthy();
        const pushed = JSON.parse(new TextDecoder().decode(graphMsg!.bytes as Uint8Array)) as OjGraph;
        const karplus = pushed.nodes.find((n) => n.id === node)!;
        expect(karplus.kind).toBe('KarplusString');
        expect(karplus.assets.some((a) => a.slot === 0), 'no stale sampler asset on Karplus').toBe(
            false,
        );
        expect(karplus.params.some((p) => p.id === 16), 'no stale root-note param on Karplus').toBe(
            false,
        );
        expect(port.posted.some((m) => m.type === 'load-sample'), 'Karplus loads no PCM').toBe(false);
        ex.dispose();
    });
});
