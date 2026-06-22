/**
 * Latency seam — the single source of truth for "how late is the sound?".
 *
 * Each executor reports the latency of the backend that is ACTUALLY producing
 * sound, via {@link Executor.getLatency}: the wasm tier reads the AudioContext it
 * renders its worklet into, the native tier reads the cpal stream's negotiated
 * buffer over IPC (`query_stream`). The UI never reaches into a specific backend —
 * it polls the active executor and shows the one honest number, so the browser
 * AudioContext's latency can never leak onto the native readout (the bug that made
 * a sub-5 ms MOTU stream report ~111 ms — that figure was the WebView2 decode
 * context, not the engine).
 *
 * `classifyLatency` lives here too so the thresholds are defined exactly once.
 */

/** Professional-audio latency bands, worst → best, for the UI's status colour. */
export type LatencyClassification = 'excellent' | 'good' | 'acceptable' | 'poor' | 'bad';

/**
 * A normalized latency snapshot from whichever backend is making sound. The
 * `source` discriminates the two tiers so the UI can label the breakdown
 * honestly (browser processing + output device vs. negotiated engine buffer).
 */
export interface LatencyReport {
    /** Which backend produced this snapshot — the active executor's tier. */
    source: 'native' | 'browser';
    /** Whether that backend is actually running (false ⇒ no sound yet). */
    running: boolean;
    /** Browser-processing latency in ms (always 0 on native — no Web Audio path). */
    baseLatency: number;
    /** Output-device latency in ms (the cpal buffering floor on native). */
    outputLatency: number;
    /** The headline number the UI shows: estimated round-trip in ms. */
    roundTripMs: number;
    /** Negotiated output sample rate in Hz. */
    sampleRate: number;
    /**
     * Native fixed buffer size in frames. `null` when the device chose its own
     * period (native) or when the tier has no fixed buffer to report (browser).
     */
    bufferFrames: number | null;
    /** Round-trip classification, derived from {@link roundTripMs}. */
    classification: LatencyClassification;
    /** Browser-only heuristic: output latency > 100 ms smells like Bluetooth. */
    isBluetoothSuspected: boolean;
}

/**
 * Classify a round-trip latency (ms) into a professional-audio band. The single
 * definition of the thresholds — both executors and the UI route through here.
 */
export function classifyLatency(roundTripMs: number): LatencyClassification {
    if (roundTripMs <= 10) return 'excellent';
    if (roundTripMs <= 20) return 'good';
    if (roundTripMs <= 30) return 'acceptable';
    if (roundTripMs <= 50) return 'poor';
    return 'bad';
}
