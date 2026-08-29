/**
 * CommandBar (U19 + U20 + M2 → W4-P5) — the Ctrl/Cmd+K command palette.
 *
 * Lazy-loaded by CommandBarHost on first palette intent. Owns its own open/close
 * state once mounted. Built from cmdk's primitives (`Command`, `Command.Input`,
 * `Command.List`, ...) rendered INSIDE this repo's existing overlay/portal
 * pattern (see SettingsPanel) — deliberately NOT `Command.Dialog`, to avoid
 * pulling in the Radix Dialog subtree.
 *
 * TWO MODES:
 * - 'search' (U19): the action registry, ranked HERE (M2), not by cmdk.
 * - 'ai' (U20): press Tab from search to hand the typed text to the AI agent.
 *   The agent half renders in {@link AiPanel}: a streaming transcript whose
 *   OpenJammer edits apply live as undoable graph actions, or the honest
 *   "AI runs in the desktop app" state in a plain browser.
 *
 * M2 — the palette OWNS its ordering:
 * - `shouldFilter={false}`: cmdk no longer filters/ranks; this file does.
 * - {@link buildPaletteCtx} gives the capability seam + selection context; we
 *   {@link queryActions} the registry for the 'palette' surface, then SCORE each
 *   row by `paletteScore(query, …)` combined with the local frecency floor
 *   ({@link usePaletteLearningStore}). The list is sorted desc and capped. An
 *   empty query orders by learned frecency ("top picks on open").
 * - On pick we `recordPick(...)` BEFORE running the action (so the learning
 *   reflects the choice even if `run` navigates away), then close.
 *
 * W4-P5 — the palette is a signature surface, so it is built to the New DNA
 * menu physics and the audit's ranking contract:
 * - `.nj-menu` shell + `.nj-input` search field + ListRow result physics, with
 *   `Kbd` keycaps for real shortcuts and a mono `Chip` for node-type rows.
 * - UI-028: an EXACT title match always ranks first (a hard boost above every
 *   learned signal), and a DISABLED row is never the default selection — the
 *   highlight seeks the first ENABLED row.
 * - The "Ask AI" affordance is no longer a pseudo-RESULT that could rank into
 *   (or steal) the selection. It lives in the footer as the Tab hint it always
 *   was, and the empty state teaches it — but only when the agent is actually
 *   available on this platform. Enter on an empty result set still hands the
 *   query to the agent, so the one-key path survives without a fake row.
 */

import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Chip, Kbd } from '@openjammer/oj-ui';
import { useModalKeymap } from '../../keymap/useKeymap';
import {
    queryActions,
    subscribe,
    type Action,
    type ActionCtx,
} from '../../store/commandRegistry';
import { buildPaletteCtx } from '../../store/actionContext';
import { usePaletteLearningStore } from '../../store/paletteLearningStore';
import { score as paletteScore } from '../../store/paletteScore';
import { exactnessBoost } from './ranking';
import { keyComboToString, useKeybindingsStore } from '../../store/keybindingsStore';
// The AI half (AiPanel + the Pi agent backend + the markdown renderer it pulls
// in) is the single heaviest non-first-paint subtree. It only renders in 'ai'
// mode, so it is code-split behind a real dynamic import: the command palette
// (and its global Ctrl+K hotkey, owned by THIS eagerly-loaded component) is
// untouched, and the AI chunk loads the first time a performer presses Tab /
// asks the agent. Splitting here — a true async boundary Rollup orders for us —
// avoids the production-only circular-init crash that manual vendor chunking of
// app modules caused (see vite.config.ts), and keeps the entry chunk lean.
const AiPanel = lazy(() =>
    import('./AiPanel').then((m) => ({ default: m.AiPanel })),
);
import { useCommandBarStore } from '../../store/commandBarStore';
import './CommandBar.css';

export type CommandBarOpenIntent =
    | { kind: 'toggle'; prompt?: string; seq: number }
    | { kind: 'configure-ai'; prompt?: string; seq: number }
    | { kind: 'ask-ai'; prompt: string; seq: number };

/** Max rows rendered after ranking (keeps the list snappy). */
const MAX_ROWS = 50;

/** Kept identical to oj-ui Modal so overlays share one focus-containment contract. */
const FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Stable id for the injected "Reset Ranking" row (ranked like any other). */
const RESET_ITEM_ID = '__reset_ranking__';

/**
 * Palette action id → the keybinding action whose combo it actually runs. Only
 * REAL bindings get a keycap: advertising a shortcut that does nothing is the
 * kind of small lie the palette can't afford.
 */
const SHORTCUT_FOR: Record<string, string> = {
    'app.devlog.toggle': 'panel.devLog',
    'app.audio-health.toggle': 'panel.audioHealth',
    'app.plugins.toggle': 'panel.plugins',
    'arrangement.export-song': 'file.export',
};

/** A scored, ready-to-render registry row. */
interface RankedItem {
    action: Action;
    /** The frecency key (defaults to id on normalisation, but guard anyway). */
    key: string;
}

/** Group the ranked list into stable, label-keyed buckets, preserving order. */
function groupRanked(items: readonly RankedItem[]): [string, RankedItem[]][] {
    const groups = new Map<string, RankedItem[]>();
    for (const item of items) {
        const bucket = groups.get(item.action.group);
        if (bucket) bucket.push(item);
        else groups.set(item.action.group, [item]);
    }
    return Array.from(groups.entries());
}

/**
 * The searchable text for fuzzy scoring: title + group + keywords. (The score
 * function takes the best match across this blob; title-weighting is implicit
 * via the boundary/prefix bonuses landing on the title first.)
 */
function searchableText(action: Action): string {
    return `${action.title} ${action.group} ${(action.keywords ?? []).join(' ')}`;
}

/** The node type a `node.add.<type>` row spawns — shown as a mono type chip. */
function nodeTypeOf(action: Action): string | null {
    return action.id.startsWith('node.add.') ? action.id.slice('node.add.'.length) : null;
}

export function CommandBar({ intent }: { intent?: CommandBarOpenIntent | null }) {
    const [open, setOpen] = useState(() => intent?.kind === 'toggle');
    const modalEntries = useMemo(() => [{
        actionId: 'commandBar.toggle',
        run: () => { setOpen(false); return true; },
    }], []);
    useModalKeymap('command-bar', open, modalEntries);
    const [search, setSearch] = useState('');
    // The mode is PERSISTED (commandBarStore): close the bar in AI mode, press
    // Ctrl+K again, and you're back in the chat (conversation restored by the
    // agent session store). `open` itself is never persisted (no auto-open).
    const mode = useCommandBarStore((s) => s.mode);
    const setMode = useCommandBarStore((s) => s.setMode);
    // Text carried from the search input into AI mode on the Tab handoff.
    const [aiPrompt, setAiPrompt] = useState('');
    // When true, the AI panel sends `aiPrompt` as soon as it is ready. This is
    // the Tab contract: type → Tab → agent starts, no second Enter required.
    const [aiAutoSend, setAiAutoSend] = useState(false);
    // D6 (M7): when entering AI mode via "Configure AI provider", force the
    // AuthChooser even if a provider is already configured (so it can be changed).
    const [forceAuth, setForceAuth] = useState(false);
    // cmdk highlight value. Seeded/corrected to the top row on each keystroke
    // (see the layout effect below), but user arrow-nav updates it freely.
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Whatever held focus when the palette opened — restored on close so the
    // player lands back where they were (the canvas keeps its keys).
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    // Subscribe to the registry so newly-registered actions (e.g. AI-authored
    // DSP nodes) re-render the open palette live. We only need the change tick;
    // ranking re-reads getCommands() inside the memo below.
    const [registryTick, setRegistryTick] = useState(0);
    useEffect(() => subscribe(() => setRegistryTick((t) => t + 1)), []);

    // The local frecency floor (M2). Re-render on changes so picks re-rank.
    const learning = usePaletteLearningStore();
    // Live keybindings, so a REMAPPED shortcut shows its real keycap (Kbd's
    // `custom` tint) instead of the stock default.
    const customBindings = useKeybindingsStore((s) => s.customBindings);

    const close = useCallback(() => {
        // Persist the mode + conversation across close: only the transient search
        // UI is cleared. The agent session store keeps the chat so reopening lands
        // you exactly where you were (mode + conversation intact).
        setOpen(false);
        setSearch('');
        setAiPrompt('');
        setAiAutoSend(false);
        setForceAuth(false);
        setValue('');
        const restore = restoreFocusRef.current;
        restoreFocusRef.current = null;
        if (restore?.isConnected && typeof restore.focus === 'function') restore.focus();
    }, []);

    // Hand the typed text off to AI mode (Tab from search, or Enter on empty).
    const enterAiMode = useCallback(
        (autoSend = false) => {
            setAiPrompt(search);
            setAiAutoSend(autoSend && search.trim().length > 0);
            setForceAuth(false);
            setMode('ai');
        },
        [search, setMode],
    );

    // D6 (M7): host-owned intents open the lazy palette into search or AI flows.
    useEffect(() => {
        if (!intent) return;
        setOpen(true);
        if (intent.kind === 'configure-ai') {
            setAiPrompt('');
            setAiAutoSend(false);
            setForceAuth(true);
            setMode('ai');
        } else if (intent.kind === 'ask-ai') {
            const prompt = intent.prompt ?? '';
            setAiPrompt(prompt);
            setAiAutoSend(prompt.trim().length > 0);
            setForceAuth(false);
            setMode('ai');
        }
    }, [intent, setMode]);

    // Return from AI mode to search. The conversation is preserved (persisted),
    // so coming back to AI later picks up exactly where it left off.
    const backToSearch = useCallback(() => {
        setAiAutoSend(false);
        setMode('search');
    }, [setMode]);

    // Remember the pre-open focus once per opening, so closing hands it back.
    useEffect(() => {
        if (!open) return;
        const active = document.activeElement;
        if (restoreFocusRef.current === null && active instanceof HTMLElement) {
            restoreFocusRef.current = active;
        }
    }, [open]);

    // Focus the search input whenever the palette opens or returns to search.
    useEffect(() => {
        if (open && mode === 'search') {
            if (inputRef.current) inputRef.current.dataset.keyboardFocus = 'false';
            inputRef.current?.focus();
        }
    }, [open, mode]);

    /**
     * Match oj-ui Modal's focus trap while preserving search-mode Tab as the
     * explicit agent handoff (the input's own handler claims that Tab first,
     * so this only ever sees the ones nothing inside wanted).
     *
     * Tab is also the ONLY thing that moves DOM focus inside the palette, so it
     * is the only thing that lights the search field's ring: a ring says "focus
     * landed here by keyboard", not "someone is typing". Programmatic autofocus
     * on open therefore shows the accent border alone.
     */
    const onOverlayKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;
        if (inputRef.current) inputRef.current.dataset.keyboardFocus = 'true';
        if (event.defaultPrevented) return;
        const panel = containerRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (focusable.length === 0) {
            event.preventDefault();
            panel.focus();
            return;
        }
        // Focus already fell outside (a control unmounted under it, or the mode
        // swap emptied the panel for a frame). The scrim promises nothing behind
        // it is live, so pull focus back in rather than let Tab walk the chrome.
        if (!panel.contains(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
            return;
        }
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
        }
    }, []);

    /**
     * AI mode swaps the panel's whole content, and the honest browser-tier state
     * has no field to autofocus — focus would be left on `<body>`, OUTSIDE the
     * trap, where the next Tab walks straight into the topbar behind the scrim.
     * Pull it back to the top of the panel once the lazy panel has painted, and
     * never steal from a composer/list that focused itself.
     */
    useEffect(() => {
        if (!open || mode !== 'ai') return;
        let frames = 0;
        let raf = 0;
        const settle = () => {
            const panel = containerRef.current;
            if (!panel || panel.contains(document.activeElement)) return;
            const target = panel.querySelector<HTMLElement>(FOCUSABLE);
            if (target) target.focus();
            else if (frames++ < 20) raf = requestAnimationFrame(settle);
            else panel.focus();
        };
        raf = requestAnimationFrame(settle);
        return () => cancelAnimationFrame(raf);
    }, [open, mode]);

    // The Escape CASCADE's backstop. Every field and picker inside the bar
    // handles Escape first and marks the event handled; this catches the cases
    // where nothing inside holds focus (the browser tier's desktop-only state,
    // a clicked button) so Escape is NEVER dead on the topmost surface. React
    // delegates the portal's events on `document.body`, so by the time this
    // document-level listener runs, `defaultPrevented` is already truthful.
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            if (mode === 'ai') backToSearch();
            else close();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, mode, backToSearch, close]);

    // Rebuild the action context when the palette opens or the registry/selection
    // changes. (Selection is captured at open; the registry tick covers live
    // node registration. The Ctrl+K open is the natural rebuild point.)
    const paletteCtx: ActionCtx | null = useMemo(() => {
        if (!open || mode !== 'search') return null;
        return buildPaletteCtx();
        // registryTick included so a structural change rebuilds the ctx snapshot.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, registryTick]);

    // AI is offered when the platform can drive an agent (capability seam).
    const aiEnabled = paletteCtx ? paletteCtx.caps.agent !== 'none' : false;

    const resetRanking = useCallback(() => {
        // One global reset via the store action (keeps the empty-state shape in
        // one place); per-command reset is the menu's job in a later milestone.
        usePaletteLearningStore.getState().resetAll();
    }, []);

    // Only offer "Reset Ranking" once there is something learned to reset, so a
    // pristine palette never presents a no-op. It is a REAL ranked row, not a
    // pinned pseudo-item: it matches, scores and disappears like everything else.
    const hasLearned =
        Object.keys(learning.frecency).length > 0 ||
        Object.keys(learning.prefixWins).length > 0 ||
        Object.keys(learning.seedBoosts).length > 0;

    // Per-keystroke ranking. Memoized on (search, ctx, registry, learning).
    const ranked: RankedItem[] = useMemo(() => {
        if (!paletteCtx) return [];
        // Touch the registry tick + learning slices so the memo re-runs on change.
        void registryTick;
        // Surface/target filtering only — the fuzzy SUBSEQUENCE match + ranking is
        // owned here. Do NOT pass `query`: queryActions' substring prefilter would
        // drop genuine fzf matches (e.g. "adlp" → "Add Looper") before paletteScore
        // ever runs, silently defeating subsequence search.
        const candidates: Action[] = [...queryActions(paletteCtx, { surface: 'palette' })];
        if (hasLearned) {
            candidates.push({
                id: RESET_ITEM_ID,
                title: 'Reset Ranking',
                group: 'App',
                keywords: ['reset', 'ranking', 'frecency', 'clear', 'learning'],
                targets: ['global'],
                surfaces: ['palette'],
                run: resetRanking,
            });
        }

        const q = search.trim();
        const prefixWinner = q
            ? learning.prefixWins[q.slice(0, 3).toLowerCase()]
            : undefined;

        const scored = candidates.map((action) => {
            const key = action.frecencyKey ?? action.id;
            const fuzzy = q ? paletteScore(q, searchableText(action)) : 0;
            const learned = learning.scoreFor(key, paletteCtx);
            // Empty query → pure learned frecency (top picks on open).
            // Non-empty → fuzzy match dominates, learned breaks ties / nudges.
            let combined = q === '' ? learned : fuzzy + learned;
            // Hard-boost a prefix win to the very top…
            if (prefixWinner && key === prefixWinner) combined += 100_000;
            // …and an EXACT title match above even that (UI-028).
            combined += exactnessBoost(q, action.title);
            return { action, key, fuzzy, combined };
        });

        // With a query, keep only real subsequence matches (paletteScore > 0); an
        // empty query keeps every candidate (ordered purely by learned frecency).
        const matched = q === '' ? scored : scored.filter((s) => s.fuzzy > 0);

        matched.sort((a, b) => b.combined - a.combined);
        return matched.slice(0, MAX_ROWS).map(({ action, key }) => ({ action, key }));
        // `learning` is the store snapshot; scoreFor/prefixWins are read above and
        // re-rank whenever a pick mutates it.
    }, [paletteCtx, search, registryTick, learning, hasLearned, resetRanking]);

    const hasLocalResults = ranked.length > 0;

    // The cmdk highlight is a DERIVED controlled value (no effect, so it is
    // applied on the same render the ranking changes — cmdk's own "select first
    // item" pass can't win a race against it). UI-028: it seeks the first
    // ENABLED row, so a disabled entry is never the default selection.
    const highlightValue = ranked.find((item) => !item.action.disabledReason)?.action.id ?? '';

    // Seed/correct the highlight to the top row whenever the query or ranking
    // changes (a layout effect so it lands before paint, ahead of cmdk's own
    // "select the first item" pass). Within a single keystroke the user's arrow
    // navigation still updates `value` freely via onValueChange.
    useLayoutEffect(() => {
        if (mode !== 'search') return;
        setValue(highlightValue);
    }, [mode, search, highlightValue]);

    const runAction = useCallback(
        (item: RankedItem) => {
            if (!paletteCtx) return;
            // Record the pick BEFORE running (run may navigate away).
            learning.recordPick(item.key, paletteCtx, search);
            close();
            item.action.run(paletteCtx);
        },
        [paletteCtx, learning, search, close],
    );

    /** The real, live keycap for a row — or null when it has no binding. */
    const shortcutFor = useCallback(
        (action: Action): { label: string; custom: boolean } | null => {
            const bindingId = SHORTCUT_FOR[action.id];
            if (!bindingId) return null;
            const combo = useKeybindingsStore.getState().getBinding(bindingId);
            if (!combo) return null;
            return { label: keyComboToString(combo), custom: Boolean(customBindings[bindingId]) };
        },
        [customBindings],
    );

    if (!open) return null;

    const grouped = groupRanked(ranked);

    return createPortal(
        // ONE panel for BOTH modes over the theme scrim (Raycast-style): Tab
        // morphs the content in place rather than repositioning into a side rail,
        // so the AI feels like a natural extension of the same window. Clicking
        // the scrim closes. (See data-mode rules in CommandBar.css.)
        <div
            className="command-bar-overlay"
            data-mode={mode}
            onClick={close}
            onKeyDown={onOverlayKeyDown}
            onPointerDownCapture={() => {
                if (inputRef.current) inputRef.current.dataset.keyboardFocus = 'false';
            }}
        >
            <div
                ref={containerRef}
                className="command-bar-container"
                onClick={(e) => e.stopPropagation()}
                data-mode={mode}
                role="dialog"
                aria-modal="true"
                aria-label={mode === 'ai' ? 'Ask the agent' : 'Command palette'}
                tabIndex={-1}
            >
                {mode === 'ai' ? (
                    <Suspense fallback={null}>
                        <AiPanel
                            key={`${aiPrompt}:${aiAutoSend ? 'send' : 'draft'}:${forceAuth ? 'auth' : 'chat'}`}
                            initialPrompt={aiPrompt}
                            autoSendInitial={aiAutoSend}
                            forceAuth={forceAuth}
                            onBack={backToSearch}
                            onClose={close}
                        />
                    </Suspense>
                ) : (
                    <Command
                        label="Command Palette"
                        shouldFilter={false}
                        value={value}
                        onValueChange={setValue}
                        loop
                    >
                        <Command.Input
                            ref={inputRef}
                            className="command-bar-input"
                            data-keyboard-focus="false"
                            placeholder="Search commands…"
                            value={search}
                            onValueChange={setSearch}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    close();
                                } else if (e.key === 'Tab' && !e.shiftKey) {
                                    // Tab is the fast path: if there is text,
                                    // send it immediately; empty Tab just opens chat.
                                    e.preventDefault();
                                    enterAiMode(search.trim().length > 0);
                                } else if (
                                    e.key === 'Enter' &&
                                    !hasLocalResults &&
                                    aiEnabled
                                ) {
                                    // Nothing local matched — Enter is the same
                                    // handoff Tab makes, without a fake result row.
                                    e.preventDefault();
                                    enterAiMode(search.trim().length > 0);
                                }
                            }}
                        />
                        <Command.List className="command-bar-list">
                            {!hasLocalResults && (
                                <div className="command-bar-empty" role="status">
                                    <p className="command-bar-empty-title">
                                        No command for that
                                    </p>
                                    {/* Teach the way forward in BOTH tiers, and
                                        never point at an agent this platform
                                        cannot run. */}
                                    <p className="command-bar-empty-body">
                                        {aiEnabled ? (
                                            <>
                                                Press <Kbd>Tab</Kbd> to ask the agent to build it.
                                            </>
                                        ) : (
                                            <>Try a node name — Speaker, Looper, Effect.</>
                                        )}
                                    </p>
                                </div>
                            )}
                            {grouped.map(([group, items]) => (
                                <Command.Group
                                    key={group}
                                    heading={group}
                                    className="command-bar-group"
                                >
                                    {items.map((item) => {
                                        const shortcut = shortcutFor(item.action);
                                        const nodeType = nodeTypeOf(item.action);
                                        return (
                                            <Command.Item
                                                key={item.action.id}
                                                value={item.action.id}
                                                keywords={[
                                                    item.action.title,
                                                    item.action.group,
                                                    ...(item.action.keywords ?? []),
                                                ]}
                                                className="command-bar-item"
                                                onSelect={() => runAction(item)}
                                                disabled={Boolean(item.action.disabledReason)}
                                                title={item.action.disabledReason}
                                            >
                                                <span className="command-bar-item__label">
                                                    {item.action.title}
                                                </span>
                                                {item.action.disabledReason && (
                                                    <span className="command-bar-item__hint">
                                                        {item.action.disabledReason}
                                                    </span>
                                                )}
                                                {nodeType && (
                                                    <Chip className="command-bar-item__type">
                                                        {nodeType}
                                                    </Chip>
                                                )}
                                                {shortcut && (
                                                    <Kbd
                                                        className="command-bar-item__key"
                                                        custom={shortcut.custom}
                                                    >
                                                        {shortcut.label}
                                                    </Kbd>
                                                )}
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            ))}
                        </Command.List>
                        <div className="command-bar-footer">
                            <span className="command-bar-footer-hints">
                                <span><Kbd>↑↓</Kbd> navigate</span>
                                <span><Kbd>↵</Kbd> run</span>
                                <span><Kbd>Esc</Kbd> close</span>
                            </span>
                            {aiEnabled ? (
                                <button
                                    type="button"
                                    className="command-bar-ask"
                                    onClick={() => enterAiMode(search.trim().length > 0)}
                                >
                                    <span>Ask the agent</span>
                                    <Kbd>Tab</Kbd>
                                </button>
                            ) : (
                                <span className="command-bar-ask-off">
                                    The agent runs in the desktop app
                                </span>
                            )}
                        </div>
                    </Command>
                )}
            </div>
        </div>,
        document.body,
    );
}
