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
 * carrying any session id the command surfaced (e.g. `new_session` → the new id).
 * Resolves `{ ok: false }` immediately in the browser or if no warm child exists.
 */
export async function runCommand(
    envelope: Record<string, unknown>,
): Promise<{ ok: boolean; sessionId?: string }> {
    const invoke = getInvoke();
    if (!invoke) return { ok: false };

    const channel = newCmdChannel();
    let sessionId: string | undefined;
    let settle!: (ok: boolean) => void;
    const done = new Promise<boolean>((resolve) => {
        settle = resolve;
    });

    const unlisten = await listen<PiStreamLine>(channel, (line) => {
        if (line.kind === 'session' && line.text) sessionId = line.text;
        else if (line.kind === 'result') settle(true);
        else if (line.kind === 'error') settle(false);
    });

    invoke('ai_command', { command: envelope, channel }).catch(() => settle(false));

    const ok = await done;
    unlisten?.();
    return { ok, sessionId };
}
