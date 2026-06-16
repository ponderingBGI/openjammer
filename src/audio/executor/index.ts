/**
 * Executor selection (U9 + U17 cutover).
 *
 * `OJ_EXECUTOR` selects which audio backend drives the app:
 *   • `webaudio`      — the legacy Web Audio backend (default; NEVER breaks).
 *   • `ojcore-native` — the native Rust ojcore engine over Tauri IPC (the
 *                       sub-5ms path; auto-selected when running under Tauri).
 *   • `ojcore-wasm`   — the same ojcore engine compiled to wasm + AudioWorklet.
 *
 * This is an A/B CUTOVER, not a removal: the ojcore executors are opt-in (or
 * auto under Tauri), and the Web Audio backend remains the safe default so the
 * existing app keeps working. Legacy deletion is a LATER unit.
 *
 * The value is read from `import.meta.env.VITE_OJ_EXECUTOR` (Vite only exposes
 * `VITE_`-prefixed vars to client code). When unset, we default to `webaudio`
 * EXCEPT under Tauri, where `ojcore-native` is auto-selected (the whole reason
 * the desktop shell exists). Any explicit value always wins.
 */

import { WebAudioExecutor } from './WebAudioExecutor';
import { OjcoreNativeExecutor, isTauri } from './OjcoreNativeExecutor';
import { OjcoreWasmExecutor } from './OjcoreWasmExecutor';
import type { Executor } from './Executor';

export type { Executor } from './Executor';
export type {
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe
} from './Executor';
export { WebAudioExecutor } from './WebAudioExecutor';
export { OjcoreNativeExecutor, isTauri } from './OjcoreNativeExecutor';
export { OjcoreWasmExecutor } from './OjcoreWasmExecutor';

/** Known executor identifiers. */
export type ExecutorKind = 'webaudio' | 'ojcore-native' | 'ojcore-wasm';

const DEFAULT_EXECUTOR: ExecutorKind = 'webaudio';

/**
 * Resolve the selected executor kind. Explicit `VITE_OJ_EXECUTOR` always wins;
 * otherwise default to `webaudio`, but auto-pick `ojcore-native` under Tauri.
 */
function resolveExecutorKind(): ExecutorKind {
    const raw = import.meta.env.VITE_OJ_EXECUTOR as string | undefined;
    switch (raw) {
        case 'webaudio':
        case 'ojcore-native':
        case 'ojcore-wasm':
            return raw;
        default:
            // Unset / unknown: default to webaudio, except auto-native on Tauri.
            return isTauri() ? 'ojcore-native' : DEFAULT_EXECUTOR;
    }
}

/** Construct the executor selected by `OJ_EXECUTOR`. */
export function createExecutor(kind: ExecutorKind = resolveExecutorKind()): Executor {
    switch (kind) {
        case 'ojcore-native':
            return new OjcoreNativeExecutor();
        case 'ojcore-wasm':
            return new OjcoreWasmExecutor();
        case 'webaudio':
        default:
            return new WebAudioExecutor();
    }
}

let singleton: Executor | null = null;

/**
 * The process-wide executor singleton. Lazily constructed on first access so the
 * selection happens once and the same instance is shared everywhere — mirroring
 * the previous `audioGraphManager` singleton it routes through.
 */
export function getExecutor(): Executor {
    if (singleton === null) {
        singleton = createExecutor();
    }
    return singleton;
}
