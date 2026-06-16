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

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentBackend } from '../../ai';
import { getExecutor } from '../../audio/executor';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import type { TranscriptEntry } from '../../store/agentSessionStore';
import { useAuthStore } from '../../auth/authStore';
import { AuthChooser } from './AuthChooser';

interface AiPanelProps {
    /** Prompt carried over from the search input on the Tab handoff. */
    initialPrompt: string;
    /**
     * D6 (M7): force the AuthChooser even when a provider is already configured
     * (the "Configure AI provider" action), so the user can re-pick a provider.
     */
    forceAuth?: boolean;
    /** Return to search mode (Esc / "Back"). */
    onBack: () => void;
    /** Close the whole palette. */
    onClose: () => void;
}

export function AiPanel({ initialPrompt, forceAuth = false, onBack, onClose }: AiPanelProps) {
    const phase = useAgentSessionStore((s) => s.phase);
    const transcript = useAgentSessionStore((s) => s.transcript);
    const error = useAgentSessionStore((s) => s.error);
    const start = useAgentSessionStore((s) => s.start);
    const approve = useAgentSessionStore((s) => s.approve);
    const reject = useAgentSessionStore((s) => s.reject);

    const inputRef = useRef<HTMLInputElement>(null);
    const promptRef = useRef(initialPrompt);

    const backend = getAgentBackend();
    // Gate on the platform capability seam (M0), not the backend's own probe:
    // 'none' (browser) shows the desktop-only state; otherwise the agent is offered.
    const available = getExecutor().getCapabilities().agent !== 'none';

    // D6 (M7): WHO PAYS must be configured before the agent input is usable. The
    // full gate is `available && configured`; an unconfigured first Tab routes to
    // the AuthChooser instead of the prompt.
    const configured = useAuthStore((s) => s.configured);
    const refreshStatus = useAuthStore((s) => s.refreshStatus);

    // Show the chooser when nothing is configured OR when explicitly asked to
    // re-configure (forceAuth). Local override clears once the chooser finishes.
    const [authDismissed, setAuthDismissed] = useState(false);
    const showAuth = available && (forceAuth ? !authDismissed : !configured);

    // Re-derive auth status from native on mount (the key lives in the keychain,
    // not this store, so a prior session's key makes us `configured` again).
    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    // Focus the AI input on mount; preserve the handed-over text as the value.
    useEffect(() => {
        if (inputRef.current) inputRef.current.value = promptRef.current;
        inputRef.current?.focus();
    }, []);

    const runPrompt = useCallback(() => {
        const prompt = (inputRef.current?.value ?? '').trim();
        if (!prompt || !available || !configured) return;
        // Forward WHO PAYS to the run: the in-memory key + active provider (+ an
        // optional model) flow to ai_run, which injects the key under the
        // provider's env var (e.g. opencode → OPENCODE_API_KEY) for Pi.
        const auth = useAuthStore.getState();
        void start(backend, {
            prompt,
            providerKey: auth.key,
            provider: auth.activeProvider,
            modelId: auth.modelId,
        });
    }, [available, configured, backend, start]);

    const running = phase === 'running';
    const awaitingApproval = phase === 'awaiting-approval';
    const errored = phase === 'error';

    return (
        <div className="command-bar-ai" data-available={available}>
            {/*
             * The AuthChooser renders its OWN header ("← Search / Configure AI
             * provider"); only show this one OUTSIDE the chooser so we don't stack
             * two search bars (the reported double-header bug).
             */}
            {!showAuth && (
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
            )}

            {!available ? (
                <DesktopOnly onClose={onClose} />
            ) : showAuth ? (
                // D6: WHO PAYS not yet set (or re-configuring) — route to onboarding.
                <AuthChooser
                    onConfigured={() => {
                        setAuthDismissed(true);
                        void refreshStatus();
                    }}
                    onBack={() => {
                        // Forced re-configure: dismissing returns to the agent input;
                        // a first-Tab unconfigured back returns to search.
                        if (forceAuth) setAuthDismissed(true);
                        else onBack();
                    }}
                />
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
            // A batch_apply renders as ONE grouped line summarizing N sub-calls,
            // with a tasteful per-sub-call list underneath (M3).
            if (entry.children) {
                return (
                    <div className="command-bar-ai-tool-group" data-ok={entry.applied !== false}>
                        <p className="command-bar-ai-tool" data-ok={entry.applied !== false}>
                            <code>{event.call.name}</code>
                            {` — ${entry.children.length} step(s)`}
                            {entry.appliedSummary ? `: ${entry.appliedSummary}` : ''}
                        </p>
                        <ul className="command-bar-ai-tool-children">
                            {entry.children.map((child, i) => (
                                <li
                                    key={i}
                                    className="command-bar-ai-tool-child"
                                    data-ok={child.ok}
                                >
                                    ↳ <code>{child.name}</code> — {child.summary}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            }
            return (
                <p
                    className="command-bar-ai-tool"
                    data-ok={entry.applied !== false}
                >
                    <code>{event.call.name}</code>
                    {entry.appliedSummary ? ` — ${entry.appliedSummary}` : ''}
                </p>
            );
        case 'tool-result':
            // A subtle "↳ result" line so a read's relayed data is visible (M3).
            return (
                <p className="command-bar-ai-tool-result">
                    ↳ result <code>{event.toolCallId}</code>
                </p>
            );
        case 'result':
            return <p className="command-bar-ai-result">{event.summary}</p>;
        case 'error':
            return <p className="command-bar-ai-error">{event.message}</p>;
        case 'ui-request':
            return (
                <p className="command-bar-ai-thought">
                    Pi requested input ({event.request.method}) — auto-dismissed.
                </p>
            );
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
