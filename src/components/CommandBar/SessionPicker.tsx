/**
 * SessionPicker — the `/resume` view: pick a past Pi session to continue.
 *
 * A cmdk list over `ai_sessions` (newest first). Selecting one loads its history
 * and points the next prompt at it (so the agent picks the conversation back up).
 * Reuses the palette list styling so it feels like the same surface, just a
 * different list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import type { SessionInfo } from '../../ai/piSessions';

/** A short, friendly stem of a session id (they can be long hashes/uuids). */
function shortId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** "just now" / "3m ago" / "2h ago" / "5d ago" from an epoch-ms timestamp. */
function relativeAge(modifiedMs: number): string {
    if (!modifiedMs) return 'unknown';
    const secs = Math.max(0, Math.floor((Date.now() - modifiedMs) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

interface SessionPickerProps {
    /** Called after a session is resumed (return to the chat). */
    onResumed: () => void;
    /** Called to dismiss the picker without resuming (Esc / back). */
    onCancel: () => void;
}

export function SessionPicker({ onResumed, onCancel }: SessionPickerProps) {
    const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
    const listSessions = useAgentSessionStore((s) => s.listSessions);
    const resumeSession = useAgentSessionStore((s) => s.resumeSession);
    const currentId = useAgentSessionStore((s) => s.sessionId);

    useEffect(() => {
        let live = true;
        void listSessions().then((list) => {
            if (live) setSessions(list);
        });
        return () => {
            live = false;
        };
    }, [listSessions]);

    const pick = useCallback(
        async (id: string) => {
            await resumeSession(id);
            onResumed();
        },
        [resumeSession, onResumed],
    );

    return (
        <div className="command-bar-sessions">
            <div className="command-bar-ai-header">
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onCancel}
                    aria-label="Back to chat"
                >
                    ← Chat
                </button>
                <span className="command-bar-ai-badge">Resume</span>
            </div>
            <Command label="Resume a session" loop>
                <Command.Input
                    className="command-bar-input"
                    placeholder="Resume a session…"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancel();
                        }
                    }}
                />
                <Command.List className="command-bar-list">
                    {sessions === null && (
                        <div className="command-bar-empty">Loading sessions…</div>
                    )}
                    {sessions?.length === 0 && (
                        <div className="command-bar-empty">No past sessions yet.</div>
                    )}
                    {sessions?.map((session) => (
                        <Command.Item
                            key={session.id}
                            value={`${session.id} ${relativeAge(session.modifiedMs)}`}
                            className="command-bar-item command-bar-session"
                            onSelect={() => void pick(session.id)}
                        >
                            <span className="command-bar-session-main">
                                {relativeAge(session.modifiedMs)}
                                {session.id === currentId && (
                                    <span className="command-bar-session-current"> · current</span>
                                )}
                            </span>
                            <span className="command-bar-session-id">{shortId(session.id)}</span>
                        </Command.Item>
                    ))}
                </Command.List>
            </Command>
        </div>
    );
}
