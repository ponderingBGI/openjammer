/**
 * AiPanel — the AI half of the Ctrl/Cmd+K command bar, redesigned as a chat.
 *
 * Tab from search hands its typed text here as the first draft. This panel is a
 * real conversation: a scrolling transcript of user + assistant turns (markdown,
 * with quiet action chips for any graph edits), a bottom composer, and slash
 * commands for sessions. It is the view layer over {@link useAgentSessionStore},
 * which owns the persistent, session-aware conversation.
 *
 * NO Approve/Reject. The agent's edits apply live and are undone with plain
 * Ctrl+Z (a held, believable result over a modal). Sessions:
 *   - `/new`     starts a fresh Pi session,
 *   - `/resume`  opens the session picker to continue a past one,
 * and the panel auto-reattaches to the last session via the store.
 *
 * On a plain browser AI is disabled (DesktopOnly). Before the first run the user
 * picks WHO PAYS in the AuthChooser. The sandbox/YOLO footer (fs/shell safety) is
 * unchanged — it's orthogonal to the graph editing model.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getAgentBackend } from '../../ai';
import { getExecutor } from '../../audio/executor';
import {
    BUILTIN_AI_SLASH_COMMANDS,
    filterSlashCommands,
    fromPiSlashCommand,
    type AiSlashCommand,
} from '../../ai/slashCommands';
import {
    cycleThinkingLevel,
    listSlashCommands,
    restartAgent,
    runCommand,
    type PiCommandRuntime,
} from '../../ai/piSessions';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import { useAuthStore } from '../../auth/authStore';
import { useSandboxStore } from '../../store/sandboxStore';
import { AuthChooser } from './AuthChooser';
import { ChatMessage } from './ChatMessage';
import { SessionPicker } from './SessionPicker';
import { ModelPicker } from './ModelPicker';

/** macOS shows ⌘; everywhere else Ctrl. (Display only; handlers accept both.) */
const IS_MAC =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

interface AiPanelProps {
    /** Draft carried over from the search input on the Tab handoff. */
    initialPrompt: string;
    /** Send the initial prompt automatically once auth/platform gates are ready. */
    autoSendInitial?: boolean;
    /**
     * Force the AuthChooser even when a provider is already configured (the
     * "Configure AI provider" action), so the user can re-pick a provider.
     */
    forceAuth?: boolean;
    /** Return to search mode (Esc / "Back"). */
    onBack: () => void;
    /** Close the command bar entirely (used by slash commands that open app UI). */
    onClose?: () => void;
}

/** A short, friendly stem of a session id for the header chip. */
function shortId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function slashParts(text: string): { query: string; args: string } {
    const body = text.startsWith('/') ? text.slice(1) : text;
    const match = body.match(/^(\S*)(?:\s+([\s\S]*))?$/);
    return {
        query: match?.[1] ?? '',
        args: match?.[2] ?? '',
    };
}

function sourceLabel(source: AiSlashCommand['source']): string {
    if (source === 'pi') return 'Pi';
    if (source === 'openjammer') return 'OpenJammer';
    if (source === 'extension') return 'Extension';
    if (source === 'prompt') return 'Prompt';
    return 'Skill';
}

function formatSessionState(data: unknown): string {
    const state = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const sessionId = typeof state.sessionId === 'string' ? state.sessionId : 'unknown';
    const sessionName = typeof state.sessionName === 'string' ? state.sessionName : 'untitled';
    const messageCount = typeof state.messageCount === 'number' ? state.messageCount : 0;
    const model = state.model && typeof state.model === 'object' ? state.model as Record<string, unknown> : null;
    const modelName = model
        ? [model.provider, model.id ?? model.modelId].filter((x) => typeof x === 'string').join('/')
        : 'default';
    return `Session ${shortId(sessionId)} · ${sessionName} · ${messageCount} messages · ${modelName}`;
}

function lastAssistantText(messages: ReturnType<typeof useAgentSessionStore.getState>['messages']): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const entry = messages[i];
        if (entry?.role === 'assistant' && entry.markdown.trim()) return entry.markdown.trim();
    }
    return null;
}

export function AiPanel({
    initialPrompt,
    autoSendInitial = false,
    forceAuth = false,
    onBack,
    onClose,
}: AiPanelProps) {
    const phase = useAgentSessionStore((s) => s.phase);
    const messages = useAgentSessionStore((s) => s.messages);
    const error = useAgentSessionStore((s) => s.error);
    const runtimeStatus = useAgentSessionStore((s) => s.runtimeStatus);
    const sessionId = useAgentSessionStore((s) => s.sessionId);
    const send = useAgentSessionStore((s) => s.send);
    const newSession = useAgentSessionStore((s) => s.newSession);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const autoSentRef = useRef(false);

    const backend = useMemo(() => getAgentBackend(), []);
    // Gate on the platform capability seam (M0): 'none' (browser) shows the
    // desktop-only state; otherwise the agent is offered.
    const available = getExecutor().getCapabilities().agent !== 'none';

    // WHO PAYS must be configured before the composer is usable.
    const configured = useAuthStore((s) => s.configured);
    const refreshStatus = useAuthStore((s) => s.refreshStatus);
    const [authDismissed, setAuthDismissed] = useState(false);
    const [localForceAuth, setLocalForceAuth] = useState(false);
    const showAuth = available && ((forceAuth || localForceAuth) ? !authDismissed : !configured);

    // Sandbox (live jail/YOLO mode), shown in the footer and toggled with an
    // explicit confirm. `canYolo` is false where host-jailing can't happen.
    const sandboxMode = useSandboxStore((s) => s.mode);
    const projectLabel = useSandboxStore((s) => s.projectLabel);
    const canYolo = useSandboxStore((s) => s.canYolo());
    const [yoloConfirm, setYoloConfirm] = useState(false);

    // The composer draft + the resume sub-view.
    const [draft, setDraft] = useState(autoSendInitial ? '' : initialPrompt);
    const [view, setView] = useState<'chat' | 'resume' | 'models'>('chat');
    const [modelQuery, setModelQuery] = useState('');
    const [thinkingLevel, setThinkingLevel] = useState('auto');
    const [thinkingBusy, setThinkingBusy] = useState(false);
    const [commandNotice, setCommandNotice] = useState<string | null>(null);
    const [dynamicCommands, setDynamicCommands] = useState<AiSlashCommand[]>([]);
    const [commandsLoadedFor, setCommandsLoadedFor] = useState<string | null>(null);
    const [slashDismissed, setSlashDismissed] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);

    const running = phase === 'running';
    const errored = phase === 'error';
    const commandContext = `${sessionId ?? 'new'}:${phase}`;
    const commandsLoaded = commandsLoadedFor === commandContext;
    const slashActive = draft.startsWith('/') && view === 'chat' && !slashDismissed;
    const { query: slashQuery, args: slashArgs } = slashParts(draft);
    const slashCommands = useMemo(() => {
        const byName = new Map<string, AiSlashCommand>();
        for (const command of [...BUILTIN_AI_SLASH_COMMANDS, ...dynamicCommands]) {
            if (!byName.has(command.name)) byName.set(command.name, command);
        }
        return filterSlashCommands(Array.from(byName.values()), slashQuery);
    }, [dynamicCommands, slashQuery]);
    const selectedSlashCommand = slashCommands[Math.min(slashIndex, Math.max(0, slashCommands.length - 1))];

    // Re-derive auth status from native on mount (the key lives in the keychain).
    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    // Focus the composer when the chat is shown.
    useEffect(() => {
        if (available && !showAuth && view === 'chat') {
            const el = inputRef.current;
            if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
            }
        }
    }, [available, showAuth, view]);

    // Auto-stick to the bottom as turns stream in.
    useEffect(() => {
        const el = transcriptRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    const updateDraft = useCallback((value: string) => {
        setDraft(value);
        setSlashIndex(0);
        if (!value.startsWith('/')) setSlashDismissed(false);
    }, []);

    const getPiRuntime = useCallback((): PiCommandRuntime => {
        const auth = useAuthStore.getState();
        const activeProvider = auth.activeProvider;
        return {
            providerKey: activeProvider ? auth.providerKeys[activeProvider] ?? auth.key : auth.key,
            providerKeys: auth.providerKeys,
            providerBaseUrls: auth.providerBaseUrls,
            providerCustomModels: auth.providerCustomModels,
            provider: activeProvider,
            modelId: auth.modelId,
            yolo: useSandboxStore.getState().mode === 'yolo',
        };
    }, []);

    useEffect(() => {
        if (!slashActive || commandsLoaded) return;
        let live = true;
        void listSlashCommands(getPiRuntime()).then((commands) => {
            if (!live) return;
            setDynamicCommands(commands.map(fromPiSlashCommand));
            setCommandsLoadedFor(commandContext);
        });
        return () => {
            live = false;
        };
    }, [slashActive, commandsLoaded, commandContext, getPiRuntime]);

    const runTask = useCallback(
        (prompt: string) => {
            if (!prompt || !available || !configured || running) return false;
            void send(backend, {
                prompt,
                ...getPiRuntime(),
            });
            return true;
        },
        [available, configured, running, backend, send, getPiRuntime],
    );

    const executeSlashCommand = useCallback(
        async (command: AiSlashCommand, args: string) => {
            const trimmedArgs = args.trim();
            setCommandNotice(null);
            setSlashDismissed(false);

            if (!command.local) {
                const prompt = `/${command.name}${trimmedArgs ? ` ${trimmedArgs}` : ''}`;
                if (runTask(prompt)) setDraft('');
                return;
            }

            switch (command.name) {
                case 'new': {
                    setDraft('');
                    await newSession();
                    setCommandNotice('Started a fresh Pi session.');
                    return;
                }
                case 'resume':
                    setDraft('');
                    setView('resume');
                    return;
                case 'name': {
                    if (!trimmedArgs) {
                        setCommandNotice('Type a name after /name, for example: /name stage patch');
                        return;
                    }
                    setDraft('');
                    const res = await runCommand({ type: 'set_session_name', name: trimmedArgs }, getPiRuntime());
                    setCommandNotice(res.ok ? `Session named “${trimmedArgs}”.` : 'Pi is not ready to name the session yet. Ask it something first.');
                    return;
                }
                case 'session': {
                    setDraft('');
                    const res = await runCommand({ type: 'get_state' }, getPiRuntime());
                    setCommandNotice(res.ok ? formatSessionState(res.data) : 'Pi is not running yet — ask it something first.');
                    return;
                }
                case 'compact': {
                    setDraft('');
                    const res = await runCommand({
                        type: 'compact',
                        ...(trimmedArgs ? { customInstructions: trimmedArgs } : {}),
                    }, getPiRuntime());
                    const summary = res.data && typeof res.data === 'object'
                        ? (res.data as { summary?: unknown }).summary
                        : null;
                    setCommandNotice(res.ok
                        ? `Compacted context.${typeof summary === 'string' && summary ? ` ${summary}` : ''}`
                        : 'Could not compact yet — Pi may not be running.');
                    return;
                }
                case 'copy': {
                    const text = lastAssistantText(useAgentSessionStore.getState().messages);
                    if (!text) {
                        setCommandNotice('No assistant answer to copy yet.');
                        return;
                    }
                    setDraft('');
                    await navigator.clipboard?.writeText(text);
                    setCommandNotice('Copied the last assistant answer.');
                    return;
                }
                case 'login':
                case 'provider':
                    setDraft('');
                    setAuthDismissed(false);
                    setLocalForceAuth(true);
                    return;
                case 'model':
                case 'models':
                    setDraft('');
                    setModelQuery(trimmedArgs);
                    setView('models');
                    return;
                case 'logout':
                    setDraft('');
                    await useAuthStore.getState().clear();
                    setCommandNotice('Cleared the current in-app AI provider key.');
                    return;
                case 'settings':
                    setDraft('');
                    window.dispatchEvent(new CustomEvent('openjammer:toggle-settings'));
                    onClose?.();
                    return;
                case 'hotkeys':
                    setDraft('');
                    window.dispatchEvent(new CustomEvent('openjammer:toggle-help'));
                    onClose?.();
                    return;
                case 'logs':
                    setDraft('');
                    window.dispatchEvent(new CustomEvent('openjammer:toggle-devlog'));
                    onClose?.();
                    return;
                case 'diagnostics':
                    setDraft('');
                    window.dispatchEvent(new CustomEvent('openjammer:toggle-audio-health'));
                    onClose?.();
                    return;
                case 'reload': {
                    setDraft('');
                    const ok = await restartAgent();
                    if (ok) {
                        setDynamicCommands([]);
                        setCommandsLoadedFor(null);
                    }
                    setCommandNotice(ok ? 'Pi will reload on the next prompt.' : 'Could not restart Pi from here.');
                    return;
                }
                case 'yolo': {
                    setDraft('');
                    if (useSandboxStore.getState().mode === 'yolo') {
                        setCommandNotice('YOLO mode is already active.');
                    } else if (useSandboxStore.getState().requestYolo()) {
                        setYoloConfirm(true);
                    } else {
                        setCommandNotice('YOLO is unavailable on this platform.');
                    }
                    return;
                }
                case 'safe':
                    setDraft('');
                    useSandboxStore.getState().exitYolo();
                    setCommandNotice('Returned to the default sandboxed Pi mode.');
                    return;
                default:
                    setCommandNotice(`/${command.name} is not wired in OpenJammer yet.`);
            }
        },
        [getPiRuntime, newSession, onClose, runTask],
    );

    const cycleReasoning = useCallback(async () => {
        if (thinkingBusy) return;
        setThinkingBusy(true);
        setThinkingLevel('changing…');
        setCommandNotice('Changing reasoning level…');
        const res = await cycleThinkingLevel(getPiRuntime());
        setThinkingBusy(false);
        if (!res.ok) {
            setThinkingLevel('unavailable');
            setCommandNotice('Pi could not change reasoning yet. Try again after selecting a model.');
            return;
        }
        const level = res.data && typeof res.data === 'object'
            ? (res.data as { level?: unknown }).level
            : null;
        if (typeof level === 'string') {
            setThinkingLevel(level);
            setCommandNotice(`Thinking level: ${level}`);
        } else {
            setThinkingLevel('unsupported');
            setCommandNotice('Current model does not support reasoning.');
        }
    }, [getPiRuntime, thinkingBusy]);

    const onChatKeyDownCapture = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab' || !e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        void cycleReasoning();
    }, [cycleReasoning]);

    // Submit the composer: slash commands first, else send.
    const submit = useCallback(() => {
        const text = draft.trim();
        if (!text) return;
        if (text.startsWith('/')) {
            const command = selectedSlashCommand;
            if (!command) {
                setCommandNotice(`No slash command matches “/${slashQuery}”.`);
                return;
            }
            void executeSlashCommand(command, slashArgs);
            return;
        }
        if (runTask(text)) setDraft('');
    }, [draft, executeSlashCommand, runTask, selectedSlashCommand, slashArgs, slashQuery]);

    // Tab from search is a one-keystroke send. If auth is still in front, this
    // waits until the chooser is done, then sends exactly once.
    useEffect(() => {
        const text = initialPrompt.trim();
        if (!autoSendInitial || autoSentRef.current || !text || showAuth || view !== 'chat') return;
        if (runTask(text)) autoSentRef.current = true;
    }, [autoSendInitial, initialPrompt, runTask, showAuth, view]);

    // Entering YOLO is never one keystroke: going to YOLO opens the confirm;
    // leaving it (back to safe) is immediate.
    const toggleYolo = useCallback(() => {
        const sb = useSandboxStore.getState();
        if (sb.mode === 'yolo') sb.exitYolo();
        else if (sb.requestYolo()) setYoloConfirm(true);
    }, []);

    // YOLO toggle hotkey (⌘/Ctrl+Shift+Y) on the live agent surface.
    useEffect(() => {
        if (!available || showAuth) return;
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.shiftKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                toggleYolo();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [available, showAuth, toggleYolo]);

    if (!available) {
        return (
            <div className="command-bar-ai" data-available="false">
                <DesktopOnly onBack={onBack} />
            </div>
        );
    }

    if (showAuth) {
        return (
            <div className="command-bar-ai">
                <AuthChooser
                    onConfigured={() => {
                        setAuthDismissed(true);
                        setLocalForceAuth(false);
                        void refreshStatus();
                    }}
                    onBack={() => {
                        if (forceAuth || localForceAuth) {
                            setAuthDismissed(true);
                            setLocalForceAuth(false);
                        } else onBack();
                    }}
                />
            </div>
        );
    }

    if (view === 'resume') {
        return (
            <div className="command-bar-ai">
                <SessionPicker onResumed={() => setView('chat')} onCancel={() => setView('chat')} />
            </div>
        );
    }

    if (view === 'models') {
        return (
            <div className="command-bar-ai">
                <ModelPicker
                    runtime={getPiRuntime}
                    initialQuery={modelQuery}
                    onSelected={(message) => {
                        setCommandNotice(message);
                        setView('chat');
                    }}
                    onCancel={() => setView('chat')}
                />
            </div>
        );
    }

    return (
        <div className="command-bar-ai" onKeyDownCapture={onChatKeyDownCapture}>
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
                    <span className="command-bar-ai-session" title={sessionId ?? 'New chat'}>
                        {sessionId ? shortId(sessionId) : 'New chat'}
                    </span>
                    <button
                        type="button"
                        className="command-bar-ai-new"
                        onClick={() => void newSession()}
                        title="Start a new session ( /new )"
                    >
                        + New
                    </button>
                </div>
            </div>

            <div className="command-bar-ai-transcript" ref={transcriptRef}>
                {runtimeStatus && (
                    <div className="command-bar-ai-runtime" role="status">
                        {runtimeStatus}
                    </div>
                )}
                {commandNotice && (
                    <div className="command-bar-ai-notice" role="status">
                        {commandNotice}
                    </div>
                )}
                {messages.length === 0 && (
                    <div className="command-bar-ai-welcome">
                        <p className="command-bar-ai-welcome-title">Ask, or describe what to build.</p>
                        <p className="command-bar-ai-welcome-body">
                            Questions get answered; build requests land on the canvas live —
                            undo anything with <kbd className="command-bar-kbd">{MOD}+Z</kbd>.
                            Type <code>/new</code> to start over, <code>/resume</code> to revisit a session.
                        </p>
                    </div>
                )}
                {messages.map((entry) => (
                    <ChatMessage key={entry.id} entry={entry} />
                ))}
                {errored && error && <p className="command-bar-ai-error">{error}</p>}
            </div>

            <div className="command-bar-ai-composer">
                <textarea
                    ref={inputRef}
                    className="command-bar-ai-input"
                    placeholder="Ask anything, or describe what to build…"
                    value={draft}
                    rows={1}
                    onChange={(e) => updateDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (slashActive && e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSlashIndex((i) => Math.min(i + 1, Math.max(0, slashCommands.length - 1)));
                            return;
                        }
                        if (slashActive && e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSlashIndex((i) => Math.max(0, i - 1));
                            return;
                        }
                        if (e.key === 'Tab' && e.shiftKey && !slashActive) {
                            e.preventDefault();
                            void cycleReasoning();
                            return;
                        }
                        if (slashActive && e.key === 'Tab' && !e.shiftKey && selectedSlashCommand) {
                            e.preventDefault();
                            updateDraft(`/${selectedSlashCommand.name}${selectedSlashCommand.argsHint ? ' ' : ''}`);
                            setSlashDismissed(!!selectedSlashCommand.argsHint);
                            return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            if (slashActive) setSlashDismissed(true);
                            else onBack();
                        }
                    }}
                    aria-expanded={slashActive}
                    aria-controls={slashActive ? 'command-bar-ai-slash-menu' : undefined}
                />
                {slashActive && (
                    <div className="command-bar-ai-slash" id="command-bar-ai-slash-menu" role="listbox">
                        <div className="command-bar-ai-slash-head">
                            <span>Slash commands</span>
                            {!commandsLoaded && <span>Pi commands load after the agent starts</span>}
                        </div>
                        {slashCommands.length === 0 ? (
                            <div className="command-bar-ai-slash-empty">No command matches /{slashQuery}</div>
                        ) : (
                            slashCommands.map((command, index) => (
                                <button
                                    type="button"
                                    key={`${command.source}:${command.name}`}
                                    className="command-bar-ai-slash-item"
                                    data-selected={index === slashIndex}
                                    role="option"
                                    aria-selected={index === slashIndex}
                                    onMouseEnter={() => setSlashIndex(index)}
                                    onClick={() => void executeSlashCommand(command, slashArgs)}
                                >
                                    <span className="command-bar-ai-slash-main">
                                        <code>/{command.name}</code>
                                        {command.argsHint && <span>{command.argsHint}</span>}
                                    </span>
                                    <span className="command-bar-ai-slash-desc">{command.description}</span>
                                    <span className="command-bar-ai-slash-source">{sourceLabel(command.source)}</span>
                                </button>
                            ))
                        )}
                    </div>
                )}
                <div className="command-bar-ai-composer-row">
                    <span className="command-bar-ai-hint">
                        {running ? 'Working…' : (
                            <>
                                <kbd className="command-bar-kbd">↵</kbd> send ·{' '}
                                <kbd className="command-bar-kbd">⇧↵</kbd> newline ·{' '}
                                <kbd className="command-bar-kbd">⇧⇥</kbd> reasoning ·{' '}
                                <span className="command-bar-ai-thinking">Thinking: {thinkingLevel}</span>
                            </>
                        )}
                    </span>
                    <button
                        type="button"
                        className="command-bar-ai-send"
                        onClick={submit}
                        disabled={running || !draft.trim()}
                    >
                        Send
                    </button>
                </div>
            </div>

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
                <span className="command-bar-ai-thinking" aria-live="polite">
                    Thinking: {thinkingLevel}
                </span>
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
    useEffect(() => {
        confirmRef.current?.focus();
    }, []);
    return (
        <div className="command-bar-yolo-confirm" role="alertdialog" aria-label="Enter YOLO mode?">
            <p className="command-bar-yolo-title">Enter YOLO mode?</p>
            <p className="command-bar-yolo-body">
                The agent gets your <strong>full shell</strong> — any command, any directory,
                and your real environment (SSH&nbsp;keys, cloud tokens). Graph edits stay
                undoable with {MOD}+Z; everything else is off. Resets to safe on restart.
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

/** The browser fallback: AI is disabled, with a clear pointer to the desktop app. */
function DesktopOnly({ onBack }: { onBack: () => void }) {
    return (
        <div className="command-bar-ai-desktop-only">
            <p className="command-bar-ai-desktop-title">AI requires the desktop app</p>
            <p className="command-bar-ai-desktop-body">
                The AI agent runs locally in the OpenJammer desktop app, which drives Pi
                with your own provider key. It isn’t available in the browser.
            </p>
            <button type="button" className="command-bar-ai-send" onClick={onBack}>
                Back to search
            </button>
        </div>
    );
}
