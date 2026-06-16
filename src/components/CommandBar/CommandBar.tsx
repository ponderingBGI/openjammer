/**
 * CommandBar (U19 + U20 + M2) — Raycast-style Ctrl/Cmd+K command palette.
 *
 * Rendered once at the app root. Owns its own open/close state and the global
 * Ctrl/Cmd+K toggle. Built from cmdk's primitives (`Command`, `Command.Input`,
 * `Command.List`, ...) rendered INSIDE this repo's existing overlay/portal
 * pattern (see SettingsPanel) — deliberately NOT `Command.Dialog`, to avoid
 * pulling in the Radix Dialog subtree.
 *
 * TWO MODES:
 * - 'search' (U19): the action registry, ranked HERE (M2), not by cmdk.
 * - 'ai' (U20): press Tab from search to hand the typed text to the AI agent.
 *   The agent half renders in {@link AiPanel}: a streaming transcript with an
 *   Approve / Reject transaction, or the "AI requires the desktop app" state in
 *   a plain browser.
 *
 * M2 — the palette OWNS its ordering:
 * - `shouldFilter={false}`: cmdk no longer filters/ranks; this file does.
 * - {@link buildPaletteCtx} gives the capability seam + selection context; we
 *   {@link queryActions} the registry for the 'palette' surface, then SCORE each
 *   row by `paletteScore(query, …)` combined with the local frecency floor
 *   ({@link usePaletteLearningStore}). A prefix-win is hard-boosted to the top;
 *   the list is sorted desc and capped. An empty query orders by learned
 *   frecency ("top picks on open").
 * - On pick we `recordPick(...)` BEFORE running the action (so the learning
 *   reflects the choice even if `run` navigates away), then close.
 * - The dedicated AI item + the Tab fast-path are preserved EXACTLY. The AI item
 *   is conceptually an Action (`enabled: caps.agent !== 'none'`); when there are
 *   ZERO local results it is auto-highlighted (D2-A2) so Enter asks the agent.
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import {
    queryActions,
    subscribe,
    type Action,
    type ActionCtx,
} from '../../store/commandRegistry';
import { buildPaletteCtx } from '../../store/actionContext';
import { usePaletteLearningStore } from '../../store/paletteLearningStore';
import { score as paletteScore } from '../../store/paletteScore';
import { useCommandSources } from './useCommandSources';
import { AiPanel } from './AiPanel';
import { useAgentSessionStore } from '../../store/agentSessionStore';
import './CommandBar.css';

/** Bar mode: 'search' (U19, the action registry) or 'ai' (U20, the agent). */
type CommandBarMode = 'search' | 'ai';

/** Max rows rendered after ranking (keeps the list snappy). */
const MAX_ROWS = 50;

/** Stable cmdk `value` for the dedicated AI item (used for auto-highlight). */
const AI_ITEM_VALUE = '__ai__';

/** Stable cmdk `value` for the "Reset Ranking" item. */
const RESET_ITEM_VALUE = '__reset_ranking__';

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

export function CommandBar() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [mode, setMode] = useState<CommandBarMode>('search');
    // Text carried from the search input into AI mode on the Tab handoff.
    const [aiPrompt, setAiPrompt] = useState('');
    // D6 (M7): when entering AI mode via "Configure AI provider", force the
    // AuthChooser even if a provider is already configured (so it can be changed).
    const [forceAuth, setForceAuth] = useState(false);
    // cmdk highlight value. Seeded/corrected to the top row on each keystroke
    // (see the layout effect below), but user arrow-nav updates it freely.
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Register node-add + app-action commands while mounted.
    useCommandSources();

    // Subscribe to the registry so newly-registered actions (e.g. AI-authored
    // DSP nodes) re-render the open palette live. We only need the change tick;
    // ranking re-reads getCommands() inside the memo below.
    const [registryTick, setRegistryTick] = useState(0);
    useEffect(() => subscribe(() => setRegistryTick((t) => t + 1)), []);

    // The local frecency floor (M2). Re-render on changes so picks re-rank.
    const learning = usePaletteLearningStore();

    const close = useCallback(() => {
        setOpen(false);
        setSearch('');
        setMode('search');
        setAiPrompt('');
        setForceAuth(false);
        setValue('');
        // Drop any in-flight / pending agent transaction when the bar closes.
        useAgentSessionStore.getState().reset();
    }, []);

    // Hand the typed text off to AI mode (Tab from search, or the "Ask AI" item).
    const enterAiMode = useCallback(() => {
        setAiPrompt(search);
        setForceAuth(false);
        setMode('ai');
    }, [search]);

    // D6 (M7): the "Configure AI provider" action opens AI mode straight into the
    // AuthChooser (forceAuth), so a configured user can still re-pick a provider.
    useEffect(() => {
        const onConfigure = () => {
            setOpen(true);
            setAiPrompt('');
            setForceAuth(true);
            setMode('ai');
        };
        window.addEventListener('openjammer:configure-ai', onConfigure);
        return () => window.removeEventListener('openjammer:configure-ai', onConfigure);
    }, []);

    // Return from AI mode to search, discarding any pending agent transaction.
    const backToSearch = useCallback(() => {
        useAgentSessionStore.getState().reset();
        setMode('search');
    }, []);

    // Global Ctrl/Cmd+K toggle. MUST early-return when the palette is already
    // open/focused so the handler doesn't fight the in-palette key handling
    // (cmdk owns arrow/enter/escape once focus is inside).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isToggle = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
            if (!isToggle) return;
            if (open) return;
            e.preventDefault();
            setOpen(true);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open]);

    // Focus the search input whenever the palette opens or returns to search.
    useEffect(() => {
        if (open && mode === 'search') inputRef.current?.focus();
    }, [open, mode]);

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

    // Per-keystroke ranking. Memoized on (search, ctx, registry, learning).
    const ranked: RankedItem[] = useMemo(() => {
        if (!paletteCtx) return [];
        // Touch the registry tick + learning slices so the memo re-runs on change.
        void registryTick;
        const candidates = queryActions(paletteCtx, {
            surface: 'palette',
            query: search,
        });

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
            // Hard-boost a prefix win to the very top.
            if (prefixWinner && key === prefixWinner) combined += 100_000;
            return { action, key, combined };
        });

        scored.sort((a, b) => b.combined - a.combined);
        return scored.slice(0, MAX_ROWS).map(({ action, key }) => ({ action, key }));
        // `learning` is the store snapshot; scoreFor/prefixWins are read above and
        // re-rank whenever a pick mutates it.
    }, [paletteCtx, search, registryTick, learning]);

    const hasLocalResults = ranked.length > 0;
    // Only offer "Reset Ranking" once there is something learned to reset, so a
    // pristine palette never presents a no-op.
    const hasLearned =
        Object.keys(learning.frecency).length > 0 ||
        Object.keys(learning.prefixWins).length > 0 ||
        Object.keys(learning.seedBoosts).length > 0;

    // The cmdk highlight is a DERIVED controlled value (no effect, so it is
    // applied on the same render the ranking changes — cmdk's own "select first
    // item" pass can't win a race against it):
    // - results present → the top-ranked row;
    // - ZERO local results + AI available → the AI item (D2-A2), so Enter asks AI;
    // - else the Reset item when it is shown; otherwise nothing highlighted.
    let highlightValue = '';
    if (hasLocalResults) highlightValue = ranked[0].action.id;
    else if (aiEnabled) highlightValue = AI_ITEM_VALUE;
    else if (hasLearned) highlightValue = RESET_ITEM_VALUE;

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

    const resetRanking = useCallback(() => {
        // One global reset via the store action (keeps the empty-state shape in
        // one place); per-command reset is the menu's job in a later milestone.
        usePaletteLearningStore.getState().resetAll();
        close();
    }, [close]);

    if (!open) return null;

    const grouped = groupRanked(ranked);

    return createPortal(
        <div className="command-bar-overlay" onClick={close}>
            <div
                className="command-bar-container"
                onClick={(e) => e.stopPropagation()}
                data-mode={mode}
            >
                {mode === 'ai' ? (
                    <AiPanel
                        initialPrompt={aiPrompt}
                        forceAuth={forceAuth}
                        onBack={backToSearch}
                        onClose={close}
                    />
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
                            placeholder="Search commands… (Tab to ask AI)"
                            value={search}
                            onValueChange={setSearch}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    close();
                                } else if (e.key === 'Tab') {
                                    // Tab hands the typed text off to the AI agent.
                                    e.preventDefault();
                                    enterAiMode();
                                }
                            }}
                        />
                        <Command.List className="command-bar-list">
                            <Command.Empty className="command-bar-empty">
                                No results found.
                            </Command.Empty>
                            {/*
                             * Ranked registry rows render FIRST so DOM order
                             * agrees with our highlight (the AI/Reset items sit
                             * last and only auto-highlight when there are zero
                             * local results — see `highlightValue`).
                             */}
                            {grouped.map(([group, items]) => (
                                <Command.Group
                                    key={group}
                                    heading={group}
                                    className="command-bar-group"
                                >
                                    {items.map((item) => (
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
                                        >
                                            {item.action.title}
                                        </Command.Item>
                                    ))}
                                </Command.Group>
                            ))}
                            <Command.Group heading="AI" className="command-bar-group">
                                <Command.Item
                                    value={AI_ITEM_VALUE}
                                    keywords={['ai', 'ask', 'agent', search]}
                                    className="command-bar-item command-bar-item-ai"
                                    onSelect={enterAiMode}
                                    disabled={!aiEnabled}
                                >
                                    {search.trim()
                                        ? `Ask AI: "${search.trim()}"`
                                        : 'Ask AI to build something…'}
                                </Command.Item>
                            </Command.Group>
                            {hasLearned && (
                                <Command.Group heading="App" className="command-bar-group">
                                    <Command.Item
                                        value={RESET_ITEM_VALUE}
                                        keywords={['reset', 'ranking', 'frecency', 'clear']}
                                        className="command-bar-item"
                                        onSelect={resetRanking}
                                    >
                                        Reset Ranking
                                    </Command.Item>
                                </Command.Group>
                            )}
                        </Command.List>
                    </Command>
                )}
            </div>
        </div>,
        document.body,
    );
}
