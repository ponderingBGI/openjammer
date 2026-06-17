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
import { useSandboxStore } from '../../store/sandboxStore';
import { AuthChooser } from './AuthChooser';

/** macOS shows ⌘; everywhere else Ctrl. (Display only; handlers accept both.) */
const IS_MAC =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

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

    // Sandbox (Phase 6): the live jail/YOLO mode, shown in the footer and toggled
    // with an explicit confirm. `canYolo` is false on any platform that cannot
    // host-jail in the first place (browser), so the toggle simply never appears.
    const sandboxMode = useSandboxStore((s) => s.mode);
    const projectLabel = useSandboxStore((s) => s.projectLabel);
    const canYolo = useSandboxStore((s) => s.canYolo());
    // Local UI: the YOLO confirmation gate and the keyboard-help popover.
    const [yoloConfirm, setYoloConfirm] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);

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
            // Phase 6: carry the live sandbox mode so the host jails (default) or
            // drops every guard + forwards the full env (YOLO).
            yolo: useSandboxStore.getState().mode === 'yolo',
        });
    }, [available, configured, backend, start]);

    const running = phase === 'running';
    const awaitingApproval = phase === 'awaiting-approval';
    const errored = phase === 'error';

    // Entering YOLO is never one keystroke: going to YOLO opens the confirm;
    // leaving it (back to safe) is immediate and needs no gate.
    const toggleYolo = useCallback(() => {
        const sb = useSandboxStore.getState();
        if (sb.mode === 'yolo') sb.exitYolo();
        else if (sb.requestYolo()) setYoloConfirm(true);
    }, []);

    // Global hotkeys for the live agent surface (not the auth/desktop-only states):
    //   Approve  ⌘/Ctrl+Shift+Enter   — the load-bearing instant moment
    //   Reject   Esc (while awaiting)  — undoes the whole frame in one keystroke
    //   YOLO     ⌘/Ctrl+Shift+Y       — explicit-confirm toggle
    // Capture phase so Approve/Reject pre-empt the prompt input's own Esc=back.
    useEffect(() => {
        if (!available || showAuth) return;
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (awaitingApproval && mod && e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                approve();
                onClose();
                return;
            }
            if (awaitingApproval && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                reject();
                return;
            }
            if (mod && e.shiftKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                toggleYolo();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [available, showAuth, awaitingApproval, approve, reject, onClose, toggleYolo]);

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
                    <div className="command-bar-ai-header-right">
                        <button
                            type="button"
                            className="command-bar-ai-help-btn"
                            onClick={() => setHelpOpen((h) => !h)}
                            aria-label="Keyboard shortcuts"
                            aria-expanded={helpOpen}
                            title="Keyboard shortcuts"
                        >
                            ?
                        </button>
                        <span className="command-bar-ai-badge">AI</span>
                    </div>
                </div>
            )}

            {helpOpen && !showAuth && available && (
                <KeyboardHelp onClose={() => setHelpOpen(false)} canYolo={canYolo} />
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
                                title="Reject (Esc) — undo everything the agent did"
                            >
                                Reject <kbd className="command-bar-kbd">Esc</kbd>
                            </button>
                            <button
                                type="button"
                                className="command-bar-ai-approve"
                                onClick={() => {
                                    approve();
                                    onClose();
                                }}
                                title={`Approve (${MOD}+Shift+Enter) — keep the changes`}
                            >
                                Approve{' '}
                                <kbd className="command-bar-kbd command-bar-kbd-on-accent">
                                    {MOD}+⇧+⏎
                                </kbd>
                            </button>
                        </div>
                    )}

                    {/*
                     * The permission footer — always visible on the live agent
                     * surface so the sandbox boundary is never a surprise. Signal-
                     * Not-Brand: clay only reports the YOLO danger state, always
                     * carrying its label.
                     */}
                    <div className="command-bar-ai-footer" data-mode={sandboxMode}>
                        {sandboxMode === 'yolo' ? (
                            <span className="command-bar-ai-sandbox command-bar-ai-sandbox-yolo">
                                ⚠ YOLO Mode — all guards off
                            </span>
                        ) : (
                            <span className="command-bar-ai-sandbox">
                                Sandboxed&nbsp;↬&nbsp;
                                <code>{projectLabel ? `${projectLabel}/` : 'project/'}</code>
                            </span>
                        )}
                        {canYolo && (
                            <button
                                type="button"
                                className="command-bar-ai-yolo-toggle"
                                data-mode={sandboxMode}
                                onClick={toggleYolo}
                                title={`Toggle YOLO (${MOD}+Shift+Y)`}
                            >
                                {sandboxMode === 'yolo' ? 'Exit YOLO' : 'YOLO'}
                            </button>
                        )}
                    </div>

                    {yoloConfirm && (
                        <YoloConfirm
                            onCancel={() => setYoloConfirm(false)}
                            onConfirm={() => {
                                useSandboxStore.getState().confirmYolo();
                                setYoloConfirm(false);
                            }}
                        />
                    )}
                </>
            )}
        </div>
    );
}

/**
 * The YOLO confirmation gate. Entering YOLO is deliberately a two-step act: this
 * spells out exactly what is being given up (the full shell + real environment)
 * before any guard drops, and resets to safe on restart.
 */
function YoloConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    const confirmRef = useRef<HTMLButtonElement>(null);
    // Focus Cancel by default — entering YOLO should take a deliberate reach.
    useEffect(() => {
        confirmRef.current?.focus();
    }, []);
    return (
        <div className="command-bar-yolo-confirm" role="alertdialog" aria-label="Enter YOLO mode?">
            <p className="command-bar-yolo-title">Enter YOLO mode?</p>
            <p className="command-bar-yolo-body">
                The agent gets your <strong>full shell</strong> — any command, any directory,
                and your real environment (SSH&nbsp;keys, cloud tokens). The graph
                Approve&nbsp;/&nbsp;Reject gate stays on; everything else is off. Resets to
                safe on restart.
            </p>
            <div className="command-bar-yolo-actions">
                <button type="button" className="command-bar-ai-reject" onClick={onCancel}>
                    Cancel
                </button>
                <button
                    ref={confirmRef}
                    type="button"
                    className="command-bar-yolo-go"
                    onClick={onConfirm}
                >
                    Enter YOLO
                </button>
            </div>
        </div>
    );
}

/** A compact keyboard-shortcut reference, dismissed with Esc or its close button. */
function KeyboardHelp({ onClose, canYolo }: { onClose: () => void; canYolo: boolean }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const rows: [string, string][] = [
        ['Tab', 'Ask AI (from search)'],
        ['Enter', 'Send the prompt'],
        [`${MOD}+⇧+⏎`, 'Approve the changes'],
        ['Esc', 'Reject / back'],
        ...(canYolo ? ([[`${MOD}+⇧+Y`, 'Toggle YOLO mode']] as [string, string][]) : []),
    ];

    return (
        <div className="command-bar-help" role="dialog" aria-label="Keyboard shortcuts">
            <div className="command-bar-help-head">
                <span className="command-bar-help-title">Shortcuts</span>
                <button
                    type="button"
                    className="command-bar-ai-back"
                    onClick={onClose}
                    aria-label="Close shortcuts"
                >
                    ✕
                </button>
            </div>
            <dl className="command-bar-help-list">
                {rows.map(([keys, label]) => (
                    <div key={keys} className="command-bar-help-row">
                        <dt>
                            <kbd className="command-bar-kbd">{keys}</kbd>
                        </dt>
                        <dd>{label}</dd>
                    </div>
                ))}
            </dl>
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
