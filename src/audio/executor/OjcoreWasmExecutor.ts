/**
 * OjcoreWasmExecutor (U17) — the wasm/AudioWorklet ojcore path for the browser.
 *
 * Runs the SAME `ojcore` engine the native backend runs, but compiled to wasm32
 * and hosted in an `AudioWorkletProcessor` (see `../worklets/ojcore-processor.ts`)
 * that renders directly into the existing AudioContext destination. This is the
 * browser A/B alternative to Web Audio: the graph is lowered to an `OjGraph` and
 * `load_graph`'d into the worklet; the note/param seam becomes `RtCommand`s the
 * worklet's `process` drains.
 *
 * ── Cross-origin isolation (SharedArrayBuffer) ───────────────────────────────
 * The true zero-latency control path uses a `SharedArrayBuffer` ring over the
 * wasm linear memory, which requires the page to be CROSS-ORIGIN ISOLATED
 * (`crossOriginIsolated === true`), i.e. served with:
 *     Cross-Origin-Opener-Policy: same-origin
 *     Cross-Origin-Embedder-Policy: require-corp
 * `vite.config.ts` adds these headers for `dev` and `preview`; PRODUCTION hosting
 * must serve them too (documented in vite.config.ts). This build ships the
 * postMessage fallback for the control transport (functional without SAB — see
 * the worklet header for the upgrade path), so it still works if isolation is
 * absent; `crossOriginIsolated` is logged for diagnostics.
 *
 * ── Build the wasm module ────────────────────────────────────────────────────
 *     bash src/audio/wasm/build-wasm.sh            # debug
 *     bash src/audio/wasm/build-wasm.sh --release  # optimized
 * emits `src/audio/wasm/pkg/ojcore_wasm.js` + `ojcore_wasm_bg.wasm`, committed so
 * the app builds without the Rust toolchain.
 */

import type { Connection, GraphNode } from '../../engine/types';
import type {
    Executor,
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe,
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    SignalLevelsCallback,
} from './Executor';
import { getAudioContext } from '../audioContext';
import { emitWithIndex, remapForBackend, resolveKeyboardNotes, type NodeIdxMap } from '../ojgraph';
import type { NodeIdx, OjGraph, RtCommand } from '../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreCapabilityRegistry,
    monoPcmToWavBlob,
    type OjcoreBridge,
} from './ojcoreHandles';

// Vite resolves these to URLs/assets at build time.
// The worklet processor module (bundled as an ES module worklet).
import ojcoreProcessorUrl from '../worklets/ojcore-processor.ts?worker&url';
// The compiled wasm bytes (committed; produced by build-wasm.sh).
import ojcoreWasmUrl from '../wasm/pkg/ojcore_wasm_bg.wasm?url';

/** Render quantum the AudioWorklet uses (the spec-fixed block size). */
const WORKLET_BLOCK_SIZE = 128;

export class OjcoreWasmExecutor implements Executor {
    private getNodes: (() => Map<string, GraphNode>) | null = null;
    private getConnections: (() => Map<string, Connection>) | null = null;
    private unsub: Unsubscribe | null = null;

    private node: AudioWorkletNode | null = null;
    private ready = false;
    /** Graphs requested before the worklet was ready are coalesced to the last. */
    private pendingGraph: OjGraph | null = null;
    private index: NodeIdxMap = new Map();
    /** Reverse map NodeIdx -> visual node id, for routing meter frames back. */
    private reverseIndex = new Map<number, string>();
    private signalCallbacks = new Set<SignalLevelsCallback>();
    /** Latest per-node levels, keyed by visual node id (for meter delivery). */
    private levels = new Map<string, number>();
    private encoder = new TextEncoder();
    /** Pending recorder-capture resolvers, keyed by NodeIdx, for the worklet's
     *  `recorder-data` reply. */
    private captureResolvers = new Map<number, (blob: Blob | null) => void>();

    /** The engine-side seam the capability handles drive (wasm impl). */
    private readonly bridge: OjcoreBridge = {
        nodeIndex: (nodeId) => this.index.get(nodeId),
        sendCommand: (cmd) => this.send(cmd),
        loadSample: (nodeId, pcm, sampleRate, rootNote) =>
            this.loadSampleWasm(nodeId, pcm, sampleRate, rootNote),
        startCapture: (nodeId) => this.captureStartWasm(nodeId),
        stopCapture: (nodeId) => this.captureStopWasm(nodeId),
    };

    private readonly caps = new OjcoreCapabilityRegistry(this.bridge);

    // --- Lifecycle ---------------------------------------------------------

    initialize(
        subscribeToConnections: (callback: ConnectionChangeCallback) => Unsubscribe,
        subscribeToNodes: (callback: NodeChangeCallback) => Unsubscribe,
        getNodes: () => Map<string, GraphNode>,
        getConnections: () => Map<string, Connection>,
    ): void {
        this.getNodes = getNodes;
        this.getConnections = getConnections;

        if (typeof globalThis.crossOriginIsolated !== 'undefined' && !globalThis.crossOriginIsolated) {
            console.warn(
                '[OjcoreWasmExecutor] page is NOT cross-origin isolated; running the ' +
                    'postMessage control fallback. Serve COOP/COEP headers to enable the ' +
                    'SharedArrayBuffer fast path (see vite.config.ts).',
            );
        }

        // Begin async worklet setup; graph pushes coalesce until it is ready.
        void this.setup().catch((err: unknown) => {
            console.error('[OjcoreWasmExecutor] worklet setup failed:', err);
        });

        const unsubNodes = subscribeToNodes(() => this.pushGraph());
        const unsubConns = subscribeToConnections(() => this.pushGraph());
        this.unsub = () => {
            unsubNodes();
            unsubConns();
        };

        // Initial reconcile (queued until the worklet is ready).
        this.pushGraph();
    }

    private async setup(): Promise<void> {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('no AudioContext');

        await ctx.audioWorklet.addModule(ojcoreProcessorUrl);
        const node = new AudioWorkletNode(ctx, 'ojcore-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        this.node = node;

        node.port.onmessage = (e: MessageEvent) => {
            const data = e.data as {
                type?: string;
                ok?: boolean;
                message?: string;
                levels?: Array<{ node: number; peak: number }>;
                node?: number;
                pcm?: Float32Array;
                sampleRate?: number;
            };
            switch (data.type) {
                case 'ready':
                    this.ready = true;
                    // Enable the worklet's meter emission for the level stream.
                    node.port.postMessage({ type: 'meters', enabled: true });
                    // Flush any graph that arrived before the worklet was ready.
                    if (this.pendingGraph) {
                        this.sendGraph(this.pendingGraph);
                        this.pendingGraph = null;
                    }
                    break;
                case 'meters':
                    this.onMeterFrame(data.levels ?? []);
                    break;
                case 'recorder-data':
                    this.onRecorderData(data.node, data.pcm, data.sampleRate);
                    break;
                case 'error':
                    console.error('[OjcoreWasmExecutor] worklet error:', data.message);
                    break;
            }
        };

        // Fetch + compile the wasm to a transferable Module and hand it to the
        // worklet to instantiate synchronously on its own thread.
        const resp = await fetch(ojcoreWasmUrl);
        const bytes = await resp.arrayBuffer();
        const module = await WebAssembly.compile(bytes);
        node.port.postMessage({ type: 'init', module, blockSize: WORKLET_BLOCK_SIZE });

        // Route the engine output into the speakers (speaker-terminated).
        node.connect(ctx.destination);
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        try {
            this.node?.disconnect();
        } catch {
            // already disconnected
        }
        this.node = null;
        this.ready = false;
        this.pendingGraph = null;
        this.signalCallbacks.clear();
        this.levels.clear();
        this.caps.clear();
        // Resolve any in-flight captures so callers are not left hanging.
        for (const resolve of this.captureResolvers.values()) resolve(null);
        this.captureResolvers.clear();
        this.getNodes = null;
        this.getConnections = null;
        this.index = new Map();
        this.reverseIndex = new Map();
    }

    // --- Graph push --------------------------------------------------------

    private pushGraph(): void {
        if (!this.getNodes || !this.getConnections) return;
        const { graph, index } = emitWithIndex(this.getNodes(), this.getConnections(), {
            blockSize: WORKLET_BLOCK_SIZE,
        });
        this.index = index;
        this.reverseIndex = new Map();
        for (const [id, idx] of index) this.reverseIndex.set(idx, id);
        const wasmGraph = remapForBackend(graph, 'wasm');
        if (this.ready) {
            this.sendGraph(wasmGraph);
        } else {
            this.pendingGraph = wasmGraph; // coalesce to latest until ready
        }
    }

    /** Route worklet meter frames to signal-level subscribers, keyed by node id. */
    private onMeterFrame(levels: Array<{ node: number; peak: number }>): void {
        let changed = false;
        for (const { node, peak } of levels) {
            const nodeId = this.reverseIndex.get(node);
            if (nodeId === undefined) continue;
            this.levels.set(nodeId, Math.max(0, Math.min(1, peak)));
            changed = true;
        }
        if (changed && this.signalCallbacks.size > 0) {
            const snapshot = new Map(this.levels);
            for (const cb of this.signalCallbacks) cb(snapshot);
        }
    }

    /** Resolve a pending recorder capture with the worklet-returned PCM. */
    private onRecorderData(node?: number, pcm?: Float32Array, sampleRate?: number): void {
        if (node === undefined) return;
        const resolve = this.captureResolvers.get(node);
        if (!resolve) return;
        this.captureResolvers.delete(node);
        if (!pcm || pcm.length === 0) {
            resolve(null);
            return;
        }
        const ctx = getAudioContext();
        resolve(monoPcmToWavBlob(pcm, sampleRate ?? ctx?.sampleRate ?? 48000));
    }

    private sendGraph(graph: OjGraph): void {
        if (!this.node) return;
        const bytes = this.encoder.encode(JSON.stringify(graph));
        this.node.port.postMessage({ type: 'graph', bytes }, [bytes.buffer]);
    }

    private send(cmd: RtCommand): void {
        if (!this.node || !this.ready) return;
        const bytes = this.encoder.encode(JSON.stringify(cmd));
        this.node.port.postMessage({ type: 'command', bytes }, [bytes.buffer]);
    }

    // --- Note / control input ---------------------------------------------

    noteOn(keyboardId: string, row: number, keyIndex: number, velocity: number = 0.8): void {
        if (!this.getNodes || !this.getConnections) return;
        const notes = resolveKeyboardNotes(
            keyboardId,
            row,
            keyIndex,
            velocity,
            this.getNodes(),
            this.getConnections(),
        );
        for (const n of notes) {
            const idx = this.index.get(n.targetNodeId);
            if (idx === undefined) continue;
            this.send({ NoteOn: { node: idx, note: n.midiNote, vel: Math.round(n.velocity * 127) } });
        }
    }

    noteOff(keyboardId: string, row: number, keyIndex: number): void {
        if (!this.getNodes || !this.getConnections) return;
        const notes = resolveKeyboardNotes(
            keyboardId,
            row,
            keyIndex,
            1,
            this.getNodes(),
            this.getConnections(),
        );
        for (const n of notes) {
            const idx = this.index.get(n.targetNodeId);
            if (idx === undefined) continue;
            this.send({ NoteOff: { node: idx, note: n.midiNote } });
        }
    }

    controlDown(_keyboardId: string): void {}
    controlUp(_keyboardId: string): void {}

    activateControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 1);
    }
    releaseControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 0);
    }
    private emitSignal(connectionId: string, level: number): void {
        this.levels.set(connectionId, level);
        if (this.signalCallbacks.size === 0) return;
        const snapshot = new Map(this.levels);
        for (const cb of this.signalCallbacks) cb(snapshot);
    }

    // --- Speaker output ----------------------------------------------------
    // The wasm engine renders into the AudioContext destination; master volume is
    // a worklet `gain` message (the SpeakerOut node is unparameterized). Device
    // selection (`setSinkId`) is an AudioContext-level concern handled by the
    // shell; the worklet just scales its master.
    setSpeakerVolume(_nodeId: string, volume: number, isMuted: boolean): void {
        this.node?.port.postMessage({ type: 'master-gain', gain: isMuted ? 0 : volume });
    }
    // TODO(wasm-parity): per-speaker-node device routing needs `AudioContext.
    // setSinkId` plumbing in the shell; the worklet renders to one destination.
    setSpeakerDevice(_nodeId: string, _deviceId: string): void {}

    // --- Signal level metering --------------------------------------------
    subscribeSignalLevels(callback: SignalLevelsCallback): Unsubscribe {
        this.signalCallbacks.add(callback);
        callback(new Map(this.levels));
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    // TODO(wasm-parity): mic capture into the worklet needs a `MediaStreamSource`
    // -> worklet input wiring; the engine currently renders synthesis-only. The
    // node id is recorded so the routing can be added without a UI change.
    setMicrophoneOutput(_nodeId: string, _outputNode: AudioNode): void {}

    // --- Continuous sources ------------------------------------------------
    pauseContinuousSources(): void {
        this.send('TransportPause');
    }
    resumeContinuousSources(): void {
        this.send('TransportPlay');
    }

    // --- Capability handles ------------------------------------------------
    // Real, never-null handles backed by the wasm worklet engine.
    getSamplerAdapter(nodeId: string): SamplerHandle {
        return this.caps.sampler(nodeId);
    }
    waitForSamplerAdapter(nodeId: string, _timeoutMs?: number): Promise<SamplerHandle | null> {
        return Promise.resolve(this.caps.sampler(nodeId));
    }
    getLooper(nodeId: string): LooperHandle {
        return this.caps.looper(nodeId);
    }
    getRecorder(nodeId: string): RecorderHandle {
        return this.caps.recorder(nodeId);
    }

    /** Forward a decoded buffer from a source node to every connected sampler. */
    sendSampleBuffer(sourceNodeId: string, buffer: AudioBuffer): void {
        if (!this.getNodes || !this.getConnections) return;
        const connections = this.getConnections();
        const nodes = this.getNodes();
        for (const conn of connections.values()) {
            if (conn.sourceNodeId !== sourceNodeId) continue;
            const target = nodes.get(conn.targetNodeId);
            if (target?.type === 'sampler') {
                this.caps.sampler(conn.targetNodeId).setBuffer(buffer);
            }
        }
    }

    // --- Wasm command backings for the capability bridge -------------------

    /** Transfer mono PCM into the worklet to install as `nodeId`'s sampler. */
    private loadSampleWasm(
        nodeId: string,
        pcm: Float32Array,
        sampleRate: number,
        rootNote: number,
    ): Promise<void> {
        const idx = this.index.get(nodeId);
        if (idx === undefined || !this.node || !this.ready) return Promise.resolve();
        // Zero-copy transfer of the PCM into the worklet (off the render path).
        const copy = pcm.slice();
        this.node.port.postMessage(
            { type: 'load-sample', node: idx, pcm: copy, sampleRate, rootNote },
            [copy.buffer],
        );
        return Promise.resolve();
    }

    /** Tell the worklet to begin capturing `nodeId`'s output bus. */
    private captureStartWasm(nodeId: string): void {
        const idx = this.index.get(nodeId);
        if (idx === undefined || !this.node) return;
        this.node.port.postMessage({ type: 'recorder-start', node: idx });
    }

    /** Stop the worklet capture; resolves when the worklet returns the PCM. */
    private captureStopWasm(nodeId: string): Promise<Blob | null> {
        const idx = this.index.get(nodeId);
        if (idx === undefined || !this.node) return Promise.resolve(null);
        return new Promise<Blob | null>((resolve) => {
            this.captureResolvers.set(idx as NodeIdx, resolve);
            this.node?.port.postMessage({ type: 'recorder-stop', node: idx });
            // Safety timeout: never leave the UI hanging if the worklet is silent.
            setTimeout(() => {
                if (this.captureResolvers.has(idx as NodeIdx)) {
                    this.captureResolvers.delete(idx as NodeIdx);
                    resolve(null);
                }
            }, 2000);
        });
    }
}
