/**
 * Executor selection (U9).
 *
 * `OJ_EXECUTOR` selects which audio backend the app drives. Only the Web Audio
 * backend exists today; the switch exists so a future wasm/native ojcore-backed
 * executor can be slotted in without touching call sites.
 *
 * The value is read from `import.meta.env.VITE_OJ_EXECUTOR` (Vite only exposes
 * `VITE_`-prefixed vars to client code) and defaults to `'webaudio'`.
 */

import { WebAudioExecutor } from './WebAudioExecutor';
import type { Executor } from './Executor';

export type { Executor } from './Executor';
export type {
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe
} from './Executor';
export { WebAudioExecutor } from './WebAudioExecutor';

/** Known executor identifiers. Only `webaudio` is implemented today. */
export type ExecutorKind = 'webaudio';

const DEFAULT_EXECUTOR: ExecutorKind = 'webaudio';

function resolveExecutorKind(): ExecutorKind {
    const raw = import.meta.env.VITE_OJ_EXECUTOR as string | undefined;
    switch (raw) {
        case 'webaudio':
            return 'webaudio';
        default:
            // Unknown / unset → fall back to the only implemented backend.
            return DEFAULT_EXECUTOR;
    }
}

/** Construct the executor selected by `OJ_EXECUTOR`. */
export function createExecutor(kind: ExecutorKind = resolveExecutorKind()): Executor {
    switch (kind) {
        case 'webaudio':
            return new WebAudioExecutor();
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
