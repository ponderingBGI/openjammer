/**
 * Shared executor CAPABILITY interfaces (U-EXEC-PARITY).
 *
 * These are the engine-agnostic contracts the UI consumes through the
 * {@link Executor}'s capability handles (`getLooper` / `getRecorder` /
 * `getSamplerAdapter` / `subscribeSignalLevels`). The ojcore executors implement
 * these interfaces with handles backed by the native/wasm engine — so the UI
 * works identically on either backend without importing a single Web-Audio type.
 *
 * The interfaces are intentionally a 1:1 distillation of consumed methods/props;
 * no behavior is added here.
 *
 * After U-DEDUP the legacy Web Audio engine is gone, so the leaf record types
 * (`Loop` / `Recording`) and the loop-duration sentinel/guard — formerly owned
 * by the deleted `../Looper` / `../Recorder` — now live HERE, in the
 * engine-agnostic capability layer the UI and ojcore handles share.
 */

// ---------------------------------------------------------------------------
// Loop duration sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel for infinite loop duration. `-1` is clearly invalid for a duration
 * and serializes to JSON correctly (`Number.POSITIVE_INFINITY` -> null).
 */
export const INFINITE_DURATION = -1;

/** Type guard: does this duration represent infinite (free-run)? */
export function isInfiniteDuration(duration: number): boolean {
    return duration < 0;
}

// ---------------------------------------------------------------------------
// Looper capability
// ---------------------------------------------------------------------------

/**
 * One captured loop layer, as the UI reads it — a plain data shape (id, buffer,
 * isMuted, waveformData, libraryItemId, plus playback bookkeeping). The ojcore
 * loop handle produces `Loop`-shaped objects with the playback-only fields nulled
 * (the audible loop is engine-rendered; the visual fields are what the UI reads).
 * The DECOUPLING is the capability METHOD surface below, not this record type.
 */
export interface Loop {
    id: string;
    /** Decoded audio (may be null when the audible loop is engine-rendered). */
    buffer: AudioBuffer | null;
    startTime: number;
    isMuted: boolean;
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
    /** Amplitude values over time for visualization. */
    waveformData: number[];
    /** Reference to the saved library item (if auto-saved). */
    libraryItemId?: string;
    isPaused: boolean;
    /** Position in the buffer when paused (seconds). */
    pausedAtOffset: number;
}

/** Alias kept for capability-handle call sites. @see Loop */
export type LoopLayer = Loop;

/**
 * The looper capability: a loop pedal the UI drives (record / stop / mute /
 * delete / drop a buffer) and observes (loop-added / waveform-history / deleted
 * callbacks). Implemented by the Web Audio `Looper` and by the ojcore loop
 * handles (which forward record/stop/etc as `RtCommand::Looper` actions).
 */
export interface LooperHandle {
    /** Set the loop cycle length in seconds (`< 0` == infinite / free-run). */
    setDuration(duration: number): void;
    /** The set loop cycle length in seconds (`< 0` == infinite / free-run). */
    getDuration(): number;
    /** The latest engine looper state (IDLE/ARMED/RECORDING/PLAYING/OVERDUBBING),
     *  driven by the engine return frames — the SSOT for transport UI (`number`
     *  to keep the interface protocol-version-agnostic; a {@link LooperState}). */
    getEngineState(): number;
    /** The loop-level wet gain (0..1) — the balance control for summed layers. */
    getWet(): number;
    /** Set the loop-level wet gain (0..1): SetParam(WET) on the looper node. */
    setWet(wet: number): void;
    /** All captured loop layers, newest last. */
    getLoops(): LoopLayer[];
    /** Begin recording in cycles. */
    startRecording(): Promise<void>;
    /** Stop recording. */
    stopRecording(): void;
    /** Toggle a loop layer's mute state. */
    toggleLoopMute(loopId: string): void;
    /** Delete a loop layer (and stop it). */
    deleteLoop(loopId: string): void;
    /** Undo the most-recently committed layer (LIFO): pops the tail row + UNDO_LAST. */
    undoLast(): void;
    /** Add a loop layer directly from a decoded buffer (clip drop). */
    addLoopFromBuffer(buffer: AudioBuffer): void;
    /** Notified when a new loop layer is captured/added. */
    setOnLoopAdded(callback: (loop: LoopLayer) => void): void;
    /** Notified when a loop layer is deleted (for library trash handling). */
    setOnLoopDeleted(callback: (loop: LoopLayer) => void): void;
    /** Notified when an existing loop layer is upgraded in place — Stage 3: its
     *  TRUE captured PCM/waveform arrived after the row was created, so the row
     *  swaps its live meter-envelope trace for the real shape and gains a
     *  non-null `buffer` (drag-to-library / export light up). */
    setOnLoopUpdated(callback: (loop: LoopLayer) => void): void;
    /** Deliver a committed take's TRUE captured PCM (Stage 3). Matched to the
     *  layer its commit edge created, in COMMIT ORDER (Nth PCM <-> Nth layer). */
    onLayerPcm(pcm: Float32Array, sampleRate: number): void;
    /** Notified with the live recording waveform + playhead (0-100) each frame. */
    setOnWaveformHistoryUpdate(
        callback: (history: number[], playheadPosition: number) => void
    ): void;
}

// ---------------------------------------------------------------------------
// Recorder capability
// ---------------------------------------------------------------------------

/**
 * One completed recording, as the UI reads it (id, blob, duration, timestamp,
 * name, libraryItemId). Engine-agnostic — surfaced by the ojcore recorder handle.
 */
export interface Recording {
    id: string;
    blob: Blob;
    duration: number;
    timestamp: number;
    name: string;
    /** Reference to the saved library item (if saved). */
    libraryItemId?: string;
}

/** Alias kept for capability-handle call sites. @see Recording */
export type RecordingEntry = Recording;

/**
 * The recorder capability: capture a bus to WAV the UI can download / save.
 * Implemented by the Web Audio `Recorder` and by the ojcore recorder handles
 * (which start/stop a native/worklet capture and surface the WAV blob).
 */
export interface RecorderHandle {
    /** Whether a capture is in progress. */
    getIsRecording(): boolean;
    /** All completed recordings. */
    getRecordings(): RecordingEntry[];
    /** Start capturing. */
    startRecording(): void;
    /** Stop capturing (fires the complete callback when the WAV is ready). */
    stopRecording(): void;
    /** Trigger a browser download of a recording's WAV. */
    downloadRecording(recordingId: string): void;
    /** Delete a recording. */
    deleteRecording(recordingId: string): void;
    /** Rename a recording. */
    renameRecording(recordingId: string, newName: string): void;
    /** The raw WAV blob for a recording (for library save), or null. */
    getRecordingBlob(recordingId: string): Blob | null;
    /** Persist a recording into the project folder; returns the saved path info. */
    saveRecordingToProject(
        recordingId: string,
        projectHandle: FileSystemDirectoryHandle
    ): Promise<{ path: string; duration: number; sampleRate: number } | null>;
    /** Notified when a capture completes (the WAV is ready). */
    setOnRecordingComplete(callback: (recording: RecordingEntry) => void): void;
    /** Notified when a recording is deleted (for library trash handling). */
    setOnRecordingDeleted(callback: (recording: RecordingEntry) => void): void;
    /** Notified with elapsed capture time (seconds) while recording. */
    setOnTimeUpdate(callback: (time: number) => void): void;
}

// ---------------------------------------------------------------------------
// Sampler capability
// ---------------------------------------------------------------------------

/**
 * The sampler capability: a pitched sample-playback instrument the UI configures
 * (root note / gain / attack / release) and feeds a buffer. Implemented by the
 * Web Audio `SamplerAdapter` and by the ojcore sampler handles (which load PCM
 * into the engine's `builtin.sampler` via the `load_sample` seam / worklet
 * transfer and mirror the config as `SetParam`s).
 */
export interface SamplerHandle {
    /** The currently-loaded buffer, or null. */
    getBuffer(): AudioBuffer | null;
    /** Install (or clear, with null) the sample buffer. */
    setBuffer(buffer: AudioBuffer | null): void;
    /** Set the root note (MIDI number) — unity-pitch playback note. */
    setRootNote(midiNote: number): void;
    /** Set the overall output gain. */
    setGain(gain: number): void;
    /** Set the attack time (seconds). */
    setAttack(attack: number): void;
    /** Set the release time (seconds). */
    setRelease(release: number): void;
}

// ---------------------------------------------------------------------------
// Signal levels capability
// ---------------------------------------------------------------------------

/** Per-key (connection id or node id) level in 0-1, for the signal-flow viz. */
export type SignalLevels = Map<string, number>;

/** Callback delivered a fresh {@link SignalLevels} snapshot. */
export type SignalLevelsCallback = (levels: SignalLevels) => void;
