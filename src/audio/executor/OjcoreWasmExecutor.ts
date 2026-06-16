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
import type { Looper } from '../Looper';
import type { Recorder } from '../Recorder';
import type { SamplerAdapter } from '../samplers/SamplerAdapter';
import type {
    Executor,
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe,
} from './Executor';
import { getAudioContext } from '../AudioEngine';
import { emitWithIndex, remapForBackend, resolveKeyboardNotes, type NodeIdxMap } from '../ojgraph';
import type { OjGraph, RtCommand } from '../../../packages/oj-protocol-ts/src/index';

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
    private signalCallbacks = new Set<(levels: Map<string, number>) => void>();
    private encoder = new TextEncoder();

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
            const data = e.data as { type?: string; ok?: boolean; message?: string };
            if (data.type === 'ready') {
                this.ready = true;
                // Flush any graph that arrived before the worklet was ready.
                if (this.pendingGraph) {
                    this.sendGraph(this.pendingGraph);
                    this.pendingGraph = null;
                }
            } else if (data.type === 'error') {
                console.error('[OjcoreWasmExecutor] worklet error:', data.message);
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
        this.getNodes = null;
        this.getConnections = null;
        this.index = new Map();
    }

    // --- Graph push --------------------------------------------------------

    private pushGraph(): void {
        if (!this.getNodes || !this.getConnections) return;
        const { graph, index } = emitWithIndex(this.getNodes(), this.getConnections(), {
            blockSize: WORKLET_BLOCK_SIZE,
        });
        this.index = index;
        const wasmGraph = remapForBackend(graph, 'wasm');
        if (this.ready) {
            this.sendGraph(wasmGraph);
        } else {
            this.pendingGraph = wasmGraph; // coalesce to latest until ready
        }
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
        if (this.signalCallbacks.size === 0) return;
        const levels = new Map<string, number>([[connectionId, level]]);
        for (const cb of this.signalCallbacks) cb(levels);
    }

    // --- Speaker output ----------------------------------------------------
    setSpeakerVolume(_nodeId: string, _volume: number, _isMuted: boolean): void {}
    setSpeakerDevice(_nodeId: string, _deviceId: string): void {}

    // --- Signal level metering --------------------------------------------
    subscribeSignalLevels(callback: (levels: Map<string, number>) => void): Unsubscribe {
        this.signalCallbacks.add(callback);
        callback(new Map());
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    setMicrophoneOutput(_nodeId: string, _outputNode: AudioNode): void {}

    // --- Continuous sources ------------------------------------------------
    pauseContinuousSources(): void {
        this.send('TransportPause');
    }
    resumeContinuousSources(): void {
        this.send('TransportPlay');
    }

    // --- Capability handles ------------------------------------------------
    getSamplerAdapter(_nodeId: string): SamplerAdapter | null {
        return null;
    }
    waitForSamplerAdapter(_nodeId: string, _timeoutMs?: number): Promise<SamplerAdapter | null> {
        return Promise.resolve(null);
    }
    getLooper(_nodeId: string): Looper | null {
        return null;
    }
    getRecorder(_nodeId: string): Recorder | null {
        return null;
    }
    sendSampleBuffer(_sourceNodeId: string, _buffer: AudioBuffer): void {}
}
