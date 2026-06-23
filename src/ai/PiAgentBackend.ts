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
 * Pi is an UNTRUSTED GENERATOR: nothing here executes arbitrary code. We only
 * forward allowlisted OpenJammer graph verbs upward as `tool-call` events; the
 * session applies them through the same undoable store actions the user drives by
 * hand.
 *
 * When Pi is not installed / not configured, the Rust side returns an error,
 * which is surfaced as a single terminal `error` event (never a throw). When NOT
 * under Tauri, {@link available} is false and the UI shows the desktop-only
 * state instead of calling this.
 */

import { getInvoke, isTauri, listen } from './tauri';
import { isAgentToolName } from './types';
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
    kind: 'thought' | 'status' | 'tool-call' | 'result' | 'error' | 'ui-request' | 'session';
    /** Present for `thought` / `status` / `result` / `error`; the session id for `session`. */
    text?: string;
    /** Present for `tool-call`: the proposed call. */
    call?: AgentToolCall;
    /** Present for `tool-call` (the call id) / `ui-request` (the request id). */
    id?: string;
    /** Present for `ui-request`: the raw extension UI request payload. */
    request?: AgentUiRequest;
    /** Present for command responses with structured payloads. */
    data?: unknown;
}

let runCounter = 0;

/** Generate a unique event-channel name per run, so concurrent runs don't mix. */
function newRunChannel(): string {
    runCounter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `ai-run://${Date.now()}-${runCounter}-${rand}`;
}

/** The base name of a path (last segment), for a readable self-edit summary. */
function baseName(p: string): string {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
}

/**
 * Recognize a SELF-EDIT — Philia editing its own memory/skills — among the NON-oj
 * Pi tools, so it reads as "you editing you" (a distinct chip) instead of an
 * "unsupported tool" line. Two reliable signals: a file write/edit/bash whose path
 * (or command) targets `pi-memory`, and the memory-package verbs by name. Returns a
 * human summary for the chip, or null when it's some other (genuinely unsupported)
 * Pi tool.
 */
export function classifySelfEdit(name: string, args: unknown): string | null {
    const a = (args ?? {}) as Record<string, unknown>;
    // The host-mediated self-package tool is unambiguous — Philia authoring a tool.
    if (name === 'save_self_package') {
        const pkg = String(a.name ?? '').trim();
        return pkg ? `saved itself a tool (${pkg})` : 'saved itself a tool';
    }
    const pathLike = String(a.path ?? a.file ?? a.filename ?? a.target ?? '');
    const cmd = String(a.command ?? a.cmd ?? '');
    const touchesMemory = pathLike.includes('pi-memory') || cmd.includes('pi-memory');
    const isWrite = /^(write|edit|create|append|str_replace|fs_write|bash|sh|tee|cp|mv)\b/i.test(name);
    if (isWrite && touchesMemory) {
        if (/about-you\.md/i.test(pathLike)) return 'updated what it knows about you';
        if (/\.md$/i.test(pathLike)) return `learned a skill (${baseName(pathLike)})`;
        return 'updated its memory';
    }
    // pi-persistent-intelligence verbs (name-based): remember / recall / learn / memory.
    if (/(^|[._-])(remember|recall|memor|learn)/i.test(name)) {
        return 'remembered something for next time';
    }
    return null;
}

/** Normalize a raw Pi line into a typed {@link AgentEvent}. */
function toAgentEvent(line: PiStreamLine): AgentEvent {
    switch (line.kind) {
        case 'tool-call': {
            const call = line.call as Partial<AgentToolCall> | undefined;
            if (call && isAgentToolName(call.name)) {
                return { kind: 'tool-call', call: call as AgentToolCall, id: line.id ?? '' };
            }
            const name = typeof call?.name === 'string' ? call.name : 'unknown';
            // A self-edit is the SHAPE-SELF hand at work — legitimate, just not a
            // canvas tool. Surface it as its own kind, never an "unsupported" line.
            const selfSummary = classifySelfEdit(name, (call as { args?: unknown })?.args);
            if (selfSummary) {
                return { kind: 'self-edit', summary: selfSummary, id: line.id ?? '' };
            }
            return {
                kind: 'thought',
                text: `Ignored unsupported Pi tool "${name}". OpenJammer only applies canvas graph tools.\n`,
            };
        }
        case 'status':
            return { kind: 'status', message: line.text ?? '' };
        case 'result':
            return { kind: 'result', summary: line.text ?? 'Done.' };
        case 'error':
            return { kind: 'error', message: line.text ?? 'Unknown agent error.' };
        case 'session':
            return { kind: 'session', sessionId: line.text ?? '' };
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
            providerKeys: task.providerKeys ?? null,
            providerBaseUrls: task.providerBaseUrls ?? null,
            providerCustomModels: task.providerCustomModels ?? null,
            provider: task.provider ?? null,
            modelId: task.modelId ?? null,
            thinkingLevel: task.thinkingLevel ?? null,
            yolo: task.yolo ?? false,
            sessionId: task.sessionId ?? null,
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
