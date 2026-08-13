/**
 * Pi session service — the frontend half of the native session seam
 * (`src-tauri/src/ai.rs`: `ai_sessions`, `ai_session_messages`, `ai_command`).
 *
 * The Ctrl/Cmd+K chat is PERSISTENT and SESSION-AWARE: the agent keeps one Pi
 * session per conversation (its history lives in `~/.openjammer/agent`), so you
 * can close the app and continue weeks later. This module is the thin bridge for
 * the non-streaming session verbs the chat drives:
 *   - `listSessions()`     → the resume picker's list (`/resume`),
 *   - `loadSessionMessages(id)` → a prior session's history to render on resume,
 *   - `runCommand(envelope)`    → forward a raw RPC verb (`new_session`,
 *     `switch_session`, …) to the warm child, resolving with any session id it
 *     surfaced (so the store can persist + reattach to it).
 *
 * Streaming prompts go through {@link PiAgentBackend.run}; this is only the
 * request/response side. Everything no-ops gracefully in a plain browser.
 */

import { getInvoke, isTauri, listen } from './tauri';
import type { PiStreamLine } from './PiAgentBackend';

/** One persisted session, newest-first from `ai_sessions`. */
export interface SessionInfo {
    id: string;
    modifiedMs: number;
}

/** One renderable message from a resumed session (`ai_session_messages`). */
export interface DisplayMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;
    tool?: string;
}

export interface PiCommandRuntime {
    providerKey?: string;
    providerKeys?: Record<string, string>;
    providerBaseUrls?: Record<string, string>;
    providerCustomModels?: Record<string, string[]>;
    provider?: string;
    modelId?: string;
    thinkingLevel?: PiThinkingLevel;
    yolo?: boolean;
}

/** One slash command Pi says is available via `get_commands`. */
export interface PiSlashCommand {
    name: string;
    description?: string;
    source: 'extension' | 'prompt' | 'skill';
    location?: 'user' | 'project' | 'path';
    path?: string;
}

export interface PiModel {
    provider: string;
    id: string;
    name?: string;
    reasoning?: unknown;
    api?: string;
    [key: string]: unknown;
}

/** A loaded session transcript; `incomplete` flags unparseable lines. */
export interface SessionTranscript {
    messages: DisplayMessage[];
    incomplete: boolean;
}

/** True when the session verbs can actually run (desktop shell). */
export function sessionsAvailable(): boolean {
    return isTauri() && getInvoke() !== null;
}

/** List the agent's persisted sessions, newest first. `[]` in the browser. */
export async function listSessions(): Promise<SessionInfo[]> {
    const invoke = getInvoke();
    if (!invoke) return [];
    try {
        return (await invoke('ai_sessions')) as SessionInfo[];
    } catch {
        return [];
    }
}

/** Load a prior session's messages for display (the `/resume` history). */
export async function loadSessionMessages(id: string): Promise<SessionTranscript> {
    const invoke = getInvoke();
    if (!invoke) return { messages: [], incomplete: false };
    try {
        return (await invoke('ai_session_messages', { id })) as SessionTranscript;
    } catch {
        // Couldn't read/parse the file — let the caller still switch, but say so.
        return { messages: [], incomplete: true };
    }
}

let cmdCounter = 0;

/** A unique event-channel name per command, so concurrent commands don't mix. */
function newCmdChannel(): string {
    cmdCounter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `ai-cmd://${Date.now()}-${cmdCounter}-${rand}`;
}

/**
 * Forward ONE raw RPC envelope to the warm Pi child and resolve once Pi acks,
 * carrying any session id the command surfaced (e.g. `new_session` → the new id)
 * and any structured response data. Resolves `{ ok: false }` immediately in the
 * browser or if no warm child exists.
 */
export async function runCommand(
    envelope: Record<string, unknown>,
    runtime: PiCommandRuntime = {},
): Promise<{ ok: boolean; sessionId?: string; data?: unknown }> {
    const invoke = getInvoke();
    if (!invoke) return { ok: false };

    const channel = newCmdChannel();
    let sessionId: string | undefined;
    let data: unknown;
    let settle!: (ok: boolean) => void;
    const done = new Promise<boolean>((resolve) => {
        settle = resolve;
    });

    const unlisten = await listen<PiStreamLine>(channel, (line) => {
        if (line.kind === 'session' && line.text) sessionId = line.text;
        else if (line.kind === 'result') {
            data = line.data;
            settle(true);
        } else if (line.kind === 'error') settle(false);
    });

    invoke('ai_command', {
        command: envelope,
        channel,
        providerKey: runtime.providerKey ?? null,
        providerKeys: runtime.providerKeys ?? null,
        providerBaseUrls: runtime.providerBaseUrls ?? null,
        providerCustomModels: runtime.providerCustomModels ?? null,
        provider: runtime.provider ?? null,
        modelId: runtime.modelId ?? null,
        thinkingLevel: runtime.thinkingLevel ?? null,
        yolo: runtime.yolo ?? false,
    }).catch(() => settle(false));

    const ok = await done;
    unlisten?.();
    return { ok, sessionId, data };
}

/** Ask the warm Pi child for dynamic slash commands (extensions, prompts, skills). */
export async function listSlashCommands(runtime?: PiCommandRuntime): Promise<PiSlashCommand[]> {
    const res = await runCommand({ type: 'get_commands' }, runtime);
    if (!res.ok || !res.data || typeof res.data !== 'object') return [];
    const commands = (res.data as { commands?: unknown }).commands;
    if (!Array.isArray(commands)) return [];
    return commands.filter(isPiSlashCommand);
}

export async function getState(runtime?: PiCommandRuntime): Promise<{ ok: boolean; data?: unknown }> {
    return runCommand({ type: 'get_state' }, runtime);
}

export async function listAvailableModels(runtime?: PiCommandRuntime): Promise<PiModel[]> {
    const res = await runCommand({ type: 'get_available_models' }, runtime);
    if (!res.ok || !res.data || typeof res.data !== 'object') return [];
    const models = (res.data as { models?: unknown }).models;
    if (!Array.isArray(models)) return [];
    return models.filter(isPiModel);
}

export async function setModel(
    provider: string,
    modelId: string,
    runtime?: PiCommandRuntime,
): Promise<{ ok: boolean; data?: unknown }> {
    return runCommand({ type: 'set_model', provider, modelId }, runtime);
}

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Pre-spawn the warm Pi child on intent (entering AI mode) so the first prompt
 * has no cold start. Fire-and-forget and idempotent; a no-op in the browser or
 * when nothing is configured yet. Pass the SAME runtime the next prompt will use
 * so the warm child's fingerprint matches and is reused rather than respawned.
 */
export async function prewarmAgent(runtime: PiCommandRuntime = {}): Promise<void> {
    const invoke = getInvoke();
    if (!invoke) return;
    try {
        await invoke('ai_prewarm', {
            providerKey: runtime.providerKey ?? null,
            providerKeys: runtime.providerKeys ?? null,
            providerBaseUrls: runtime.providerBaseUrls ?? null,
            providerCustomModels: runtime.providerCustomModels ?? null,
            provider: runtime.provider ?? null,
            modelId: runtime.modelId ?? null,
            yolo: runtime.yolo ?? false,
        });
    } catch {
        // Best-effort: a failed prewarm just means the first prompt pays cold start.
    }
}

/** Kill the warm child so the next prompt reloads Pi resources. */
export async function restartAgent(): Promise<boolean> {
    const invoke = getInvoke();
    if (!invoke) return false;
    try {
        await invoke('ai_restart');
        return true;
    } catch {
        return false;
    }
}

function isPiSlashCommand(value: unknown): value is PiSlashCommand {
    if (!value || typeof value !== 'object') return false;
    const v = value as { name?: unknown; source?: unknown };
    return (
        typeof v.name === 'string' &&
        (v.source === 'extension' || v.source === 'prompt' || v.source === 'skill')
    );
}

function isPiModel(value: unknown): value is PiModel {
    if (!value || typeof value !== 'object') return false;
    const v = value as { provider?: unknown; id?: unknown };
    return typeof v.provider === 'string' && typeof v.id === 'string';
}
