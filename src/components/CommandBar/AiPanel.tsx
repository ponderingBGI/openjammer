/**
 * AiPanel (U20) — the AI half of the Ctrl/Cmd+K command bar.
 *
 * The SEARCH half (CommandBar) hands off here on Tab: the typed text becomes the
 * agent prompt. This panel:
 *   - on a non-Tauri browser, shows the "AI requires the desktop app" state and
 *     disables Enter (per the project plan: AI is NATIVE/HYBRID ONLY);
 *   - inside Tauri, runs the prompt via the {@link getAgentBackend default backend}
 *     (Pi over the Tauri rpc-subprocess) on Enter, renders the STREAMING
 *     transcript, and surfaces Approve / Reject once the agent finishes.
 *
 * The transaction (apply-on-stream, revert-on-reject) lives in
 * {@link useAgentSessionStore}; this is the view layer over it.
 */

import { useCallback, useEffect, useRef } from 'react';
import { getAgentBackend } from '../../ai';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import type { TranscriptEntry } from '../../store/agentSessionStore';

interface AiPanelProps {
    /** Prompt carried over from the search input on the Tab handoff. */
    initialPrompt: string;
    /** Return to search mode (Esc / "Back"). */
    onBack: () => void;
    /** Close the whole palette. */
    onClose: () => void;
}

export function AiPanel({ initialPrompt, onBack, onClose }: AiPanelProps) {
    const phase = useAgentSessionStore((s) => s.phase);
    const transcript = useAgentSessionStore((s) => s.transcript);
    const error = useAgentSessionStore((s) => s.error);
    const start = useAgentSessionStore((s) => s.start);
    const approve = useAgentSessionStore((s) => s.approve);
    const reject = useAgentSessionStore((s) => s.reject);

    const inputRef = useRef<HTMLInputElement>(null);
    const promptRef = useRef(initialPrompt);

    const backend = getAgentBackend();
    const available = backend.available();

    // Focus the AI input on mount; preserve the handed-over text as the value.
    useEffect(() => {
        if (inputRef.current) inputRef.current.value = promptRef.current;
        inputRef.current?.focus();
    }, []);

    const runPrompt = useCallback(() => {
        const prompt = (inputRef.current?.value ?? '').trim();
        if (!prompt || !available) return;
        void start(backend, { prompt });
    }, [available, backend, start]);

    const running = phase === 'running';
    const awaitingApproval = phase === 'awaiting-approval';
    const errored = phase === 'error';

    return (
        <div className="command-bar-ai" data-available={available}>
            <div className="command-bar-ai-header">
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onBack}
                    aria-label="Back to search"
                >
                    ← Search
                </button>
                <span className="command-bar-ai-badge">AI</span>
            </div>

            {!available ? (
                <DesktopOnly onClose={onClose} />
            ) : (
                <>
                    <input
                        ref={inputRef}
                        className="command-bar-input command-bar-ai-input"
                        placeholder="Describe what to build, then press Enter…"
                        defaultValue={initialPrompt}
                        disabled={running}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                runPrompt();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                onBack();
                            }
                        }}
                    />

                    <div className="command-bar-ai-transcript">
                        {transcript.length === 0 && !running && (
                            <p className="command-bar-empty">
                                Press Enter to ask the agent to build it.
                            </p>
                        )}
                        {transcript.map((entry) => (
                            <TranscriptLine key={entry.id} entry={entry} />
                        ))}
                        {running && (
                            <p className="command-bar-ai-status">Agent is working…</p>
                        )}
                        {errored && error && (
                            <p className="command-bar-ai-error">{error}</p>
                        )}
                    </div>

                    {awaitingApproval && (
                        <div className="command-bar-ai-actions">
                            <button
                                type="button"
                                className="command-bar-ai-reject"
                                onClick={reject}
                            >
                                Reject
                            </button>
                            <button
                                type="button"
                                className="command-bar-ai-approve"
                                onClick={() => {
                                    approve();
                                    onClose();
                                }}
                            >
                                Approve
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/** One transcript line, styled per event kind. */
function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
    const { event } = entry;
    switch (event.kind) {
        case 'thought':
            return <p className="command-bar-ai-thought">{event.text}</p>;
        case 'tool-call':
            return (
                <p
                    className="command-bar-ai-tool"
                    data-ok={entry.applied !== false}
                >
                    <code>{event.call.name}</code>
                    {entry.appliedSummary ? ` — ${entry.appliedSummary}` : ''}
                </p>
            );
        case 'result':
            return <p className="command-bar-ai-result">{event.summary}</p>;
        case 'error':
            return <p className="command-bar-ai-error">{event.message}</p>;
    }
}

/** The browser fallback: AI is disabled, with a clear pointer to the desktop app. */
function DesktopOnly({ onClose }: { onClose: () => void }) {
    return (
        <div className="command-bar-ai-desktop-only">
            <p className="command-bar-ai-desktop-title">AI requires the desktop app</p>
            <p className="command-bar-ai-desktop-body">
                The AI agent runs locally in the OpenJammer desktop app, which drives Pi
                with your own provider key. It isn’t available in the browser.
            </p>
            <button type="button" className="command-bar-ai-approve" onClick={onClose}>
                Got it
            </button>
        </div>
    );
}
