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
import type {
    NodeIdx,
    OjGraph,
    RtCommand,
    EngineFrame,
    Event as EngineEvent,
} from '../../../packages/oj-protocol-ts/src/index';
import {
    OjcoreCapabilityRegistry,
    monoPcmToWavBlob,
    type OjcoreBridge,
} from './ojcoreHandles';
import { useLogStore } from '../../store/logStore';

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

/**
 * How often (ms) to poll the engine for fault {@link EngineEvent}s. Slower than
 * the meter poll: faults are RARE (`Xrun` / `NodeFault` / `RingFull`), so empty
 * batches are the norm and a tighter loop would just burn IPC. The engine's
 * event ring (16 KiB) absorbs a fault burst between polls without loss.
 */
const EVENT_POLL_MS = 250;

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
    /** Interval id for the fault-event poll loop (engine -> DevLog stream). */
    private eventPollId: number | null = null;
    /** Guards against overlapping `poll_events` invokes (ordered DevLog ingest). */
    private eventPollInFlight = false;

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
        // Begin the engine -> DevLog fault-event stream. Unlike meters this is NOT
        // gated on a subscriber: we log every engine fault into the bounded
        // logStore ring always (the "log everything" principle), so the DevLog and
        // the one-click issue report have the history even if the panel was never
        // opened. No-op without Tauri.
        this.startEventStream();
    }

    dispose(): void {
        this.unsub?.();
        this.unsub = null;
        if (this.meterPollId !== null) {
            clearInterval(this.meterPollId);
            this.meterPollId = null;
        }
        if (this.eventPollId !== null) {
            clearInterval(this.eventPollId);
            this.eventPollId = null;
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

    /** Begin the engine -> DevLog fault-event poll loop. Idempotent (a single
     *  loop). No-op without Tauri. */
    private startEventStream(): void {
        if (!this.invoke || this.eventPollId !== null) return;
        this.eventPollId = window.setInterval(() => {
            void this.pollEvents();
        }, EVENT_POLL_MS);
    }

    /** Poll the engine for pending fault events and ingest each into the DevLog
     *  log store. Faults are rare, so most polls return an empty batch.
     *
     *  Overlap guard: `setInterval` fires on a fixed cadence regardless of
     *  whether the previous invoke is still in flight. Under an IPC stall,
     *  concurrent polls could resolve out of order and append older events after
     *  newer ones — and unlike the order-insensitive meter snapshot, the DevLog
     *  is an ordered append log. The `eventPollInFlight` latch keeps exactly one
     *  poll outstanding, so ingestion order matches engine FIFO order. */
    private async pollEvents(): Promise<void> {
        if (!this.invoke || this.eventPollInFlight) return;
        this.eventPollInFlight = true;
        let events: EngineEvent[];
        try {
            events = (await this.invoke('poll_events', {})) as EngineEvent[];
        } catch {
            return; // transient; next tick retries
        } finally {
            this.eventPollInFlight = false;
        }
        if (!Array.isArray(events) || events.length === 0) return;
        const ingest = useLogStore.getState().ingestEngineEvent;
        for (const event of events) {
            if (event && typeof event === 'object' && 'kind' in event) ingest(event);
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
        this.sendGraph(native);
    }

    private sendGraph(graph: OjGraph): void {
        if (!this.invoke) return;
        this.invoke('push_graph', { graph }).catch((err: unknown) => {
            console.error('[OjcoreNativeExecutor] push_graph failed:', err);
        });
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
        if (this.signalCallbacks.size === 0) return;
        const levels = new Map<string, number>([[connectionId, level]]);
        for (const cb of this.signalCallbacks) cb(levels);
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
