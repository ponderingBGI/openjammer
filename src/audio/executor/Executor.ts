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
import type {
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    SignalLevelsCallback,
} from './capabilities';

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

    // --- Note / control input ---------------------------------------------

    /** Trigger a note from a keyboard node's row/key (velocity 0-1). */
    noteOn(keyboardId: string, row: number, keyIndex: number, velocity?: number): void;

    /** Release a previously triggered keyboard note. */
    noteOff(keyboardId: string, row: number, keyIndex: number): void;

    /** Press the control (sustain pedal) for a keyboard node. */
    controlDown(keyboardId: string): void;

    /** Release the control (sustain pedal) for a keyboard node. */
    controlUp(keyboardId: string): void;

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

    // --- Microphone --------------------------------------------------------

    /** Set the AudioNode a microphone node should route its output into. */
    setMicrophoneOutput(nodeId: string, outputNode: AudioNode): void;

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
}
