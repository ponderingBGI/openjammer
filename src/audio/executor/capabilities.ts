/**
 * Shared executor CAPABILITY interfaces (U-EXEC-PARITY).
 *
 * These are the engine-agnostic contracts the UI consumes through the
 * {@link Executor}'s capability handles (`getLooper` / `getRecorder` /
 * `getSamplerAdapter` / `subscribeSignalLevels`). They were previously implicit
 * — the UI imported the CONCRETE Web Audio classes (`Looper`, `Recorder`,
 * `SamplerAdapter`) and `WebAudioExecutor` returned those instances, which
 * coupled every backend to Web Audio. Here we FORMALIZE the exact surface the
 * UI calls (derived by grepping `src/components` for `.getLooper()` /
 * `.getRecorder()` / `.getSamplerAdapter()` usage) as structural interfaces.
 *
 * The legacy classes already satisfy these interfaces structurally, so
 * `WebAudioExecutor` keeps returning them unchanged (it just types them as the
 * interface). The ojcore executors implement the SAME interfaces with handles
 * backed by the native/wasm engine — so the UI works identically on any backend
 * without importing a single Web-Audio type.
 *
 * The interfaces are intentionally a 1:1 distillation of consumed methods/props;
 * no behavior is added here.
 */

import type { Loop } from '../Looper';
import type { Recording } from '../Recorder';

// ---------------------------------------------------------------------------
// Looper capability
// ---------------------------------------------------------------------------

/**
 * One captured loop layer, as the UI reads it. Aliased to the existing `Loop`
 * record type from `../Looper` (a plain data shape — id, buffer, isMuted,
 * waveformData, libraryItemId, plus Web-Audio bookkeeping fields). Reusing the
 * existing type keeps the UI components — which annotate their loop callbacks as
 * `Loop` — typecheck-clean across every backend; the ojcore loop handle produces
 * `Loop`-shaped objects with the Web-Audio-only fields nulled (the audible loop
 * is engine-rendered; the visual fields are what the UI reads). The DECOUPLING
 * is the capability METHOD surface below, not the leaf record type.
 */
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
    /** Add a loop layer directly from a decoded buffer (clip drop). */
    addLoopFromBuffer(buffer: AudioBuffer): void;
    /** Notified when a new loop layer is captured/added. */
    setOnLoopAdded(callback: (loop: LoopLayer) => void): void;
    /** Notified when a loop layer is deleted (for library trash handling). */
    setOnLoopDeleted(callback: (loop: LoopLayer) => void): void;
    /** Notified with the live recording waveform + playhead (0-100) each frame. */
    setOnWaveformHistoryUpdate(
        callback: (history: number[], playheadPosition: number) => void
    ): void;
}

// ---------------------------------------------------------------------------
// Recorder capability
// ---------------------------------------------------------------------------

/**
 * One completed recording, as the UI reads it. Aliased to the existing
 * `Recording` record type from `../Recorder` (id, blob, duration, timestamp,
 * name, libraryItemId), for the same typecheck-clean reason as {@link LoopLayer}.
 */
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
