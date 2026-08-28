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
import { Button } from '@openjammer/oj-ui';
import { getAgentBackend } from '../../ai';
import { getExecutor } from '../../audio/executor';
import {
    BUILTIN_AI_SLASH_COMMANDS,
    filterSlashCommands,
    fromPiSlashCommand,
    type AiSlashCommand,
} from '../../ai/slashCommands';
import {
    listSlashCommands,
    prewarmAgent,
    restartAgent,
    runCommand,
    type PiCommandRuntime,
    type PiThinkingLevel,
} from '../../ai/piSessions';
import { useAgentSessionStore, type ConversationEntry } from '../../store/agentSessionStore';
import { catalogFingerprint, useModelCatalogStore } from '../../store/modelCatalogStore';
import { useGraphStore } from '../../store/graphStore';
import { useAuthStore } from '../../auth/authStore';
import { useSandboxStore } from '../../store/sandboxStore';
import { useAiLearningStore } from '../../store/aiLearningStore';
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

const THINKING_LEVELS: readonly PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];

function nextThinkingLevel(current: PiThinkingLevel): PiThinkingLevel {
    const index = THINKING_LEVELS.indexOf(current);
    return THINKING_LEVELS[(index + 1) % THINKING_LEVELS.length];
}

interface StarterChip {
    label: string;
    prompt: string;
}

/**
 * First-run starter chips, adapted to what's already on the canvas. Shown ONLY in
 * the empty/new-chat state and gone the instant the first turn lands — they teach
 * a newcomer what the copilot can do, then get out of the flow.
 */
function starterChips(nodeCount: number, hasOutput: boolean): StarterChip[] {
    if (nodeCount === 0) {
        return [
            { label: 'Build a synth I can play', prompt: 'Build a simple synth I can play with a keyboard, wired to the speakers.' },
            { label: 'Make a lo-fi loop', prompt: 'Build a simple lo-fi loop patch I can jam over.' },
            { label: 'What can you do?', prompt: 'What can you do in OpenJammer? Show me a few patches you could build.' },
        ];
    }
    if (!hasOutput) {
        return [
            { label: 'Connect to the speakers', prompt: 'Wire my current sound to the speakers so I can hear it.' },
            { label: 'Add an echo', prompt: 'Add an echo effect to my current sound.' },
            { label: "What's missing here?", prompt: "Look at my canvas and tell me what's missing to make sound." },
        ];
    }
    return [
        { label: 'Add reverb', prompt: 'Add a reverb after my current sound.' },
        { label: 'Make it lo-fi', prompt: 'Make my current patch sound lo-fi.' },
        { label: 'Debug a quiet node', prompt: 'One of my nodes seems silent — look at the logs and tell me why.' },
    ];
}

interface WelcomeCopy {
    greeting: string;
    body: string;
}

/**
 * Philia's state-aware first-run hello — the welcome re-voiced in the agent's
 * persona (warm, lowercase, the music comes first). It surfaces what Philia can do —
 * build, fix, debug — through the greeting itself, never a feature list, and only
 * shows in the empty/new-chat state. The Ctrl+Z safety line is appended in the JSX.
 */
function welcomeCopy(nodeCount: number, hasOutput: boolean): WelcomeCopy {
    if (nodeCount === 0) {
        return {
            greeting: "hi — i'm Philia, your bandmate in here.",
            body: "blank page, which is the fun part. tell me the sound you want and i'll build it straight onto the canvas — i can fix the wiring or debug a node from the logs too.",
        };
    }
    if (!hasOutput) {
        return {
            greeting: 'hey — Philia here.',
            body: "i can see what you've got, but nothing's reaching the speakers yet. i can finish the wiring, add a sound, or chase down why it's quiet.",
        };
    }
    return {
        greeting: 'hey — Philia here.',
        body: 'nice patch. i can add to it, swap a sound, rewire it, or debug it from the logs — say the word.',
    };
}

/** The catalog-cache key for the current provider config (see modelCatalogStore). */
function currentCatalogBuster(): string {
    const auth = useAuthStore.getState();
    return catalogFingerprint({
        providerKeys: auth.providerKeys,
        providerBaseUrls: auth.providerBaseUrls,
        providerCustomModels: auth.providerCustomModels,
        provider: auth.activeProvider,
    });
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
    const rewindTo = useAgentSessionStore((s) => s.rewindTo);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    // Whether the transcript is scrolled to (near) its bottom. We only auto-stick
    // to new turns while pinned there, so we never yank the view out from under a
    // player who scrolled up to read — report without stealing focus.
    const pinnedRef = useRef(true);
    const autoSentRef = useRef(false);
    const thinkingLevelRef = useRef<PiThinkingLevel>('medium');
    // The single reasoning control (footer pill). We pulse it in place on change
    // instead of pushing a transcript toast — report without stealing focus.
    const reasoningPillRef = useRef<HTMLButtonElement>(null);
    // Fire the Pi prewarm at most once per panel mount.
    const prewarmedRef = useRef(false);

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

    // Whether Philia remembers this player across sessions — read truthfully from the
    // host on mount (the toggle commands also set it optimistically). null in the
    // browser (no host), where the indicator simply doesn't render.
    const memoryOn = useAiLearningStore((s) => s.enabled);
    useEffect(() => {
        void useAiLearningStore.getState().refresh();
    }, []);

    // The composer draft + the resume sub-view.
    const [draft, setDraft] = useState(autoSendInitial ? '' : initialPrompt);
    const [view, setView] = useState<'chat' | 'resume' | 'models' | 'rewind'>('chat');
    const [modelQuery, setModelQuery] = useState('');
    const [thinkingLevel, setThinkingLevel] = useState<PiThinkingLevel>('medium');
    const [commandNotice, setCommandNotice] = useState<string | null>(null);
    // Seed the dynamic Pi commands from the persisted catalog so the slash menu is
    // complete on the FIRST '/'; the effect below revalidates once Pi is warm.
    const [dynamicCommands, setDynamicCommands] = useState<AiSlashCommand[]>(() =>
        useModelCatalogStore.getState().commandsFor(currentCatalogBuster()).map(fromPiSlashCommand),
    );
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

    // Canvas shape for the first-run chips — a stable string so it never churns
    // renders. Only read while the welcome state is visible (no messages yet).
    const canvasShape = useGraphStore((s) => {
        let count = 0;
        let hasOutput = false;
        for (const node of s.nodes.values()) {
            count += 1;
            if (node.type === 'speaker') hasOutput = true;
        }
        return `${count}:${hasOutput ? 1 : 0}`;
    });
    const starters = useMemo(() => {
        const [count, out] = canvasShape.split(':');
        return starterChips(Number(count), out === '1');
    }, [canvasShape]);
    const welcome = useMemo(() => {
        const [count, out] = canvasShape.split(':');
        return welcomeCopy(Number(count), out === '1');
    }, [canvasShape]);

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

    // Auto-stick to the bottom as turns stream in — but ONLY when already pinned
    // there. If the player has scrolled up to read an earlier turn, leave their
    // view exactly where they put it.
    useEffect(() => {
        const el = transcriptRef.current;
        if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
    }, [messages]);

    const onTranscriptScroll = useCallback(() => {
        const el = transcriptRef.current;
        if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    }, []);

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
            thinkingLevel: thinkingLevelRef.current,
            yolo: useSandboxStore.getState().mode === 'yolo',
        };
    }, []);

    // Pre-spawn the warm Pi child on intent (entering AI mode) so the first prompt
    // streams with no cold start. Gated on configured + capable, so the search-only
    // / pure-instrument majority never forks Pi; idempotent native-side, and we
    // guard to fire once per mount.
    useEffect(() => {
        if (prewarmedRef.current) return;
        if (!available || showAuth || !configured || view !== 'chat') return;
        prewarmedRef.current = true;
        void prewarmAgent(getPiRuntime());
    }, [available, showAuth, configured, view, getPiRuntime]);

    useEffect(() => {
        if (!slashActive || commandsLoaded) return;
        let live = true;
        void listSlashCommands(getPiRuntime()).then((commands) => {
            if (!live) return;
            setDynamicCommands(commands.map(fromPiSlashCommand));
            setCommandsLoadedFor(commandContext);
            // Write-through so the next session's first '/' is instant.
            useModelCatalogStore.getState().setCommands(currentCatalogBuster(), commands);
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

    // Command notices are transient acknowledgements (named a session, copied an
    // answer, …). Auto-dismiss so they never stick above the transcript across
    // turns — the focus-stealing staleness the reasoning toast used to cause.
    useEffect(() => {
        if (!commandNotice) return;
        const t = window.setTimeout(() => setCommandNotice(null), 8000);
        return () => window.clearTimeout(t);
    }, [commandNotice]);

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
                        // A reloaded Pi re-discovers its commands; drop the cache too.
                        useModelCatalogStore.getState().clearCommands();
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

    const cycleReasoning = useCallback(() => {
        const nextLevel = nextThinkingLevel(thinkingLevelRef.current);
        thinkingLevelRef.current = nextLevel;
        // This is the musician-facing path: update the visible state synchronously.
        // The next agent turn carries this level in its run payload and applies it
        // before the prompt, so Shift+Tab never waits for a Pi subprocess round-trip.
        // Both writes happen here so the displayed level and the sent level (read
        // from the ref in getPiRuntime) can never diverge.
        setThinkingLevel(nextLevel);
        // Pulse the one reasoning pill in place — restart the CSS animation by
        // clearing then re-setting the attribute after a forced reflow. No toast,
        // no autoscroll, calm during a live set (honors prefers-reduced-motion).
        const pill = reasoningPillRef.current;
        if (pill) {
            pill.removeAttribute('data-pulse');
            void pill.offsetWidth;
            pill.setAttribute('data-pulse', 'true');
        }
    }, []);

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
        // A new turn supersedes any lingering slash-command acknowledgement.
        setCommandNotice(null);
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

    const onAiKeyDownCapture = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            e.stopPropagation();
            toggleYolo();
            return;
        }
        onChatKeyDownCapture(e);
    }, [onChatKeyDownCapture, toggleYolo]);

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

    if (view === 'rewind') {
        return (
            <div className="command-bar-ai">
                <RewindPicker
                    messages={messages}
                    onCancel={() => setView('chat')}
                    onPick={(index) => {
                        void rewindTo(index).then((text) => {
                            setDraft(text);
                            setView('chat');
                            setCommandNotice(
                                'Rewound here — edit and send. Your canvas is unchanged; Ctrl+Z reverts what the agent built.',
                            );
                        });
                    }}
                />
            </div>
        );
    }

    return (
        <div className="command-bar-ai" onKeyDownCapture={onAiKeyDownCapture}>
            <div className="command-bar-ai-header">
                <Button
                    variant="ghost"
                    onClick={onBack}
                    aria-label="Back to search"
                >
                    ← Search
                </Button>
                <div className="command-bar-ai-header-right">
                    <span className="command-bar-ai-session" title={sessionId ?? 'New chat'}>
                        {sessionId ? shortId(sessionId) : 'New chat'}
                    </span>
                    {messages.some((m) => m.role === 'user') && (
                        <Button
                            variant="ghost"
                            onClick={() => setView('rewind')}
                            title={`Rewind & edit an earlier prompt (${MOD}+↑)`}
                        >
                            ↺ Rewind
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        onClick={() => void newSession()}
                        title="Start a new session ( /new )"
                    >
                        + New
                    </Button>
                </div>
            </div>

            <div className="command-bar-ai-transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
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
                        <p className="command-bar-ai-welcome-title">{welcome.greeting}</p>
                        <p className="command-bar-ai-welcome-body">
                            {welcome.body} everything i touch is one{' '}
                            <kbd className="command-bar-kbd">{MOD}+Z</kbd> away.
                        </p>
                        <div className="command-bar-ai-welcome-chips">
                            {starters.map((chip) => (
                                <Button
                                    key={chip.label}
                                    variant="secondary"
                                    className="command-bar-ai-welcome-chip"
                                    disabled={running}
                                    onClick={() => {
                                        setCommandNotice(null);
                                        if (runTask(chip.prompt)) setDraft('');
                                    }}
                                >
                                    {chip.label}
                                </Button>
                            ))}
                        </div>
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
                        if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp' && !slashActive) {
                            // Rewind & edit an earlier prompt (no-op with no history).
                            e.preventDefault();
                            if (messages.some((m) => m.role === 'user')) setView('rewind');
                            return;
                        }
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
                            {!commandsLoaded && dynamicCommands.length === 0 && (
                                <span>Pi commands load after the agent starts</span>
                            )}
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
                                <kbd className="command-bar-kbd">⇧↵</kbd> newline
                            </>
                        )}
                    </span>
                    <Button
                        variant="primary"
                        onClick={submit}
                        disabled={running || !draft.trim()}
                    >
                        Send
                    </Button>
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
                {memoryOn !== null && (
                    <span
                        className="command-bar-ai-memory"
                        data-on={memoryOn}
                        title={
                            memoryOn
                                ? 'Philia remembers you across sessions (toggle in ⌘K)'
                                : 'Philia forgets between sessions (toggle in ⌘K)'
                        }
                    >
                        memory: {memoryOn ? 'on' : 'off'}
                    </span>
                )}
                <button
                    type="button"
                    ref={reasoningPillRef}
                    className="command-bar-ai-thinking"
                    onClick={cycleReasoning}
                    title={`Reasoning · ⇧⇥ — tap to cycle`}
                    aria-live="polite"
                    aria-label={`Reasoning level: ${thinkingLevel}. Activate to cycle.`}
                >
                    Thinking: {thinkingLevel}
                </button>
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
 * Rewind & edit: pick an earlier prompt to continue from. Lists the prior USER
 * turns (newest first); choosing one truncates the conversation to before it and
 * lifts its text into the composer to edit. Conversation-only — the canvas never
 * moves; Ctrl+Z stays the way to revert what the agent built.
 */
function RewindPicker({
    messages,
    onPick,
    onCancel,
}: {
    messages: ConversationEntry[];
    onPick: (index: number) => void;
    onCancel: () => void;
}) {
    const turns = useMemo(() => {
        const out: { index: number; text: string }[] = [];
        messages.forEach((m, i) => {
            if (m.role === 'user') out.push({ index: i, text: m.text });
        });
        return out.reverse();
    }, [messages]);
    const [sel, setSel] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        listRef.current?.focus();
    }, []);

    return (
        <>
            <div className="command-bar-ai-header">
                <Button
                    variant="ghost"
                    onClick={onCancel}
                    aria-label="Back to chat"
                >
                    ← Chat
                </Button>
                <span className="command-bar-ai-badge">Rewind &amp; edit</span>
            </div>
            <div className="command-bar-models-help">
                <span>Pick a prompt to edit and continue from. Your canvas stays put — {MOD}+Z reverts what the agent built.</span>
                <span>↑↓ choose · Enter edit · Esc back</span>
            </div>
            {turns.length === 0 ? (
                <div className="command-bar-ai-welcome">
                    <p className="command-bar-ai-welcome-body">No earlier prompts to rewind to yet.</p>
                </div>
            ) : (
                <div
                    className="command-bar-rewind-list"
                    role="listbox"
                    tabIndex={0}
                    ref={listRef}
                    aria-label="Earlier prompts"
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSel((i) => Math.min(i + 1, turns.length - 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSel((i) => Math.max(0, i - 1));
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            onPick(turns[sel].index);
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancel();
                        }
                    }}
                >
                    {turns.map((turn, i) => (
                        <button
                            key={turn.index}
                            type="button"
                            className="command-bar-rewind-row"
                            data-selected={i === sel}
                            role="option"
                            aria-selected={i === sel}
                            onMouseEnter={() => setSel(i)}
                            onClick={() => onPick(turn.index)}
                        >
                            {turn.text}
                        </button>
                    ))}
                </div>
            )}
        </>
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
                <Button variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    ref={confirmRef}
                    variant="primary"
                    onClick={onConfirm}
                >
                    Enter YOLO
                </Button>
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
            <Button variant="primary" onClick={onBack}>
                Back to search
            </Button>
        </div>
    );
}
