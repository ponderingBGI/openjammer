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
 *  2. MIC INPUT: `setMicrophoneOutput` opens `getUserMedia` and wires the
 *     `MediaStreamSource` into the worklet input on success; on permission denial
 *     it does NOT throw and leaves the mic unrouted.
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

/** A stereo-ish fake AudioBuffer the sampler handle downmixes to mono PCM. */
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
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
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
        expect(load!.sampleRate).toBe(44100);
        expect(load!.rootNote).toBe(60);
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

describe('OjcoreWasmExecutor microphone input (mocked getUserMedia)', () => {
    beforeEach(() => {
        MockWorkletNode.last = null;
        fakeMediaStreamSource.connect.mockClear();
        vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })));
        vi.stubGlobal('WebAssembly', { ...globalThis.WebAssembly, compile: vi.fn(() => Promise.resolve({})) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('grants: wires the MediaStreamSource into the worklet input', async () => {
        const tracks = [{ stop: vi.fn() }];
        const stream = { getTracks: () => tracks } as unknown as MediaStream;
        const getUserMedia = vi.fn(() => Promise.resolve(stream));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        ex.setMicrophoneOutput('mic-1', {} as AudioNode);
        await Promise.resolve();
        await Promise.resolve();

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(fakeContext.createMediaStreamSource).toHaveBeenCalledWith(stream);
        expect(fakeMediaStreamSource.connect).toHaveBeenCalledTimes(1);
        ex.dispose();
        // dispose stops the captured tracks.
        expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('denied: does not throw and leaves the mic unrouted', async () => {
        const getUserMedia = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const { OjcoreWasmExecutor } = await import('../OjcoreWasmExecutor');
        const ex = new OjcoreWasmExecutor();
        await bringUp(ex, micGraph());

        // Must not throw synchronously...
        expect(() => ex.setMicrophoneOutput('mic-1', {} as AudioNode)).not.toThrow();
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
        expect(() => ex.setMicrophoneOutput('mic-1', {} as AudioNode)).not.toThrow();
        await Promise.resolve();
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
            vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })),
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
});
