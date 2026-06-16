/**
 * Executor selection (U-DEDUP).
 *
 * ojcore is now the ONE audio engine. `OJ_EXECUTOR` only selects WHICH ojcore
 * transport drives the app:
 *   • `ojcore-native` — the native Rust ojcore engine over Tauri IPC (the
 *                       sub-5ms path; auto-selected when running under Tauri).
 *   • `ojcore-wasm`   — the same ojcore engine compiled to wasm + AudioWorklet
 *                       (the browser default).
 *
 * The legacy Web Audio backend was removed in U-DEDUP; there is no `webaudio`
 * kind anymore. The value is read from `import.meta.env.VITE_OJ_EXECUTOR` (Vite
 * only exposes `VITE_`-prefixed vars to client code). When unset we default to
 * `ojcore-wasm` in the browser and auto-pick `ojcore-native` under Tauri. Any
 * explicit (valid) value always wins.
 */

import { OjcoreNativeExecutor, isTauri } from './OjcoreNativeExecutor';
import { OjcoreWasmExecutor } from './OjcoreWasmExecutor';
import type { Executor } from './Executor';

export type { Executor } from './Executor';
export type {
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe,
    Loop,
    LoopLayer,
    Recording,
    RecordingEntry,
    LooperHandle,
    RecorderHandle,
    SamplerHandle,
    SignalLevels,
    SignalLevelsCallback
} from './Executor';
export { INFINITE_DURATION, isInfiniteDuration } from './Executor';
export { OjcoreNativeExecutor, isTauri } from './OjcoreNativeExecutor';
export { OjcoreWasmExecutor } from './OjcoreWasmExecutor';

/** Known executor identifiers (ojcore-only after U-DEDUP). */
export type ExecutorKind = 'ojcore-native' | 'ojcore-wasm';

/** Default ojcore transport in the browser (native is auto-picked under Tauri). */
const DEFAULT_EXECUTOR: ExecutorKind = 'ojcore-wasm';

/**
 * Resolve the selected executor kind. Explicit `VITE_OJ_EXECUTOR` always wins;
 * otherwise default to `ojcore-wasm`, but auto-pick `ojcore-native` under Tauri.
 */
function resolveExecutorKind(): ExecutorKind {
    const raw = import.meta.env.VITE_OJ_EXECUTOR as string | undefined;
    switch (raw) {
        case 'ojcore-native':
        case 'ojcore-wasm':
            return raw;
        default:
            // Unset / unknown: default to ojcore-wasm, except auto-native on Tauri.
            return isTauri() ? 'ojcore-native' : DEFAULT_EXECUTOR;
    }
}

/** Construct the executor selected by `OJ_EXECUTOR`. */
export function createExecutor(kind: ExecutorKind = resolveExecutorKind()): Executor {
    switch (kind) {
        case 'ojcore-native':
            return new OjcoreNativeExecutor();
        case 'ojcore-wasm':
        default:
            return new OjcoreWasmExecutor();
    }
}

let singleton: Executor | null = null;

/**
 * The process-wide executor singleton. Lazily constructed on first access so the
 * selection happens once and the same instance is shared everywhere.
 */
export function getExecutor(): Executor {
    if (singleton === null) {
        singleton = createExecutor();
    }
    return singleton;
}
