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

import { toast } from 'sonner';
import type { Connection, GraphNode } from '../../engine/types';
import { BROWSER_CAPABILITIES, type EngineCapabilities } from '../../engine/capabilities';
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
import {
    DEFAULT_VOICE_INSTRUMENTS,
    getVoiceForInstrumentNode,
    instrumentUsesKarplus,
} from '../defaultInstrument';
import { emitWithIndex, remapForBackend, resolveKeyboardNotes, type NodeIdxMap } from '../ojgraph';
import type {
    NodeIdx,
    OjGraph,
    RtCommand,
    Event as EngineEvent,
} from '../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreCapabilityRegistry,
    monoPcmToWavBlob,
    type OjcoreBridge,
} from './ojcoreHandles';
import { ingestEngineEvents } from './faultPipe';
import { setEngineHealth } from '../../store/engineHealthStore';

// Vite resolves these to URLs/assets at build time.
// The worklet processor module (bundled as an ES module worklet).
import ojcoreProcessorUrl from '../worklets/ojcore-processor.ts?worker&url';
// The compiled wasm bytes (committed; produced by build-wasm.sh).
import ojcoreWasmUrl from '../wasm/pkg/ojcore_wasm_bg.wasm?url';

/** Render quantum the AudioWorklet uses (the spec-fixed block size). */
const WORKLET_BLOCK_SIZE = 128;

/**
 * One-time-per-session, non-focus-stealing "whisper" when the browser engine
 * can't start at all. NEVER a modal and NEVER a toast storm: a single calm sonner
 * line per session — a held note beats a glitch, and the performer's focus is
 * sacred (DESIGN.md Live Performance Rule). Diagnostics still go to the console
 * for the local DevLog; this is only the human-facing nudge.
 *
 * We deliberately do NOT whisper on "no cross-origin isolation": the committed
 * `build-wasm.sh` wasm has no atomics/shared-memory, so the SharedArrayBuffer
 * control path does not exist in this build and `crossOriginIsolated` is inert —
 * an isolated and a non-isolated page run the SAME postMessage transport at the
 * SAME latency. Surfacing a "slower path / use the desktop app" notice would cry
 * wolf with a degradation that isn't real (honest interfaces). The COI state is
 * still logged below for the local DevLog; relabelling that diagnostic honestly
 * is Phase 2's job, not this slice's.
 */
const degradeNoticeShown = new Set<'dead'>();
function whisperBrowserEngineDegrade(
    kind: 'dead',
    message: string,
    description: string,
): void {
    if (degradeNoticeShown.has(kind)) return;
    degradeNoticeShown.add(kind);
    // `toast.error` (not bare `toast`) is reserved for the engine-dead case: the
    // browser tier truly produced no sound, the one event worth the louder style.
    toast.error(message, { description });
}

/** The sampler's root-note param id — mirrors `ojinstrument::sampler::
 *  SAMPLER_PCM_PARAM` (16). The compiler applies params BEFORE assets, so binding
 *  this alongside the `AssetRef` lands the sample at unity at `rootNote`. */
const SAMPLER_PCM_PARAM = 16;

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
    /** Live sampler asset bindings keyed by VISUAL node id: the worklet-assigned
     *  `AssetId` + root note. Re-applied onto the emitted graph on every push so a
     *  loaded sample survives subsequent node/connection edits (the wasm analogue
     *  of native's persistent graph binding). */
    private sampleBindings = new Map<string, { assetId: number; rootNote: number }>();
    /** Which built-in voice (family key) is currently bound per instrument node,
     *  so a voice is re-synthesized + re-bound only when the picker selection
     *  changes (not on every graph push). */
    private boundVoiceKey = new Map<string, string>();
    /** Pending `loadSample` resolvers keyed by VISUAL node id, settled when the
     *  worklet replies `sample-stored` (or on a safety timeout). */
    private sampleLoadResolvers = new Map<string, () => void>();
    /** Active microphone capture: stream + worklet input source, so it can be
     *  torn down on dispose / re-route. */
    private micStream: MediaStream | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;

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
            // DIAGNOSTIC ONLY (local DevLog) — NOT performer-facing. The current
            // committed wasm has no atomics/shared-memory, so there is no
            // SharedArrayBuffer control path to fall back FROM: isolated and
            // non-isolated pages run the identical postMessage transport at the
            // identical latency. We log the COI state (it's the forward-compat
            // precondition for a future shared-memory build) without claiming any
            // current degradation. No whisper here — see whisperBrowserEngineDegrade.
            console.warn(
                '[OjcoreWasmExecutor] page is NOT cross-origin isolated. The committed ' +
                    'wasm build has no shared-memory/atomics, so this is inert today (the ' +
                    'postMessage control transport is used regardless); COOP/COEP would be ' +
                    'the precondition for a future SharedArrayBuffer build (see vite.config.ts).',
            );
        }

        // Begin async worklet setup; graph pushes coalesce until it is ready.
        void this.setup().catch((err: unknown) => {
            console.error('[OjcoreWasmExecutor] worklet setup failed:', err);
            // The browser engine cannot make sound — surface it in the shared health
            // state (the tri-state dot reads DEAD), not just the console. Without this
            // the dot can sit at IDLE while the engine is dead (a silent failure).
            setEngineHealth('DEAD', 'browser engine failed to start');
            whisperBrowserEngineDegrade(
                'dead',
                'Couldn’t start the browser engine',
                'The audio engine failed to start in this browser. Open “Audio health” ' +
                    '(Ctrl/Cmd+Shift+H) for details, or use the desktop app.',
            );
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
            // One input so a `MediaStreamSource` (microphone) can be wired into
            // the worklet and fed to the engine's `MicIn` node each block.
            numberOfInputs: 1,
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
                assetId?: number;
                rootNote?: number;
                bytes?: Uint8Array;
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
                    // Now that the worklet can receive PCM, give instrument nodes
                    // their built-in default voice (was a no-op while not ready).
                    this.loadDefaultInstrumentVoices();
                    break;
                case 'meters':
                    this.onMeterFrame(data.levels ?? []);
                    break;
                case 'events':
                    this.onEngineEvents(data.bytes);
                    break;
                case 'recorder-data':
                    this.onRecorderData(data.node, data.pcm, data.sampleRate);
                    break;
                case 'sample-stored':
                    this.onSampleStored(data.node, data.assetId, data.rootNote);
                    break;
                case 'error':
                    console.error('[OjcoreWasmExecutor] worklet error:', data.message);
                    // An error BEFORE the worklet ever signalled `ready` is a startup
                    // failure (e.g. wasm instantiate threw inside the worklet's init,
                    // which posts here instead of rejecting setup()): the engine makes
                    // no sound, so surface DEAD + the one-time whisper. AFTER `ready`
                    // the engine is live — a transient message error must NOT cry wolf
                    // by marking the whole engine dead.
                    if (!this.ready) {
                        setEngineHealth('DEAD', 'browser engine failed to start');
                        whisperBrowserEngineDegrade(
                            'dead',
                            'Couldn’t start the browser engine',
                            'The audio engine failed to start in this browser. Open “Audio ' +
                                'health” (Ctrl/Cmd+Shift+H) for details, or use the desktop app.',
                        );
                    }
                    break;
            }
        };

        // Fetch the wasm BYTES and TRANSFER them to the worklet to compile +
        // instantiate synchronously on its own thread. We must NOT post a compiled
        // `WebAssembly.Module`: a Module cannot be structured-cloned across the
        // agent-cluster boundary into an `AudioWorkletGlobalScope` — under
        // cross-origin isolation Chromium silently DROPS such a message (no sender
        // error, the worklet's `onmessage` never fires), so the engine never
        // initialised and never posted `ready`. An `ArrayBuffer` transfers cleanly.
        const resp = await fetch(ojcoreWasmUrl);
        const bytes = await resp.arrayBuffer();
        node.port.postMessage({ type: 'init', bytes, blockSize: WORKLET_BLOCK_SIZE }, [bytes]);

        // Route the engine output into the speakers (speaker-terminated).
        node.connect(ctx.destination);
    }

    /** The browser (wasm/PWA) capability row — the honest degrading subset. */
    getCapabilities(): EngineCapabilities {
        return BROWSER_CAPABILITIES;
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        this.disableMicrophone();
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
        // Settle any in-flight sample loads so the load flow never hangs.
        for (const resolve of this.sampleLoadResolvers.values()) resolve();
        this.sampleLoadResolvers.clear();
        this.sampleBindings.clear();
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
        // Re-apply any live sampler bindings so a loaded sample survives later
        // node/connection edits (mirrors native keeping the bind in `last_graph`).
        this.applySampleBindings(wasmGraph);
        if (this.ready) {
            this.sendGraph(wasmGraph);
            // Give melodic instrument nodes a built-in default voice so they are
            // playable without a user-loaded sample (parity with native). Guarded
            // to load once per node — `applySampleBindings` then persists it across
            // later edits, mirroring the user-sample path.
            this.loadDefaultInstrumentVoices();
        } else {
            this.pendingGraph = wasmGraph; // coalesce to latest until ready
        }
    }

    /**
     * Lower the built-in default voice into each instrument node that has no
     * sample yet (see {@link DEFAULT_VOICE_INSTRUMENTS}). Once per node: the load
     * round-trips through the worklet and records a `sampleBindings` entry, so this
     * skips it next time and {@link applySampleBindings} keeps it bound. Needs the
     * worklet ready + an AudioContext to build the buffer.
     */
    private loadDefaultInstrumentVoices(): void {
        if (!this.ready || !this.getNodes) return;
        const ctx = getAudioContext();
        if (!ctx || typeof ctx.createBuffer !== 'function') return;
        // Cache one AudioBuffer per voice family across nodes in this pass.
        const bufferByKey = new Map<string, AudioBuffer>();
        for (const node of this.getNodes().values()) {
            if (!DEFAULT_VOICE_INSTRUMENTS.has(node.type)) continue;
            if (this.index.get(node.id) === undefined) continue;
            if (this.sampleBindings.has(node.id)) continue; // user-bound sample wins
            // Karplus-routed plucked strings are note-triggered; they need no PCM.
            if (instrumentUsesKarplus(node.type, node.data as Record<string, unknown> | undefined))
                continue;
            try {
                const { voice, key } = getVoiceForInstrumentNode(
                    node.type,
                    node.data as Record<string, unknown> | undefined,
                );
                // Skip if this node already has exactly this voice bound (the picker
                // hasn't changed) — avoids re-uploading PCM on every graph push.
                if (this.boundVoiceKey.get(node.id) === key) continue;
                let buffer = bufferByKey.get(key);
                if (!buffer) {
                    buffer = ctx.createBuffer(1, voice.pcm.length, voice.sampleRate);
                    // `.set()` (not copyToChannel) sidesteps the Float32Array
                    // backing-buffer generic mismatch and copies PCM into the channel.
                    buffer.getChannelData(0).set(voice.pcm);
                    bufferByKey.set(key, buffer);
                }
                this.getSamplerAdapter(node.id).setBuffer(buffer);
                this.boundVoiceKey.set(node.id, key);
            } catch (err) {
                // A buffer-creation failure must never break the graph push.
                console.error('[OjcoreWasmExecutor] default voice load failed:', err);
                return;
            }
        }
    }

    /**
     * Bind every recorded sampler asset onto its node in `graph`: set the
     * sampler's root-note param and an `AssetRef` in slot 0, so
     * `compile_with_assets` in the worklet resolves + installs the PCM into the
     * live Sampler. Pure data shaping over the emitted IR (off any render path).
     */
    private applySampleBindings(graph: OjGraph): void {
        if (this.sampleBindings.size === 0) return;
        for (const [nodeId, { assetId, rootNote }] of this.sampleBindings) {
            const idx = this.index.get(nodeId);
            if (idx === undefined) continue;
            const ir = graph.nodes.find((n) => n.id === idx);
            if (!ir) continue;
            // Root note -> the sampler's root-note param (compiler applies params
            // before assets), matching native `bind_sample_to_node`.
            const existing = ir.params.find((p) => p.id === SAMPLER_PCM_PARAM);
            if (existing) existing.value = rootNote;
            else ir.params.push({ id: SAMPLER_PCM_PARAM, value: rootNote });
            // Bind the PCM asset in slot 0 (replace any prior binding on it).
            const ref = ir.assets.find((a) => a.slot === 0);
            if (ref) ref.asset = assetId;
            else ir.assets.push({ slot: 0, asset: assetId });
        }
    }

    /**
     * Record the worklet-assigned `AssetId` for `nodeId`, re-push the graph so the
     * worklet recompiles-with-assets and the live Sampler gets the sample, then
     * settle the pending `loadSample` promise.
     */
    private onSampleStored(node?: number, assetId?: number, rootNote?: number): void {
        if (node === undefined || assetId === undefined) return;
        const nodeId = this.reverseIndex.get(node);
        if (nodeId === undefined) return;
        this.sampleBindings.set(nodeId, { assetId, rootNote: rootNote ?? 60 });
        // Re-emit + push so the bound AssetRef reaches the worklet's recompile.
        this.pushGraph();
        const resolve = this.sampleLoadResolvers.get(nodeId);
        if (resolve) {
            this.sampleLoadResolvers.delete(nodeId);
            resolve();
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

    /**
     * Surface a batch of engine fault `Event`s the worklet drained (the browser
     * tier's half of the fault pipe). The bytes are a JSON `Event[]` in the SAME
     * wire shape `poll_events` returns on native, so the SAME shared sink
     * (`ingestEngineEvents`: coalesce -> DevLog ring -> health) handles both tiers
     * — one fault path, no fork. The worklet has no wall clock, so each event's
     * `ts_us` arrives `0`; we stamp it here on the main thread before ingest.
     */
    private onEngineEvents(bytes?: Uint8Array): void {
        if (!bytes || bytes.length === 0) return;
        let events: EngineEvent[];
        try {
            events = JSON.parse(new TextDecoder().decode(bytes)) as EngineEvent[];
        } catch {
            return; // malformed batch; drop rather than throw on the message path
        }
        if (!Array.isArray(events) || events.length === 0) return;
        const nowUs = Date.now() * 1000;
        for (const ev of events) {
            if (ev.ts_us === 0) ev.ts_us = nowUs;
        }
        ingestEngineEvents(events);
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
    // a worklet `gain` message (the SpeakerOut node is unparameterized).
    setSpeakerVolume(_nodeId: string, volume: number, isMuted: boolean): void {
        this.node?.port.postMessage({ type: 'master-gain', gain: isMuted ? 0 : volume });
    }

    // Per-device output routing. The browser has ONE AudioContext with ONE
    // destination, so `AudioContext.setSinkId` is context-global: every SpeakerOut
    // node shares it and the most-recently-selected device wins (a documented PWA
    // limitation; the native build does true per-node routing via cpal). Browsers
    // without the API (Safari, older Chromium) no-op here and the SpeakerNode shows
    // its "device routing needs the native app" badge.
    setSpeakerDevice(_nodeId: string, deviceId: string): void {
        const base = getAudioContext();
        if (!base) return;
        const ctx = base as AudioContext & { setSinkId?: (id: string) => Promise<void> };
        if (typeof ctx.setSinkId !== 'function') return;
        // `enumerateDevices` reports the system default as id 'default' (or ''), and
        // both are valid sinkIds, so the node's `deviceId` passes straight through.
        void ctx.setSinkId(deviceId).catch((err: unknown) => {
            console.error('[OjcoreWasmExecutor] setSinkId failed:', err);
        });
    }

    // --- Signal level metering --------------------------------------------
    subscribeSignalLevels(callback: SignalLevelsCallback): Unsubscribe {
        this.signalCallbacks.add(callback);
        callback(new Map(this.levels));
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    // Wasm mic capture: open the microphone via `getUserMedia`, wrap it in a
    // `MediaStreamSource`, and connect it to the worklet `AudioWorkletNode`'s
    // input. The worklet copies that input block into the engine's `MicIn` node
    // output buffer each render quantum (see ojcore-processor `feedMicInput`), so
    // the mic flows through the engine graph. The Web-Audio `outputNode` is
    // unused: the engine owns routing via the `MicIn` graph node (mirrors native,
    // where only the node id crosses the seam). Permission denial is handled
    // gracefully — it logs and leaves the mic unrouted, never throws.
    setMicrophoneOutput(_nodeId: string, _outputNode: AudioNode): void {
        void this.enableMicrophone();
    }

    /** Acquire the microphone and wire it into the worklet input. Idempotent
     *  (a second call while a stream is live is a no-op); never throws. */
    private async enableMicrophone(): Promise<void> {
        if (this.micStream) return; // already capturing
        const ctx = getAudioContext();
        if (!ctx || !this.node) return;
        const media = globalThis.navigator?.mediaDevices;
        if (!media || typeof media.getUserMedia !== 'function') {
            console.warn('[OjcoreWasmExecutor] getUserMedia unavailable; mic not routed.');
            return;
        }
        try {
            const stream = await media.getUserMedia({ audio: true });
            // The node may have been disposed while permission was pending.
            if (!this.node) {
                for (const t of stream.getTracks()) t.stop();
                return;
            }
            this.micStream = stream;
            this.micSource = ctx.createMediaStreamSource(stream);
            // Feed the mic into the worklet's input (input 0); the worklet routes
            // it into the engine's MicIn node each block.
            this.micSource.connect(this.node);
        } catch (err) {
            // Permission denied / no device / insecure context: stay unrouted.
            console.warn('[OjcoreWasmExecutor] microphone access denied or unavailable:', err);
            this.disableMicrophone();
        }
    }

    /** Tear down any active microphone capture. */
    private disableMicrophone(): void {
        try {
            this.micSource?.disconnect();
        } catch {
            // already disconnected
        }
        this.micSource = null;
        if (this.micStream) {
            for (const track of this.micStream.getTracks()) track.stop();
        }
        this.micStream = null;
    }

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

    /**
     * Transfer mono PCM into the worklet to install as `nodeId`'s sampler, then
     * bind the worklet-assigned `AssetId` onto the node and re-push so the live
     * Sampler gets the sample (mirrors native `load_sample`). Resolves once the
     * worklet has stored the PCM (the `sample-stored` reply) or after a safety
     * timeout, so the UI's load flow always completes.
     */
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
        return new Promise<void>((resolve) => {
            this.sampleLoadResolvers.set(nodeId, resolve);
            this.node?.port.postMessage(
                { type: 'load-sample', node: idx, pcm: copy, sampleRate, rootNote },
                [copy.buffer],
            );
            // Safety timeout: never leave the load flow hanging if the worklet is
            // silent (e.g. torn down mid-load).
            setTimeout(() => {
                if (this.sampleLoadResolvers.has(nodeId)) {
                    this.sampleLoadResolvers.delete(nodeId);
                    resolve();
                }
            }, 2000);
        });
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
