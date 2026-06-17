/**
 * Structured console facade (L4, Layer 1) — the immediately-useful log source.
 *
 * Every call here does TWO things:
 *   1. Appends a normalized {@link LogEntry} to the {@link useLogStore} ring
 *      buffer (so the in-app DevLog panel can tail / facet / search it), and
 *   2. Forwards to the matching `console.*` so existing devtools / inspector
 *      behaviour is completely unchanged.
 *
 * This is the seam the repo-wide `console.*` sweep (the L4 logging design)
 * lands onto, routing call sites through this facade instead of raw `console.*`.
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
 * The ORIGINAL console methods, captured at module load — BEFORE
 * {@link installConsoleCapture} can patch them. The facade forwards through
 * these (not `console`) so that:
 *   • a `log()` call appends to the store EXACTLY ONCE (here), never again via a
 *     patched `console`, and
 *   • there is no infinite recursion once `console.*` is itself routed back into
 *     the store by the capture installer.
 */
const ORIGINAL_CONSOLE: Record<'debug' | 'info' | 'warn' | 'error', (...a: unknown[]) => void> = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
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

    // 2) Native devtools, unchanged. Forward through the CAPTURED originals (not
    //    `console`) so an installed console-capture never re-ingests this entry.
    //    Forward fields only when present so the line stays clean when there are none.
    const method = CONSOLE_METHOD[level];
    const prefix = `[${scope}]`;
    if (fields !== undefined) {
        ORIGINAL_CONSOLE[method](prefix, message, fields);
    } else {
        ORIGINAL_CONSOLE[method](prefix, message);
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

// ============================================================================
// Console capture — make EVERY console.* line show up in the DevLog
// ============================================================================

/** Map a captured console method onto an ojproto {@link Severity}. */
const CAPTURE_LEVEL: Record<'log' | 'debug' | 'info' | 'warn' | 'error', Severity> = {
    log: 'Info',
    debug: 'Debug',
    info: 'Info',
    warn: 'Warn',
    error: 'Error',
};

/** True once {@link installConsoleCapture} has patched `console` (idempotent guard). */
let consoleCaptured = false;

/**
 * Render an arbitrary `console.*` argument list into a `(message, fields)` pair
 * for the DevLog. Strings join into the message; the first non-string object is
 * carried into `fields.detail` so structured payloads survive without bloating
 * the row. Best-effort and never throws.
 */
function describeConsoleArgs(args: unknown[]): { message: string; fields?: LogFields } {
    const parts: string[] = [];
    let detail: unknown;
    for (const a of args) {
        if (typeof a === 'string') parts.push(a);
        else if (typeof a === 'number' || typeof a === 'boolean' || a == null) parts.push(String(a));
        else {
            if (detail === undefined) detail = a;
            try {
                parts.push(typeof a === 'object' ? JSON.stringify(a) : String(a));
            } catch {
                parts.push(String(a));
            }
        }
    }
    const message = parts.join(' ').slice(0, 2000);
    return detail !== undefined ? { message, fields: { detail } } : { message };
}

/**
 * Route ALL raw `console.{log,debug,info,warn,error}` calls into the DevLog ring
 * (source `"Ui"`, scope `"console"`) IN ADDITION to their normal devtools
 * output. Call ONCE at app start (`main.tsx`). Without this the panel only sees
 * call sites that went through the {@link log} facade; with it, every existing
 * `console.*` in the app becomes live, faceted, searchable log content — and the
 * AI assistant's `get_logs` tool can read it to help debug a broken setup.
 *
 * SAFE BY CONSTRUCTION: the facade forwards through {@link ORIGINAL_CONSOLE}, so
 * patching `console` here can never recurse or double-append a facade entry.
 * Idempotent — a second call is a no-op (StrictMode-safe).
 */
export function installConsoleCapture(): void {
    if (consoleCaptured || typeof console === 'undefined') return;
    consoleCaptured = true;

    (['log', 'debug', 'info', 'warn', 'error'] as const).forEach((method) => {
        const passthrough =
            method === 'log'
                ? ORIGINAL_CONSOLE.info
                : ORIGINAL_CONSOLE[method as 'debug' | 'info' | 'warn' | 'error'];
        console[method] = (...args: unknown[]): void => {
            try {
                const { message, fields } = describeConsoleArgs(args);
                useLogStore.getState().append({
                    level: CAPTURE_LEVEL[method],
                    source: 'Ui',
                    scope: 'console',
                    message,
                    ...(fields !== undefined ? { fields } : {}),
                });
            } catch {
                // Logging must never break the app — swallow capture failures.
            }
            passthrough(...args);
        };
    });
}
