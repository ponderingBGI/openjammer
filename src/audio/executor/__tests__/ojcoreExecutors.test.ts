/**
 * U-EXEC-PARITY gate tests.
 *
 * Pin the ojcore executors' capability parity against the {@link Executor}
 * interface, the level the founder's native (low-latency, device-dependent:
 * sub-5 ms when the device grants a small 64-frame buffer, ~10 ms+ otherwise) app
 * depends on:
 *
 *  1. Each ojcore executor returns a NON-NULL handle from getLooper /
 *     getRecorder / getSamplerAdapter (never null/throw — the seam stays whole).
 *  2. A looper handle's actions map to the right `RtCommand::Looper` payloads
 *     (arm/record/stop/clear/overdub) and a sampler handle's config maps to
 *     `SetParam`s — over the SHARED bridge both backends use.
 *  3. The native meter subscription delivers per-node levels from a MOCKED
 *     `poll_meters` invoke (the engine -> UI level stream).
 *  4. The mocked-Tauri-invoke path: `getInvoke` resolves the global bridge and
 *     looper/sample/recorder/speaker/mic commands reach `invoke` with the right
 *     command name + args.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { LooperAction } from '../../../../packages/oj-protocol-ts/src/index';
import type { RtCommand, EngineFrame } from '../../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreLooperHandle,
    OjcoreSamplerHandle,
    OjcoreRecorderHandle,
    OjcoreCapabilityRegistry,
    type OjcoreBridge,
} from '../ojcoreHandles';
import { OjcoreNativeExecutor } from '../OjcoreNativeExecutor';
import { OjcoreWasmExecutor } from '../OjcoreWasmExecutor';
import { getNodeDefinition } from '../../../engine/registry';
import type { Connection, GraphNode, NodeType } from '../../../engine/types';
import { useEngineHealthStore } from '../../../store/engineHealthStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a GraphNode from the real registry definition (ports + default data). */
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

/** A spying mock of the shared engine bridge for handle-level tests. */
function mockBridge(): { bridge: OjcoreBridge; sent: RtCommand[]; loaded: unknown[] } {
    const sent: RtCommand[] = [];
    const loaded: unknown[] = [];
    const bridge: OjcoreBridge = {
        // Every visual id maps to a fixed NodeIdx so command payloads are stable.
        nodeIndex: () => 7,
        sendCommand: (cmd) => {
            sent.push(cmd);
        },
        nodeLevel: () => 0,
        loadSample: (nodeId, pcm, sampleRate, rootNote, channels) => {
            loaded.push({ nodeId, len: pcm.length, sampleRate, rootNote, channels });
            return Promise.resolve();
        },
        startCapture: () => {},
        stopCapture: () => Promise.resolve(null),
    };
    return { bridge, sent, loaded };
}

// ---------------------------------------------------------------------------
// 1) Non-null handles
// ---------------------------------------------------------------------------

describe('ojcore executors return real (never-null) capability handles', () => {
    for (const make of [
        ['OjcoreNativeExecutor', () => new OjcoreNativeExecutor()] as const,
        ['OjcoreWasmExecutor', () => new OjcoreWasmExecutor()] as const,
    ]) {
        const [name, ctor] = make;
        it(`${name}: getLooper / getRecorder / getSamplerAdapter are non-null`, () => {
            const ex = ctor();
            expect(ex.getLooper('n1')).not.toBeNull();
            expect(ex.getRecorder('n1')).not.toBeNull();
            expect(ex.getSamplerAdapter('n1')).not.toBeNull();
        });

        it(`${name}: returns the SAME handle for repeated calls (stateful)`, () => {
            const ex = ctor();
            expect(ex.getLooper('n1')).toBe(ex.getLooper('n1'));
            expect(ex.getRecorder('n1')).toBe(ex.getRecorder('n1'));
            expect(ex.getSamplerAdapter('n1')).toBe(ex.getSamplerAdapter('n1'));
        });

        it(`${name}: waitForSamplerAdapter resolves a non-null handle`, async () => {
            const ex = ctor();
            await expect(ex.waitForSamplerAdapter('n1')).resolves.not.toBeNull();
        });
    }
});

// ---------------------------------------------------------------------------
// 2) Looper actions -> RtCommand::Looper ; sampler config -> SetParam
// ---------------------------------------------------------------------------

describe('looper handle maps actions to the right RtCommand::Looper', () => {
    it('record sends RECORD (not ARM); stop sends STOP', async () => {
        const { bridge, sent } = mockBridge();
        const looper = new OjcoreLooperHandle('looper-1', bridge);

        await looper.startRecording();
        // New engine-driven flow: RECORD only — ARM would clear existing layers.
        expect(sent).toEqual([{ Looper: { node: 7, action: LooperAction.RECORD, arg: 0 } }]);

        sent.length = 0;
        looper.stopRecording();
        expect(sent).toEqual([{ Looper: { node: 7, action: LooperAction.STOP, arg: 0 } }]);
    });

    it('deleting a loop sends the indexed DELETE_LAYER command', async () => {
        const { bridge, sent } = mockBridge();
        const looper = new OjcoreLooperHandle('looper-1', bridge);
        await looper.startRecording();
        looper.stopRecording();
        // The row is created by the engine commit edge, not stopRecording.
        looper.onEngineEdge(2 /* RECORDING */, 3 /* PLAYING */);
        const loops = looper.getLoops();
        expect(loops).toHaveLength(1);

        sent.length = 0;
        looper.deleteLoop(loops[0].id);
        expect(sent).toEqual([
            { Looper: { node: 7, action: LooperAction.DELETE_LAYER, arg: 0 } },
        ]);
        expect(looper.getLoops()).toHaveLength(0);
    });

    it('the engine commit edge (RECORDING -> PLAYING) mirrors a loop layer the UI can render', async () => {
        const { bridge } = mockBridge();
        const looper = new OjcoreLooperHandle('looper-1', bridge);
        const added: string[] = [];
        looper.setOnLoopAdded((l) => added.push(l.id));
        await looper.startRecording();
        // The engine streams live-trace frames during the pass (the real meter
        // peak per block); these accumulate and build the committed row's waveform.
        looper.onEngineFrame(2 /* RECORDING */, 10, 480, 0.4);
        looper.onEngineFrame(2 /* RECORDING */, 20, 480, 0.6);
        looper.stopRecording();
        // No row yet — stopRecording only sends STOP.
        expect(added).toHaveLength(0);
        // The authoritative commit creates the row, carrying the live trace (the
        // TRUE captured PCM upgrades the shape later on its own seam).
        looper.onEngineEdge(2 /* RECORDING */, 3 /* PLAYING */);
        expect(added).toHaveLength(1);
        const [loop] = looper.getLoops();
        expect(loop.waveformData.length).toBeGreaterThan(0);
        expect(loop.isMuted).toBe(false);
    });
});

describe('sampler handle maps config to SetParam and loads PCM', () => {
    it('setRootNote / setGain / setAttack / setRelease send SetParam', () => {
        const { bridge, sent } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);

        sampler.setRootNote(48);
        sampler.setGain(0.5);
        sampler.setAttack(0.02);
        sampler.setRelease(0.3);

        // node is the fixed mock NodeIdx 7; param ids mirror the engine sampler.
        expect(sent).toEqual([
            { SetParam: { node: 7, param: 16, value: 48 } }, // ROOT_NOTE
            { SetParam: { node: 7, param: 0, value: 0.5 } }, // GAIN
            { SetParam: { node: 7, param: 1, value: 0.02 } }, // ATTACK
            { SetParam: { node: 7, param: 3, value: 0.3 } }, // RELEASE
        ]);
    });

    it('setBuffer interleaves a stereo buffer and lowers it into the engine', () => {
        const { bridge, loaded } = mockBridge();
        const sampler = new OjcoreSamplerHandle('sampler-1', bridge);
        const fakeBuffer = {
            numberOfChannels: 2,
            length: 4,
            sampleRate: 44100,
            getChannelData: () => new Float32Array([0.5, 0.5, 0.5, 0.5]),
        } as unknown as AudioBuffer;

        sampler.setBuffer(fakeBuffer);
        expect(sampler.getBuffer()).toBe(fakeBuffer);
        // Interleaved (no downmix): 4 frames x 2 channels = 8 samples, channels = 2,
        // so a stereo sample plays in true stereo (parity with the native catalog).
        expect(loaded).toEqual([
            { nodeId: 'sampler-1', len: 8, sampleRate: 44100, rootNote: 60, channels: 2 },
        ]);

        // Clearing the buffer does not attempt a load.
        loaded.length = 0;
        sampler.setBuffer(null);
        expect(sampler.getBuffer()).toBeNull();
        expect(loaded).toHaveLength(0);
    });
});

describe('recorder handle captures via the bridge and surfaces a blob', () => {
    it('start/stop drives the bridge and completes with a recording', async () => {
        const captured: string[] = [];
        const bridge: OjcoreBridge = {
            nodeIndex: () => 7,
            sendCommand: () => {},
            nodeLevel: () => 0,
            loadSample: () => Promise.resolve(),
            startCapture: (id) => captured.push(`start:${id}`),
            stopCapture: (id) => {
                captured.push(`stop:${id}`);
                return Promise.resolve(new Blob(['x'], { type: 'audio/wav' }));
            },
        };
        const recorder = new OjcoreRecorderHandle('rec-1', bridge);
        const done = new Promise<void>((resolve) => {
            recorder.setOnRecordingComplete(() => resolve());
        });
        recorder.startRecording();
        expect(recorder.getIsRecording()).toBe(true);
        recorder.stopRecording();
        await done;
        expect(captured).toEqual(['start:rec-1', 'stop:rec-1']);
        expect(recorder.getRecordings()).toHaveLength(1);
        expect(recorder.getRecordingBlob(recorder.getRecordings()[0].id)).not.toBeNull();
    });
});

describe('OjcoreCapabilityRegistry caches one handle per node id', () => {
    it('returns identical handles per id and clears them', () => {
        const { bridge } = mockBridge();
        const reg = new OjcoreCapabilityRegistry(bridge);
        const a = reg.looper('x');
        expect(reg.looper('x')).toBe(a);
        expect(reg.looper('y')).not.toBe(a);
        reg.clear();
        expect(reg.looper('x')).not.toBe(a);
    });
});

// ---------------------------------------------------------------------------
// 3) + 4) Mocked-Tauri-invoke path: commands + meter delivery
// ---------------------------------------------------------------------------

interface InvokeCall {
    cmd: string;
    args: Record<string, unknown> | undefined;
}

/** Install a mock `window.__TAURI__.core.invoke` and capture every call. */
function installMockTauri(
    handler?: (cmd: string, args?: Record<string, unknown>) => unknown,
): InvokeCall[] {
    const calls: InvokeCall[] = [];
    const invoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return Promise.resolve(handler ? handler(cmd, args) : undefined);
    });
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    return calls;
}

/** A looper -> speaker graph so the looper interns to a stable NodeIdx. */
function looperGraph(): {
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
} {
    const looper = makeNode('looper', 'looper-1');
    const speaker = makeNode('speaker', 'speaker-1');
    const inPort = looper.ports.find((p) => p.direction === 'input');
    const outPort = looper.ports.find((p) => p.direction === 'output');
    const spkIn = speaker.ports.find((p) => p.direction === 'input');
    const conns = new Map<string, Connection>();
    if (outPort && spkIn) {
        const c = makeConn(looper.id, outPort.id, speaker.id, spkIn.id);
        conns.set(c.id, c);
    }
    void inPort;
    return {
        nodes: new Map([
            [looper.id, looper],
            [speaker.id, speaker],
        ]),
        connections: conns,
    };
}

describe('OjcoreNativeExecutor over a mocked Tauri invoke', () => {
    beforeEach(() => {
        useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
    });

    afterEach(() => {
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
        vi.useRealTimers();
    });

    function initWith(
        ex: OjcoreNativeExecutor,
        graph: { nodes: Map<string, GraphNode>; connections: Map<string, Connection> },
    ): void {
        ex.initialize(
            () => () => {},
            () => () => {},
            () => graph.nodes,
            () => graph.connections,
        );
    }

    /** Let the initial `push_graph` invoke resolve so the executor commits its
     *  NodeIdx interning (the index/reverseIndex are committed only AFTER the
     *  engine accepts the graph, so command addressing is live only post-flush). */
    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    it('pushes the graph on initialize via push_graph', () => {
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        expect(calls.some((c) => c.cmd === 'push_graph')).toBe(true);
        ex.dispose();
    });

    it('looper handle record/stop reach send_command with RtCommand::Looper', async () => {
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush(); // commit the interning once the push is accepted

        const looper = ex.getLooper('looper-1');
        expect(looper).not.toBeNull();
        await looper!.startRecording();
        looper!.stopRecording();

        type LooperCmd = Extract<RtCommand, { Looper: unknown }>;
        const looperCmds = calls
            .filter((c) => c.cmd === 'send_command')
            .map((c) => c.args?.cmd as RtCommand)
            .filter(
                (cmd): cmd is LooperCmd =>
                    typeof cmd === 'object' && cmd !== null && 'Looper' in cmd,
            );
        const actions = looperCmds.map((c) => c.Looper.action);
        // New engine-driven flow: RECORD (never ARM) then STOP.
        expect(actions).not.toContain(LooperAction.ARM);
        expect(actions).toContain(LooperAction.RECORD);
        expect(actions).toContain(LooperAction.STOP);
        // Every looper command addresses the same interned NodeIdx.
        const idxs = new Set(looperCmds.map((c) => c.Looper.node));
        expect(idxs.size).toBe(1);
        ex.dispose();
    });

    it('sampler config reaches send_command and sample reaches load_sample', async () => {
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush(); // commit the interning once the push is accepted

        // Use the looper node id only to prove command addressing; the sampler
        // handle works for any node id (interned or not — null-safe).
        const sampler = ex.getSamplerAdapter('looper-1');
        sampler!.setGain(0.42);
        const setParams = calls
            .filter((c) => c.cmd === 'send_command')
            .map((c) => c.args?.cmd as RtCommand)
            .filter((cmd) => typeof cmd === 'object' && cmd !== null && 'SetParam' in cmd);
        expect(setParams.length).toBeGreaterThan(0);
        ex.dispose();
    });

    it('speaker volume / device / mic reach their commands', async () => {
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush(); // commit the interning once the push is accepted

        ex.setSpeakerVolume('speaker-1', 0.7, false);
        ex.setSpeakerDevice('speaker-1', 'dev-2');
        ex.setMicrophoneInput('looper-1', { isMuted: false });

        expect(calls.some((c) => c.cmd === 'set_speaker_volume')).toBe(true);
        expect(calls.some((c) => c.cmd === 'set_speaker_device')).toBe(true);
        expect(calls.some((c) => c.cmd === 'set_mic')).toBe(true);
        ex.dispose();
    });

    it('speaker volume forwards volume + muted to set_speaker_volume (engine bakes master VOLUME/MUTE)', async () => {
        // The native engine's `set_speaker_volume` routes BOTH a SetParam(master
        // VOLUME=0) and SetParam(master MUTE=1) to the live engine (engine.rs), so
        // volume is applied ONCE by exec.rs `master_gain`. Here we pin the IPC seam:
        // the executor forwards the UI's volume + mute intent verbatim.
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush();

        ex.setSpeakerVolume('speaker-1', 0.3, false);
        ex.setSpeakerVolume('speaker-1', 0.9, true);

        const volCalls = calls.filter((c) => c.cmd === 'set_speaker_volume');
        expect(volCalls).toHaveLength(2);
        // Live: volume passed through, muted false.
        expect(volCalls[0].args).toMatchObject({ volume: 0.3, muted: false });
        // Muted: the executor sends volume 0 + muted true (engine forces gain to 0).
        expect(volCalls[1].args).toMatchObject({ volume: 0, muted: true });
        // Every call addresses the interned SpeakerOut NodeIdx (not undefined).
        expect(typeof volCalls[0].args?.node).toBe('number');
        ex.dispose();
    });

    it('mic mute maps to set_mic(enabled=false); unmute to enabled=true', async () => {
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush();

        // Unmuted intent enables the engine mic; muted intent disables it — the
        // engine MicIn then reads silence, so a "muted" mic is provably off.
        ex.setMicrophoneInput('looper-1', { isMuted: false });
        ex.setMicrophoneInput('looper-1', { isMuted: true });

        const micCalls = calls.filter((c) => c.cmd === 'set_mic');
        expect(micCalls.length).toBe(2);
        expect(micCalls[0].args).toMatchObject({ enabled: true });
        expect(micCalls[1].args).toMatchObject({ enabled: false });
        ex.dispose();
    });

    it('meter subscription enables metering and delivers per-node levels', async () => {
        vi.useFakeTimers();
        const graph = looperGraph();
        // Mock poll_meters to return a Meter frame for the looper node's NodeIdx.
        // The looper interns to NodeIdx 0 (sorted ids: looper-1 < speaker-1, and
        // the speaker is structural so the looper takes the first index, 0).
        const meterFrame = (node: number): EngineFrame => ({
            Meter: { node, rms: 0.1, peak: 0.8 },
        });
        const calls = installMockTauri((cmd) => {
            if (cmd === 'poll_meters') return [meterFrame(0)];
            return undefined;
        });
        const ex = new OjcoreNativeExecutor();
        initWith(ex, graph);
        await flush(); // commit the reverse interning the poll routes meters through

        const received: Map<string, number>[] = [];
        const unsub = ex.subscribeSignalLevels((levels) => received.push(levels));

        // subscribe enabled metering.
        expect(calls.some((c) => c.cmd === 'subscribe_meters')).toBe(true);

        // Advance the meter poll loop and flush the pending poll promise.
        await vi.advanceTimersByTimeAsync(120);

        const withLooper = received.find((m) => m.has('looper-1'));
        expect(withLooper, 'a level snapshot for the looper node was delivered').toBeTruthy();
        expect(withLooper!.get('looper-1')).toBeCloseTo(0.8, 5);

        unsub();
        ex.dispose();
    });

    it('keeps a cable signal pulse alive across meter polls (merged snapshot)', async () => {
        // Regression: a held note lit its cable for only a split second because the
        // periodic meter poll emitted a node-keyed snapshot that REPLACED the
        // connection-keyed pulse in NodeCanvas. The native executor must merge both
        // into one shared map (like the wasm executor) so the pulse survives polls.
        vi.useFakeTimers();
        const graph = looperGraph();
        const meterFrame = (node: number): EngineFrame => ({
            Meter: { node, rms: 0.1, peak: 0.8 },
        });
        installMockTauri((cmd) => {
            if (cmd === 'poll_meters') return [meterFrame(0)];
            return undefined;
        });
        const ex = new OjcoreNativeExecutor();
        initWith(ex, graph);
        await flush(); // commit the reverse interning the poll routes meters through

        const received: Map<string, number>[] = [];
        const unsub = ex.subscribeSignalLevels((levels) => received.push(levels));

        // Light a cable (as a held note would) — the immediate emit carries it.
        ex.activateControlSignal('conn-test');
        expect(received.at(-1)!.get('conn-test')).toBe(1);

        // A meter poll fires while the note is STILL held: it must not wipe the pulse.
        await vi.advanceTimersByTimeAsync(120);
        const afterPoll = received.at(-1)!;
        expect(afterPoll.get('conn-test'), 'cable pulse survives the meter poll').toBe(1);
        expect(afterPoll.get('looper-1'), 'and the meter level is merged in').toBeCloseTo(0.8, 5);

        // Release zeroes the pulse (still present in the merged snapshot, just 0).
        ex.releaseControlSignal('conn-test');
        expect(received.at(-1)!.get('conn-test')).toBe(0);

        unsub();
        ex.dispose();
    });

    it('a REJECTED push leaves meter routing on the last good graph', async () => {
        // Regression: the NodeIdx interning (index/reverseIndex) used to be committed
        // BEFORE `push_graph` was accepted, so a rejected push left meter-frame
        // routing pointed at a graph the engine never adopted. The interning must
        // commit ONLY on acceptance — a rejected edit keeps the last good routing.
        vi.useFakeTimers();
        const graph = looperGraph();
        const meterFrame = (node: number): EngineFrame => ({
            Meter: { node, rms: 0.1, peak: 0.8 },
        });
        // Accept the FIRST push_graph (graph A) and REJECT the second (the edit we
        // add below), as the engine would on a Compile/RingFull error. poll_meters
        // always reports a frame for NodeIdx 0.
        let pushes = 0;
        const calls = installMockTauri((cmd) => {
            if (cmd === 'poll_meters') return [meterFrame(0)];
            if (cmd === 'push_graph') {
                pushes += 1;
                if (pushes >= 2) return Promise.reject(new Error('Compile'));
            }
            return undefined;
        });
        // Capture the node-change subscription so we can fire a second push.
        let nodeCb: (() => void) | null = null;
        const ex = new OjcoreNativeExecutor();
        ex.initialize(
            () => () => {},
            (cb) => {
                nodeCb = cb as unknown as () => void;
                return () => {};
            },
            () => graph.nodes,
            () => graph.connections,
        );
        await flush(); // first push accepted: reverseIndex maps 0 -> 'looper-1'

        const received: Map<string, number>[] = [];
        const unsub = ex.subscribeSignalLevels((levels) => received.push(levels));
        await vi.advanceTimersByTimeAsync(120);
        expect(received.at(-1)!.get('looper-1')).toBeCloseTo(0.8, 5);

        // Add a 'keys' node (sorts before 'looper-1', so the NEW interning would map
        // NodeIdx 0 -> 'keys-1'); fire the edit. The engine REJECTS this push.
        graph.nodes.set('keys-1', makeNode('keys', 'keys-1'));
        nodeCb!();
        await flush();
        expect(calls.filter((c) => c.cmd === 'push_graph')).toHaveLength(2);

        // The rejected interning was never committed: a meter frame for NodeIdx 0
        // still routes to 'looper-1' (NOT 'keys-1'), holding the last good routing.
        received.length = 0;
        await vi.advanceTimersByTimeAsync(120);
        const latest = received.at(-1)!;
        expect(latest.get('looper-1'), 'last good routing held after rejection').toBeCloseTo(
            0.8,
            5,
        );
        expect(latest.has('keys-1'), 'rejected interning was not committed').toBe(false);

        unsub();
        ex.dispose();
    });

    it('routes a drained Looper frame to the looper handle onEngineFrame (ungated by meters)', async () => {
        // The single meter ring now carries Meter AND Looper frames; the executor
        // must route a Looper frame to the handle WITHOUT any signal-level
        // subscriber mounted (the row/playhead surfaces even with meters off).
        vi.useFakeTimers();
        const graph = looperGraph();
        // looper-1 interns to NodeIdx 0. poll_meters returns a Looper frame for it.
        const looperFrame: EngineFrame = {
            Looper: { node: 0, state: 3 /* PLAYING */, pos: 240, loop_len: 480, peak: 0.5 },
        };
        installMockTauri((cmd) => {
            if (cmd === 'poll_meters') return [looperFrame];
            return undefined;
        });
        const ex = new OjcoreNativeExecutor();
        initWith(ex, graph);
        await flush();

        // NO subscribeSignalLevels here — proves the looper drain is ungated.
        const looper = ex.getLooper('looper-1') as unknown as {
            getEngineState(): number;
        };
        await vi.advanceTimersByTimeAsync(120);

        // The frame's state drove the handle (3 == PLAYING).
        expect(looper.getEngineState()).toBe(3);
        ex.dispose();
    });

    it('routes a drained LooperEdge event to the looper handle onEngineEdge (creates a row)', async () => {
        // A RECORDING->PLAYING edge on the loss-proof event ring is the authoritative
        // commit: it must reach onEngineEdge and create exactly one UI row.
        vi.useFakeTimers();
        const graph = looperGraph();
        // poll_events returns one LooperEdge for the looper node (NodeIdx 0).
        const edgeEvent = {
            v: 1,
            seq: 1,
            severity: 'Info',
            kind: { LooperEdge: { node: 0, from: 2 /* RECORDING */, to: 3 /* PLAYING */ } },
            source: 'Native',
            ts_us: 0,
            corr_id: 0,
        };
        installMockTauri((cmd) => {
            if (cmd === 'poll_events') return [edgeEvent];
            return undefined;
        });
        const ex = new OjcoreNativeExecutor();
        initWith(ex, graph);
        await flush();

        const looper = ex.getLooper('looper-1');
        const added: string[] = [];
        (looper as unknown as { setOnLoopAdded(cb: (l: { id: string }) => void): void }).setOnLoopAdded(
            (l) => added.push(l.id),
        );
        // Advance past the event-drain cadence (100 ms).
        await vi.advanceTimersByTimeAsync(150);

        expect(added).toHaveLength(1);
        expect(looper.getLoops()).toHaveLength(1);
        ex.dispose();
    });

    it('a commit edge pulls the take PCM via looper_take_pcm and upgrades the row (Stage 3)', async () => {
        // On a RECORDING|OVERDUBBING -> PLAYING commit edge the native executor must
        // ALSO call `looper_take_pcm` (the take PCM rides the command RETURN, not an
        // EngineFrame) and feed the result into the handle's onLayerPcm — so the row
        // gets the TRUE waveform (and, with a context, a real buffer for drag/export).
        vi.useFakeTimers();
        const graph = looperGraph();
        // A Looper frame first establishes the cached loop_len; then the commit edge.
        const looperFrame: EngineFrame = {
            Looper: { node: 0, state: 2 /* RECORDING */, pos: 100, loop_len: 480, peak: 0.4 },
        };
        const edgeEvent = {
            v: 1,
            seq: 1,
            severity: 'Info',
            kind: { LooperEdge: { node: 0, from: 2 /* RECORDING */, to: 3 /* PLAYING */ } },
            source: 'Native',
            ts_us: 0,
            corr_id: 0,
        };
        // The take PCM the engine returns for the committed cycle (a ramp).
        const takePcm = [0, 0.3, 0.6, 0.9];
        const takeCalls: Array<Record<string, unknown> | undefined> = [];
        installMockTauri((cmd, args) => {
            if (cmd === 'poll_meters') return [looperFrame];
            if (cmd === 'poll_events') return [edgeEvent];
            if (cmd === 'looper_take_pcm') {
                takeCalls.push(args);
                return { pcm: takePcm, sample_rate: 48000 };
            }
            return undefined;
        });
        const ex = new OjcoreNativeExecutor();
        initWith(ex, graph);
        await flush();

        const looper = ex.getLooper('looper-1');
        // Advance past BOTH the meter poll (50 ms, caches loop_len) and the event
        // drain (100 ms, fires the commit edge + looper_take_pcm), then let the
        // async take fetch + onLayerPcm settle.
        await vi.advanceTimersByTimeAsync(160);
        await flush();

        // The commit edge created the row...
        expect(looper.getLoops()).toHaveLength(1);
        // ...and looper_take_pcm was invoked for node 0 with the cached loop length.
        expect(takeCalls.length).toBeGreaterThan(0);
        expect(takeCalls[0]).toMatchObject({ node: 0, loopLen: 480 });
        // The returned PCM became the row's TRUE waveform (peak == PCM peak 0.9).
        const layer = looper.getLoops()[0];
        expect(Math.max(...layer.waveformData)).toBeCloseTo(0.9, 5);
        ex.dispose();
    });

    it('a looper CLEAR discards the engine take buffer (looper_discard_pcm)', async () => {
        // A CLEAR aborts an in-flight take, so the native executor must also tell the
        // engine to discard the off-RT captured PCM — otherwise a later take inherits
        // a stale tail.
        const calls = installMockTauri();
        const ex = new OjcoreNativeExecutor();
        initWith(ex, looperGraph());
        await flush();

        // Drive a raw CLEAR through send_command (the handle has no public clear, so
        // exercise the send seam directly via a looper action the bridge forwards).
        // toggleLoopMute/delete address committed layers; CLEAR is the abort verb.
        (ex as unknown as { send(cmd: RtCommand): void }).send({
            Looper: { node: 0, action: LooperAction.CLEAR, arg: 0 },
        });

        expect(calls.some((c) => c.cmd === 'looper_discard_pcm')).toBe(true);
        const discard = calls.find((c) => c.cmd === 'looper_discard_pcm');
        expect(discard!.args).toMatchObject({ node: 0 });
        ex.dispose();
    });

    it('recovers engine health from DEGRADED to LIVE after a later accepted push', async () => {
        const graph = looperGraph();
        let pushes = 0;
        installMockTauri((cmd) => {
            if (cmd === 'push_graph') {
                pushes += 1;
                if (pushes === 2) return Promise.reject(new Error('Compile'));
            }
            return undefined;
        });
        let nodeCb: (() => void) | null = null;
        const ex = new OjcoreNativeExecutor();
        ex.initialize(
            () => () => {},
            (cb) => {
                nodeCb = cb as unknown as () => void;
                return () => {};
            },
            () => graph.nodes,
            () => graph.connections,
        );
        await flush();
        expect(useEngineHealthStore.getState().health).toBe('LIVE');

        graph.nodes.set('keys-1', makeNode('keys', 'keys-1'));
        nodeCb!();
        await flush();
        expect(useEngineHealthStore.getState().health).toBe('DEGRADED');

        graph.nodes.set('keys-2', makeNode('keys', 'keys-2'));
        nodeCb!();
        await flush();
        expect(useEngineHealthStore.getState().health).toBe('LIVE');

        ex.dispose();
    });
});

// ---------------------------------------------------------------------------
// Instrument-switch voice binding: the "switching instruments mutes / collapses
// every voice to one" regression. A melodic node's default voice is bound
// out-of-band via `load_sample` (its `instrumentId` is NOT graph data), so the
// executor's bound-voice state machine must (a) re-bind on EVERY picker change,
// even when the emitted graph is byte-identical (deduped), and (b) survive a
// round trip through a Karplus instrument without leaving the node silent.
// ---------------------------------------------------------------------------

describe('OjcoreNativeExecutor instrument-switch voice binding (mocked Tauri invoke)', () => {
    afterEach(() => {
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
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

    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    }

    function initCapturingNodeCb(
        ex: OjcoreNativeExecutor,
        graph: { nodes: Map<string, GraphNode>; connections: Map<string, Connection> },
    ): () => void {
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
        return () => nodeCb?.();
    }

    const loadSampleCalls = (calls: InvokeCall[]): InvokeCall[] =>
        calls.filter((c) => c.cmd === 'load_sample');

    it('never goes silent across a Sampler→Karplus→Sampler switch (the mute repro)', async () => {
        const calls = installMockTauri();
        const graph = instrumentGraph('gm-acoustic-grand-piano'); // a Sampler-family piano
        const ex = new OjcoreNativeExecutor();
        const fire = initCapturingNodeCb(ex, graph);
        await flush();
        // Initial: the piano default voice was bound (a load_sample fired).
        expect(loadSampleCalls(calls).length).toBeGreaterThan(0);

        // Switch to Harpsichord — a 'piano'-category instrument that lowers to the
        // Karplus primitive (note-triggered, NO PCM). The graph kind changes so the
        // push is not deduped.
        const node = graph.nodes.get('keys-1')!;
        node.data = { ...node.data, instrumentId: 'gm-harpsichord' };
        calls.length = 0;
        fire();
        await flush();
        expect(loadSampleCalls(calls), 'Karplus needs no sample load').toHaveLength(0);

        // Switch BACK to the piano. The engine forward-merges a sample binding only
        // Sampler->Sampler, so the asset is dropped on the way back; the executor
        // MUST re-bind the default voice or the node stays silent until reload.
        node.data = { ...node.data, instrumentId: 'gm-acoustic-grand-piano' };
        calls.length = 0;
        fire();
        await flush();
        expect(
            loadSampleCalls(calls).length,
            'voice re-bound on return — not silent',
        ).toBeGreaterThan(0);
        ex.dispose();
    });

    it('re-binds when switching between two instruments in one family (deduped graph)', async () => {
        const calls = installMockTauri();
        const graph = instrumentGraph('gm-acoustic-grand-piano');
        const ex = new OjcoreNativeExecutor();
        const fire = initCapturingNodeCb(ex, graph);
        await flush();

        // Switch to another piano: same family, so the emitted OjGraph is byte-
        // identical and `push_graph` is deduped — but the picker change must still
        // re-bind the per-instrument voice (load_sample), or every piano sounds the
        // same (the "they all sound the same" fix).
        const node = graph.nodes.get('keys-1')!;
        node.data = { ...node.data, instrumentId: 'gm-bright-acoustic-piano' };
        calls.length = 0;
        fire();
        await flush();
        expect(
            calls.filter((c) => c.cmd === 'push_graph'),
            'identical audio graph is deduped',
        ).toHaveLength(0);
        expect(
            loadSampleCalls(calls).length,
            'within-family switch still re-binds the voice',
        ).toBeGreaterThan(0);
        ex.dispose();
    });
});
