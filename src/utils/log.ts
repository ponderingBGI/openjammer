/**
 * Structured console facade (L4, Layer 1) — the immediately-useful log source.
 *
 * Every call here does TWO things:
 *   1. Appends a normalized {@link LogEntry} to the {@link useLogStore} ring
 *      buffer (so the in-app DevLog panel can tail / facet / search it), and
 *   2. Forwards to the matching `console.*` so existing devtools / inspector
 *      behaviour is completely unchanged.
 *
 * This is the seam the repo-wide `console.*` sweep (a separate, governed
 * follow-up — see docs/plans/02-logging-and-observability.md, L4 "Sweep
 * governance") will land onto. THIS wave only provides the facade + store; it
 * does NOT rewrite existing call sites.
 *
 * Severity is the SAME `ojproto::Severity` taxonomy the engine uses (no second
 * level vocabulary): "Trace" | "Debug" | "Info" | "Warn" | "Error". The helpers
 * below (`logDebug`/`logInfo`/`logWarn`/`logError`) and the `logger(scope)`
 * factory are thin sugar over the one {@link log} entry point.
 */

import type { Severity } from '@openjammer/oj-protocol';
import { useLogStore, type LogFields } from '../store/logStore';

/**
 * The console method each severity forwards to. `Trace`/`Debug` collapse onto
 * `console.debug`; everything else maps 1:1. Kept as a lookup so the facade has
 * exactly one branch and stays trivially correct.
 */
const CONSOLE_METHOD: Record<Severity, 'debug' | 'info' | 'warn' | 'error'> = {
    Trace: 'debug',
    Debug: 'debug',
    Info: 'info',
    Warn: 'warn',
    Error: 'error',
};

/**
 * Append a structured entry to the DevLog store AND forward to the matching
 * `console.*`. The single low-level entry point; everything else is sugar.
 *
 * @param level   ojproto severity ("Trace" | "Debug" | "Info" | "Warn" | "Error")
 * @param scope   short subsystem tag, e.g. "audio", "midi", "collab"
 * @param message human-readable message
 * @param fields  optional structured key/values (shown expanded in the panel)
 */
export function log(level: Severity, scope: string, message: string, fields?: LogFields): void {
    // 1) Structured sink: the DevLog ring buffer.
    useLogStore.getState().append({
        level,
        source: 'Ui',
        scope,
        message,
        fields,
    });

    // 2) Native devtools, unchanged. Forward fields only when present so the
    //    console line stays clean for the common no-fields case.
    const method = CONSOLE_METHOD[level];
    const prefix = `[${scope}]`;
    if (fields !== undefined) {
        console[method](prefix, message, fields);
    } else {
        console[method](prefix, message);
    }
}

/** Append a `Debug` entry. */
export function logDebug(scope: string, message: string, fields?: LogFields): void {
    log('Debug', scope, message, fields);
}

/** Append an `Info` entry. */
export function logInfo(scope: string, message: string, fields?: LogFields): void {
    log('Info', scope, message, fields);
}

/** Append a `Warn` entry. */
export function logWarn(scope: string, message: string, fields?: LogFields): void {
    log('Warn', scope, message, fields);
}

/** Append an `Error` entry. */
export function logError(scope: string, message: string, fields?: LogFields): void {
    log('Error', scope, message, fields);
}

/** A scope-bound logger: every method is pre-filled with `scope`. */
export interface ScopedLogger {
    debug: (message: string, fields?: LogFields) => void;
    info: (message: string, fields?: LogFields) => void;
    warn: (message: string, fields?: LogFields) => void;
    error: (message: string, fields?: LogFields) => void;
}

/**
 * Build a logger pre-bound to `scope`, so a module can do:
 *
 * ```ts
 * const log = logger('audio');
 * log.info('context resumed', { sampleRate: 48000 });
 * ```
 */
export function logger(scope: string): ScopedLogger {
    return {
        debug: (message, fields) => log('Debug', scope, message, fields),
        info: (message, fields) => log('Info', scope, message, fields),
        warn: (message, fields) => log('Warn', scope, message, fields),
        error: (message, fields) => log('Error', scope, message, fields),
    };
}
