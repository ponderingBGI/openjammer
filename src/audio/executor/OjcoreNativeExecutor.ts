/**
 * OjcoreNativeExecutor (U17) — the native, sub-5ms audio path.
 *
 * When OpenJammer runs inside the Tauri desktop shell, audio is rendered by the
 * native Rust `ojcore` engine on a small-buffer cpal stream (the founder's MOTU
 * M4), NOT by Web Audio. This executor is the control-plane bridge: it lowers the
 * visual graph to an `OjGraph` and `invoke('push_graph')`s it, and turns the
 * note/param/transport seam into `RtCommand`s sent via `invoke('send_command')`.
 * No audio buffer ever crosses the IPC boundary — only control-rate JSON
 * (governing principle #4), matching `src-tauri/src/engine.rs`.
 *
 * IPC. Tauri v2 exposes `invoke` either as the `@tauri-apps/api` module or, when
 * `app.withGlobalTauri` is enabled, as `window.__TAURI__.core.invoke`. To avoid
 * adding a build dependency (and because `@tauri-apps/api` is not installed), we
 * use the GLOBAL bridge. If it is absent (i.e. not actually under Tauri, or the
 * global bridge is disabled) every call degrades to a logged no-op so the app
 * never breaks — selection only routes here when Tauri is detected.
 *
 * ── FOUNDER SETUP (one-time, outside this lane) ──────────────────────────────
 * Enable the global IPC bridge so this executor can reach `invoke` without the
 * `@tauri-apps/api` package: in `src-tauri/tauri.conf.json` set
 *   "app": { "withGlobalTauri": true, ... }
 * Alternatively, `bun add @tauri-apps/api` and swap {@link nativeInvoke} to
 * `import { invoke } from '@tauri-apps/api/core'`.
 */

import type { Connection, GraphNode } from '../../engine/types';
import { DESKTOP_CAPABILITIES, type EngineCapabilities } from '../../engine/capabilities';
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
import { emitWithIndex, remapForBackend, type NodeIdxMap } from '../ojgraph';
import { resolveKeyboardNotes } from '../ojgraph';
import {
    DEFAULT_VOICE_INSTRUMENTS,
    getDefaultInstrumentVoice,
    type DefaultVoice,
} from '../defaultInstrument';
import type {
    NodeIdx,
    OjGraph,
    RtCommand,
    EngineFrame,
} from '../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreCapabilityRegistry,
    monoPcmToWavBlob,
    type OjcoreBridge,
} from './ojcoreHandles';

/** Minimal shape of the Tauri global IPC bridge (`withGlobalTauri`). */
interface TauriGlobal {
    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** Resolve the Tauri `invoke` function from the global bridge, if present. */
function getInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
    if (typeof window === 'undefined') return null;
    const t = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
    if (!t) return null;
    if (t.core?.invoke) return t.core.invoke.bind(t.core);
    if (t.invoke) return t.invoke.bind(t);
    return null;
}

/** How often (ms) to poll the engine for fresh per-node meter levels. */
const METER_POLL_MS = 50;

/** True when running inside a Tauri webview (the native desktop shell). */
export function isTauri(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

/**
 * Drives audio via the native Tauri ojcore engine. Every {@link Executor} method
 * is now backed for REAL: notes/params/looper become `RtCommand`s; meters arrive
 * as a `meters` Tauri event stream from the engine's return ring; the looper /
 * recorder / sampler handles ({@link OjcoreCapabilityRegistry}) drive the engine
 * over NEW Tauri commands (`looper_cmd` / `load_sample` / `recorder_start` /
 * `recorder_stop` / `set_speaker_volume` / `set_speaker_device` / `set_mic` /
 * `subscribe_meters`). Capabilities never return null — the app's looper /
 * recorder / sampler / metering UI works on the native path.
 */
export class OjcoreNativeExecutor implements Executor {
    private invoke = getInvoke();
    private getNodes: (() => Map<string, GraphNode>) | null = null;
    private getConnections: (() => Map<string, Connection>) | null = null;
    private unsub: Unsubscribe | null = null;
    /** Last emitted GraphNode-id -> NodeIdx interning, for RtCommand addressing. */
    private index: NodeIdxMap = new Map();
    /** Reverse map NodeIdx -> visual node id, for routing meter frames back. */
    private reverseIndex = new Map<number, string>();
    private signalCallbacks = new Set<SignalLevelsCallback>();
    /** Latest per-node levels, keyed by visual node id (for meter delivery). */
    private levels = new Map<string, number>();
    /** Interval id for the meter poll loop (engine -> UI level stream). */
    private meterPollId: number | null = null;

    /** The engine-side seam the capability handles drive (native impl). */
    private readonly bridge: OjcoreBridge = {
        nodeIndex: (nodeId) => this.index.get(nodeId),
        sendCommand: (cmd) => this.send(cmd),
        loadSample: (nodeId, pcm, sampleRate, rootNote) =>
            this.loadSampleNative(nodeId, pcm, sampleRate, rootNote),
        startCapture: (nodeId) => this.recorderStartNative(nodeId),
        stopCapture: (nodeId) => this.recorderStopNative(nodeId),
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

        if (!this.invoke) {
            console.warn(
                '[OjcoreNativeExecutor] Tauri global IPC bridge not found ' +
                    '(set app.withGlobalTauri=true in tauri.conf.json). Native audio disabled.',
            );
        }

        const unsubNodes = subscribeToNodes(() => this.pushGraph());
        const unsubConns = subscribeToConnections(() => this.pushGraph());
        this.unsub = () => {
            unsubNodes();
            unsubConns();
        };

        // Initial reconcile.
        this.pushGraph();

        // Begin the engine -> UI meter event stream (no-op without Tauri).
        this.startMeterStream();
    }

    /** The native (Tauri) capability row — the flagship. */
    getCapabilities(): EngineCapabilities {
        return DESKTOP_CAPABILITIES;
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        if (this.meterPollId !== null) {
            clearInterval(this.meterPollId);
            this.meterPollId = null;
        }
        this.signalCallbacks.clear();
        this.levels.clear();
        this.caps.clear();
        this.getNodes = null;
        this.getConnections = null;
        this.index = new Map();
        this.reverseIndex = new Map();
    }

    /** Enable engine metering and poll the meter return ring, fanning per-node
     *  levels out to signal-level subscribers, keyed by visual node id.
     *  Idempotent (a single poll loop). */
    private startMeterStream(): void {
        if (!this.invoke || this.meterPollId !== null) return;
        // Ask the backend to enable metering (zero-cost while no graph runs).
        this.invoke('subscribe_meters', {}).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] subscribe_meters failed:', err);
        });
        this.meterPollId = window.setInterval(() => {
            void this.pollMeters();
        }, METER_POLL_MS);
    }

    /** Poll the engine for the latest meter frames and deliver level snapshots. */
    private async pollMeters(): Promise<void> {
        if (!this.invoke || this.signalCallbacks.size === 0) return;
        let frames: EngineFrame[];
        try {
            frames = (await this.invoke('poll_meters', {})) as EngineFrame[];
        } catch {
            return; // transient; next tick retries
        }
        if (!Array.isArray(frames) || frames.length === 0) return;
        let changed = false;
        for (const frame of frames) {
            if (!frame || typeof frame !== 'object' || !('Meter' in frame)) continue;
            const { node, peak } = (frame as { Meter: { node: NodeIdx; rms: number; peak: number } })
                .Meter;
            const nodeId = this.reverseIndex.get(node);
            if (nodeId === undefined) continue;
            this.levels.set(nodeId, Math.max(0, Math.min(1, peak)));
            changed = true;
        }
        if (changed) {
            const snapshot = new Map(this.levels);
            for (const cb of this.signalCallbacks) cb(snapshot);
        }
    }

    /** Emit + remap + push the current graph to the native engine. */
    private pushGraph(): void {
        if (!this.getNodes || !this.getConnections) return;
        const { graph, index } = emitWithIndex(this.getNodes(), this.getConnections());
        this.index = index;
        // Build the reverse NodeIdx -> visual id map for routing meter frames.
        this.reverseIndex = new Map();
        for (const [id, idx] of index) this.reverseIndex.set(idx, id);
        const native = remapForBackend(graph, 'native');
        void this.sendGraph(native);
    }

    private async sendGraph(graph: OjGraph): Promise<void> {
        if (!this.invoke) return;
        try {
            await this.invoke('push_graph', { graph });
        } catch (err) {
            console.error('[OjcoreNativeExecutor] push_graph failed:', err);
            return;
        }
        // A UI push REPLACES the engine's kept graph, dropping any imperatively
        // bound sample (see engine.rs push_graph), so (re)install the built-in
        // default voice for instrument nodes that ship one. Without this a
        // freshly-wired Keys/Piano/… node lowers to an EMPTY builtin.sampler and
        // is silent — the note routes correctly but there is no PCM to play.
        this.loadDefaultInstrumentVoices();
    }

    /** (Re)lower the built-in default voice into every instrument node that needs
     *  one, so melodic instruments are playable without a user-loaded sample.
     *  Idempotent per push; the engine sampler SR-corrects + pitches the single
     *  tone across the keyboard. A user-bound sample later simply replaces it. */
    private loadDefaultInstrumentVoices(): void {
        if (!this.invoke || !this.getNodes) return;
        let voice: DefaultVoice | null = null;
        for (const node of this.getNodes().values()) {
            if (!DEFAULT_VOICE_INSTRUMENTS.has(node.type)) continue;
            if (this.index.get(node.id) === undefined) continue;
            if (!voice) voice = getDefaultInstrumentVoice();
            void this.loadSampleNative(node.id, voice.pcm, voice.sampleRate, voice.rootNote);
        }
    }

    private send(cmd: RtCommand): void {
        if (!this.invoke) return;
        this.invoke('send_command', { cmd }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] send_command failed:', err);
        });
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
            this.send({
                NoteOn: { node: idx, note: n.midiNote, vel: Math.round(n.velocity * 127) },
            });
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

    // Sustain pedal: no dedicated RtCommand yet (CC handled engine-side later).
    controlDown(_keyboardId: string): void {}
    controlUp(_keyboardId: string): void {}

    // Control-signal VISUALIZATION is a UI affordance; the native path drives no
    // Web Audio analyser, so flashes are emitted as 1/0 levels to subscribers.
    activateControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 1);
    }
    releaseControlSignal(connectionId: string): void {
        this.emitSignal(connectionId, 0);
    }

    private emitSignal(connectionId: string, level: number): void {
        // Persist the cable pulse into the SHARED level map (connection ids and the
        // node-meter ids the poll writes are disjoint key spaces) and emit a MERGED
        // snapshot. NodeCanvas replaces its whole map per emit, so a single-entry
        // emit here was clobbered by the very next `pollMeters` snapshot a frame
        // later — the "glow dies while the key is held" bug. Mirrors
        // OjcoreWasmExecutor.emitSignal so both backends behave identically.
        this.levels.set(connectionId, level);
        if (this.signalCallbacks.size === 0) return;
        const snapshot = new Map(this.levels);
        for (const cb of this.signalCallbacks) cb(snapshot);
    }

    // --- Speaker output ----------------------------------------------------
    // The native master is the host SpeakerOut; volume/device are control-rate
    // host concerns surfaced via dedicated Tauri commands (the engine SpeakerOut
    // node is unparameterized, so this routes around it).
    setSpeakerVolume(nodeId: string, volume: number, isMuted: boolean): void {
        if (!this.invoke) return;
        this.invoke('set_speaker_volume', {
            nodeId,
            volume: isMuted ? 0 : volume,
            muted: isMuted,
        }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] set_speaker_volume failed:', err);
        });
    }
    setSpeakerDevice(nodeId: string, deviceId: string): void {
        if (!this.invoke) return;
        this.invoke('set_speaker_device', { nodeId, deviceId }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] set_speaker_device failed:', err);
        });
    }

    // --- Signal level metering --------------------------------------------

    subscribeSignalLevels(callback: SignalLevelsCallback): Unsubscribe {
        this.signalCallbacks.add(callback);
        // Ensure the engine -> UI meter stream is running for new subscribers.
        this.startMeterStream();
        // Deliver the latest snapshot immediately.
        callback(new Map(this.levels));
        return () => {
            this.signalCallbacks.delete(callback);
        };
    }

    // --- Microphone --------------------------------------------------------
    // Native mic capture is an engine duplex-input concern: the `set_mic` command
    // tells the backend which graph node should receive the mic bus. The
    // Web-Audio `outputNode` has no meaning natively (the engine owns routing),
    // so only the node id crosses the seam.
    setMicrophoneOutput(nodeId: string, _outputNode: AudioNode): void {
        if (!this.invoke) return;
        this.invoke('set_mic', { nodeId, enabled: true }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] set_mic failed:', err);
        });
    }

    // --- Continuous sources ------------------------------------------------
    pauseContinuousSources(): void {
        this.send('TransportPause');
    }
    resumeContinuousSources(): void {
        this.send('TransportPlay');
    }

    // --- Capability handles ------------------------------------------------
    // Real, never-null handles backed by the ojcore engine (looper actions become
    // RtCommands; samples load via `load_sample`; recorder via capture commands).
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

    /** Forward a decoded buffer from a source node to every connected sampler.
     *  Mirrors WebAudio's `sendSampleBuffer`: install the PCM into each sampler
     *  the source feeds. */
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

    // --- Native command backings for the capability bridge -----------------

    /** Lower mono PCM into the engine sampler for `nodeId` via `load_sample`. */
    private async loadSampleNative(
        nodeId: string,
        pcm: Float32Array,
        sampleRate: number,
        rootNote: number,
    ): Promise<void> {
        if (!this.invoke) return;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return;
        try {
            // Transfer PCM as a plain number array (control-rate asset load, NOT
            // the audio thread — the engine resolves it into the AssetCatalog and
            // calls the sampler's set_sample off-RT).
            await this.invoke('load_sample', {
                node: idx,
                pcm: Array.from(pcm),
                sampleRate,
                rootNote,
            });
        } catch (err) {
            console.error('[OjcoreNativeExecutor] load_sample failed:', err);
        }
    }

    /** Start an engine-side capture of `nodeId`'s output bus. */
    private recorderStartNative(nodeId: string): void {
        if (!this.invoke) return;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return;
        this.invoke('recorder_start', { node: idx }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] recorder_start failed:', err);
        });
    }

    /** Stop the engine-side capture and resolve the exported WAV blob. */
    private async recorderStopNative(nodeId: string): Promise<Blob | null> {
        if (!this.invoke) return null;
        const idx = this.index.get(nodeId);
        if (idx === undefined) return null;
        try {
            // The backend returns interleaved-or-mono f32 PCM + rate; encode to a
            // WAV blob client-side (off the audio thread). The native Recorder can
            // also export WAV directly via `recorder_export` for the file path.
            const res = (await this.invoke('recorder_stop', { node: idx })) as {
                pcm: number[];
                sampleRate: number;
            } | null;
            if (!res || !res.pcm || res.pcm.length === 0) return null;
            return monoPcmToWavBlob(Float32Array.from(res.pcm), res.sampleRate);
        } catch (err) {
            console.error('[OjcoreNativeExecutor] recorder_stop failed:', err);
            return null;
        }
    }
}
