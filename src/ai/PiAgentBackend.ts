/**
 * PiAgentBackend (U20) — the DEFAULT agent backend, driven by Pi via Tauri.
 *
 * TRANSPORT: rpc-subprocess. The Rust `ai_run` command (see
 * `src-tauri/src/ai.rs`) spawns `pi --mode rpc` inside a THROWAWAY git worktree
 * with a stripped env (only the one allowlisted provider key), reads Pi's
 * LF-delimited JSONL stream, and re-emits each parsed line to the webview as a
 * Tauri EVENT on a per-run channel. This class:
 *   1. starts a unique run channel,
 *   2. subscribes to it BEFORE invoking the command (no lost first lines),
 *   3. invokes `ai_run`, and
 *   4. yields normalized {@link AgentEvent}s until a terminal event arrives.
 *
 * Pi is an UNTRUSTED GENERATOR: nothing here executes its tool calls. We only
 * forward them upward as `tool-call` events; the session decides whether to
 * apply them, gated by Approve/Reject.
 *
 * When Pi is not installed / not configured, the Rust side returns an error,
 * which is surfaced as a single terminal `error` event (never a throw). When NOT
 * under Tauri, {@link available} is false and the UI shows the desktop-only
 * state instead of calling this.
 */

import { getInvoke, isTauri, listen } from './tauri';
import type {
    AgentBackend,
    AgentEvent,
    AgentTask,
    AgentToolCall,
    AgentUiRequest,
} from './types';

/**
 * The wire shape the Rust backend emits per Pi RPC line. Kept intentionally
 * loose: Pi's RPC schema evolves, so we normalize defensively (unknown line
 * kinds become a `thought`). This MUST stay in sync with the `PiStreamLine`
 * serialization in `src-tauri/src/ai.rs`.
 */
export interface PiStreamLine {
    kind: 'thought' | 'tool-call' | 'result' | 'error' | 'ui-request';
    /** Present for `thought` / `result` / `error`. */
    text?: string;
    /** Present for `tool-call`: the proposed call. */
    call?: AgentToolCall;
    /** Present for `tool-call` (the call id) / `ui-request` (the request id). */
    id?: string;
    /** Present for `ui-request`: the raw extension UI request payload. */
    request?: AgentUiRequest;
}

let runCounter = 0;

/** Generate a unique event-channel name per run, so concurrent runs don't mix. */
function newRunChannel(): string {
    runCounter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `ai-run://${Date.now()}-${runCounter}-${rand}`;
}

/** Normalize a raw Pi line into a typed {@link AgentEvent}. */
function toAgentEvent(line: PiStreamLine): AgentEvent {
    switch (line.kind) {
        case 'tool-call':
            if (line.call) {
                return { kind: 'tool-call', call: line.call, id: line.id ?? '' };
            }
            return { kind: 'thought', text: 'malformed tool-call line (ignored)' };
        case 'result':
            return { kind: 'result', summary: line.text ?? 'Done.' };
        case 'error':
            return { kind: 'error', message: line.text ?? 'Unknown agent error.' };
        case 'ui-request':
            return {
                kind: 'ui-request',
                request: line.request ?? { method: 'unknown' },
                id: line.id ?? '',
            };
        case 'thought':
        default:
            return { kind: 'thought', text: line.text ?? '' };
    }
}

/** True for the two terminal event kinds that end a run. */
function isTerminal(e: AgentEvent): boolean {
    return e.kind === 'result' || e.kind === 'error';
}

export class PiAgentBackend implements AgentBackend {
    readonly id = 'pi';

    available(): boolean {
        // Pi runs only inside the desktop shell (Rust spawns the subprocess).
        return isTauri() && getInvoke() !== null;
    }

    async *run(task: AgentTask): AsyncIterable<AgentEvent> {
        const invoke = getInvoke();
        if (!invoke) {
            yield {
                kind: 'error',
                message: 'AI requires the OpenJammer desktop app (Tauri not detected).',
            };
            return;
        }

        const channel = newRunChannel();

        // A simple async queue bridging the event callback to this generator.
        const queue: AgentEvent[] = [];
        let notify: (() => void) | null = null;
        let done = false;

        const push = (e: AgentEvent) => {
            queue.push(e);
            if (isTerminal(e)) done = true;
            notify?.();
        };

        // Subscribe BEFORE invoking so we never miss the first streamed line.
        const unlisten = await listen<PiStreamLine>(channel, (payload) => {
            push(toAgentEvent(payload));
        });

        // Kick off the run. A rejected invoke (Pi missing / config error / panic)
        // is surfaced as a terminal error event rather than thrown.
        invoke('ai_run', {
            prompt: task.prompt,
            providerKey: task.providerKey ?? null,
            provider: task.provider ?? null,
            modelId: task.modelId ?? null,
            channel,
        }).catch((err: unknown) => {
            push({ kind: 'error', message: `ai_run failed: ${describe(err)}` });
        });

        try {
            // Drain the queue until a terminal event has been observed.
            for (;;) {
                while (queue.length > 0) {
                    const e = queue.shift() as AgentEvent;
                    yield e;
                    if (isTerminal(e)) return;
                }
                if (done) return;
                await new Promise<void>((resolve) => {
                    notify = resolve;
                });
                notify = null;
            }
        } finally {
            unlisten?.();
        }
    }
}

/** Best-effort stringify of an unknown thrown value. */
function describe(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
