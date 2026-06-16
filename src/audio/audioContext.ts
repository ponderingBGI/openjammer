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

export type LatencyClassification = 'excellent' | 'good' | 'acceptable' | 'poor' | 'bad';

export interface LatencyMetrics {
    baseLatency: number; // ms - browser processing overhead
    outputLatency: number; // ms - output device delay
    totalLatency: number; // ms - combined one-way latency
    estimatedRoundTrip: number; // ms - total perceived latency for live playing
    classification: LatencyClassification;
    isBluetoothSuspected: boolean; // true if outputLatency > 100ms
    sampleRate: number; // Hz - current sample rate
}

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

// ============================================================================
// Latency Monitoring
// ============================================================================

/**
 * Classify latency based on professional audio standards.
 * @param roundTripMs - Estimated round-trip latency in milliseconds.
 */
function classifyLatency(roundTripMs: number): LatencyClassification {
    if (roundTripMs <= 10) return 'excellent';
    if (roundTripMs <= 20) return 'good';
    if (roundTripMs <= 30) return 'acceptable';
    if (roundTripMs <= 50) return 'poor';
    return 'bad';
}

/** Get current latency metrics from the AudioContext (null if uninitialized). */
export function getLatencyMetrics(): LatencyMetrics | null {
    if (!audioContext) return null;

    const baseLatency = (audioContext.baseLatency ?? 0) * 1000;
    const outputLatency = (audioContext.outputLatency ?? 0) * 1000;
    const totalLatency = baseLatency + outputLatency;

    // Round-trip estimate for live playing: input + processing + output (×2).
    const estimatedRoundTrip = totalLatency * 2;

    // Detect likely Bluetooth audio (typically adds 100-200ms).
    const isBluetoothSuspected = outputLatency > 100;

    return {
        baseLatency,
        outputLatency,
        totalLatency,
        estimatedRoundTrip,
        classification: classifyLatency(estimatedRoundTrip),
        isBluetoothSuspected,
        sampleRate: audioContext.sampleRate,
    };
}

/**
 * Start periodic latency monitoring.
 * @param callback Function called with latency metrics.
 * @param intervalMs Update interval in milliseconds (default 1000ms).
 * @returns Cleanup function to stop monitoring.
 */
export function startLatencyMonitoring(
    callback: (metrics: LatencyMetrics) => void,
    intervalMs: number = 1000
): () => void {
    const intervalId = setInterval(() => {
        const metrics = getLatencyMetrics();
        if (metrics) {
            callback(metrics);
        }
    }, intervalMs);

    return () => clearInterval(intervalId);
}
