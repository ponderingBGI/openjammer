/**
 * Executor — the audio-backend seam.
 *
 * This interface captures the surface the app uses to drive audio. It is
 * implemented by the ojcore executors ({@link OjcoreNativeExecutor} over Tauri
 * IPC and {@link OjcoreWasmExecutor} over an AudioWorklet). Targeting this stable
 * contract — instead of a concrete engine — keeps the UI and stores
 * engine-agnostic; the transport is selected at startup via `OJ_EXECUTOR`.
 *
 * The shape is a 1:1 distillation of the control surface the app actually calls
 * — no behavior is added here.
 */

import type { Connection, GraphNode } from '../../engine/types';
import type { EngineCapabilities } from '../../engine/capabilities';
import type { RtCommand } from '@openjammer/oj-protocol';
import type { ArrangementCaptureResult, ArrangementPlayback, ArrangementStartOptions, LiveNoteCallback, TransportFrameCallback } from './timelinePlayback';
import type { LatencyReport } from './latency';
import type {
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    SignalLevelsCallback,
} from './capabilities';

export type { LatencyReport, LatencyClassification } from './latency';
export { classifyLatency } from './latency';

export type {
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    Loop,
    LoopLayer,
    Recording,
    RecordingEntry,
    SignalLevels,
    SignalLevelsCallback,
} from './capabilities';
export { INFINITE_DURATION, isInfiniteDuration } from './capabilities';

/** Callback invoked when the set of connections changes. */
export type ConnectionChangeCallback = (connections: Map<string, Connection>) => void;

/** Callback invoked when the set of nodes changes. */
export type NodeChangeCallback = (nodes: Map<string, GraphNode>) => void;

/** Unsubscribe handle returned by subscription methods. */
export type Unsubscribe = () => void;

/**
 * Drives audio for the node graph. One instance is selected at startup via
 * {@link getExecutor}; the app wires the graph store into it through
 * {@link Executor.initialize}.
 */
export interface Executor {
    // --- Lifecycle ---------------------------------------------------------

    /**
     * Subscribe to graph changes and perform the initial reconcile of nodes and
     * connections into the audio backend.
     */
    initialize(
        subscribeToConnections: (callback: ConnectionChangeCallback) => Unsubscribe,
        subscribeToNodes: (callback: NodeChangeCallback) => Unsubscribe,
        getNodes: () => Map<string, GraphNode>,
        getConnections: () => Map<string, Connection>
    ): void;

    /** Tear down subscriptions and release audio resources. */
    dispose(): void;

    /**
     * Capture every hosted plugin's opaque state (the `oj.state` save half) and
     * write it into the owning node's `data` (under `HOSTED_PLUGIN_STATE_KEY`), so a
     * project export persists it and a reopen restores the plugin. Called before a
     * project save. On the wasm tier (no native hosting) it is a no-op. Off the undo
     * history — engine-derived runtime state, not a user edit.
     */
    capturePluginStates(): Promise<void>;

    /**
     * Force a re-push of the current graph even when its bytes are unchanged. The
     * native host uses this after a plugin RESCAN to instantly rebind a degraded
     * node onto its now-available plugin (invariant #4a auto-rebind), rather than
     * waiting for the next canvas edit. A clean graph harmlessly recompiles to
     * itself; on the wasm tier (no native hosting) it is a plain re-emit.
     */
    resync(): void;

    // --- Platform capabilities --------------------------------------------

    /**
     * The platform capability descriptor for this executor — the ONE seam all
     * agent / code-node / auth / learning gating reads (see
     * {@link EngineCapabilities}). Static per session: the native executor
     * reports the desktop row, the wasm executor the browser row.
     */
    getCapabilities(): EngineCapabilities;

    /** Backend graph lowering required by authored timeline preview. */
    getTimelineBackend(): 'native' | 'wasm';

    /**
     * The latency of THIS executor's audio backend — the one number the UI shows.
     * The native executor reports its cpal stream's negotiated buffer (over the
     * `query_stream` IPC); the wasm executor reports the AudioContext it renders
     * into. Resolves `null` while the backend is not yet up (no context / device).
     * Because the UI always asks the active executor, the inactive tier's latency
     * (e.g. the WebView2 decode context on native) can never be shown.
     */
    getLatency(): Promise<LatencyReport | null>;

    // --- Note / control input ---------------------------------------------

    /** Trigger a note from a keyboard node's row/key (velocity 0-1). */
    noteOn(keyboardId: string, row: number, keyIndex: number, velocity?: number): void;

    /** Release a previously triggered keyboard note. */
    noteOff(keyboardId: string, row: number, keyIndex: number): void;

    /** Low-velocity editor audition addressed directly to an instrument node. */
    auditionNote(targetNodeId: string | number, pitch: number, velocity: number, on: boolean): void;

    /** Flash a control connection's signal-level visualization on. */
    activateControlSignal(connectionId: string): void;

    /** Begin the release fade of a control connection's visualization. */
    releaseControlSignal(connectionId: string): void;

    // --- Speaker output ----------------------------------------------------

    /** Set a speaker node's volume (0-1) and mute state. */
    setSpeakerVolume(nodeId: string, volume: number, isMuted: boolean): void;

    /** Route a speaker node to a specific output device. */
    setSpeakerDevice(nodeId: string, deviceId: string): void;

    // --- Signal level metering --------------------------------------------

    /** Subscribe to per-connection signal levels (0-1). Returns an unsubscribe. */
    subscribeSignalLevels(callback: SignalLevelsCallback): Unsubscribe;

    /**
     * Probe ONE node's instantaneous output peak (0-1) for the agent's `get_signal`,
     * or null when no live reading is available (the node isn't metered, or audio
     * isn't running). Async because the per-node meter only streams while a
     * subscriber is mounted: this registers a transient one, lets a poll tick settle,
     * reads the cached peak, and unsubscribes — off the audio thread, never blocking.
     */
    probeSignal(nodeId: string): Promise<number | null>;

    // --- Microphone --------------------------------------------------------

    /**
     * Drive a microphone node's ENGINE input from the executor — the SINGLE owner
     * of the OS mic device. The UI never opens its own `getUserMedia`; it only
     * declares intent here. `isMuted` is provably silent at the engine seam: the
     * executor feeds SILENCE into the engine's `MicIn` (wasm: disconnects the
     * worklet input; native: `set_mic(node, false)`), so a muted mic is truly off
     * on stage, not merely visually dimmed. `deviceId` selects the OS input device
     * ('default' or undefined => system default); a change re-acquires the one
     * owned stream. Idempotent; never throws (permission denial stays unrouted).
     */
    setMicrophoneInput(
        nodeId: string,
        options: { isMuted: boolean; deviceId?: string },
    ): void;

    // --- Continuous sources (loopers, etc.) -------------------------------

    /** Pause all continuous sources (does not affect live instruments). */
    pauseContinuousSources(): void;

    /** Resume all previously paused continuous sources. */
    resumeContinuousSources(): void;

    // --- Capability handles ------------------------------------------------

    /** Get the sampler adapter for a node, if one exists. */
    getSamplerAdapter(nodeId: string): SamplerHandle | null;

    /** Resolve the sampler adapter for a node once created (or null on timeout). */
    waitForSamplerAdapter(nodeId: string, timeoutMs?: number): Promise<SamplerHandle | null>;

    /** Get the looper instance for a node, if one exists. */
    getLooper(nodeId: string): LooperHandle | null;

    /** Get the recorder instance for a node, if one exists. */
    getRecorder(nodeId: string): RecorderHandle | null;

    /** Forward a decoded sample buffer from a source node to connected samplers. */
    sendSampleBuffer(sourceNodeId: string, buffer: AudioBuffer): void;

    // --- Timeline preview (the on-canvas timeline's transport) ------------

    /**
     * Begin live playback by publishing the conducted graph, TempoMap, and immutable
     * sample-addressed Timeline, then sending TransportPlay. Both executors use this
     * path; engine Transport frames, not a UI clock, confirm visible motion.
     */
    startArrangementPreview(playback: ArrangementPlayback, startSample: number, options?: ArrangementStartOptions): void;

    /** Swap edited authored documents whole without restarting transport. */
    updateArrangementPreview(playback: ArrangementPlayback): void;

    /** End live preview. The engine owns held-note release and transport declick. */
    stopArrangementPreview(): void;

    stopArrangementRecording(): Promise<ArrangementCaptureResult | null>;

    subscribeLiveNotes(callback: LiveNoteCallback): Unsubscribe;

    /** Schedule a live command at an absolute engine sample (`0` = immediate). */
    sendTimed(at: number, cmd: RtCommand): void;

    /** Subscribe to authoritative engine transport snapshots. */
    subscribeTransport(callback: TransportFrameCallback): Unsubscribe;

    /** Locate without moving the UI playhead until a confirming frame arrives. */
    seekArrangement(samples: number): void;

    /** Toggle an engine transport boolean (ranges remain in Timeline). */
    setArrangementLoop(on: boolean): void;
    setArrangementPunch(on: boolean): void;
    setArrangementClick(on: boolean): void;
    setArrangementCountIn(on: boolean): void;
}
