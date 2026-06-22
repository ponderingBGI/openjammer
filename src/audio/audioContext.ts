/**
 * AudioContext provider — the browser audio-context lifecycle, engine-agnostic.
 *
 * This is shared browser-audio infrastructure (NOT the legacy Web Audio engine,
 * which was deleted in U-DEDUP). The ojcore-wasm executor hosts its engine in an
 * `AudioWorklet` on this context, and the UI uses it for sample decoding, the
 * waveform editor, recorder WAV export, etc. It has no dependency on the deleted
 * Web Audio graph and no Tone.js — it is a thin wrapper over the platform
 * `AudioContext` plus latency diagnostics.
 */

let audioContext: AudioContext | null = null;

/** Promise to track ongoing initialization (prevents race condition). */
let initializationPromise: Promise<AudioContext> | null = null;

// ============================================================================
// Types
// ============================================================================

export interface AudioContextConfig {
    sampleRate?: number;
    latencyHint?: AudioContextLatencyCategory | number;
    /** When true, requests absolute-minimum latency (best for live USB interfaces). */
    lowLatencyMode?: boolean;
}

// Latency measurement no longer lives here. It is a backend concern, owned by the
// active executor via `Executor.getLatency()` (see `audio/executor/latency.ts`):
// the wasm tier reads this AudioContext, the native tier reads the cpal stream.
// This module is now only the browser-context lifecycle + decode/waveform host.

// ============================================================================
// Audio Context Initialization
// ============================================================================

/**
 * Initialize the audio context (must be called after a user gesture).
 * Uses a promise guard to prevent race conditions from concurrent calls.
 */
export async function initAudioContext(config?: AudioContextConfig): Promise<AudioContext> {
    if (audioContext && audioContext.state !== 'closed') {
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        return audioContext;
    }

    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async () => {
        try {
            // LOW LATENCY OPTIMIZATION: a latencyHint of 0 asks the browser for the
            // smallest possible buffer (best for live MIDI performance).
            const latencyHint = config?.lowLatencyMode
                ? 0
                : config?.latencyHint !== undefined
                  ? config.latencyHint
                  : 'interactive';

            audioContext = new AudioContext({
                sampleRate: config?.sampleRate || 48000,
                latencyHint,
            });

            return audioContext;
        } catch (error) {
            initializationPromise = null;
            throw error;
        }
    })();

    return initializationPromise;
}

/**
 * Reinitialize the AudioContext with new configuration (after a user gesture).
 * Safely waits for any ongoing initialization before closing the context.
 */
export async function reinitAudioContext(config: AudioContextConfig): Promise<AudioContext> {
    if (initializationPromise) {
        try {
            await initializationPromise;
        } catch {
            // Ignore errors from a previous init - we're reinitializing anyway.
        }
    }

    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close();
    }

    audioContext = null;
    initializationPromise = null;

    return initAudioContext(config);
}

/** Get the current audio context, or null if not initialized. */
export function getAudioContext(): AudioContext | null {
    return audioContext;
}

/** Check if audio is ready (context exists and is running). */
export function isAudioReady(): boolean {
    return audioContext !== null && audioContext.state === 'running';
}

/** Resume the audio context if it is suspended. */
export async function resumeAudio(): Promise<void> {
    if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }
}
