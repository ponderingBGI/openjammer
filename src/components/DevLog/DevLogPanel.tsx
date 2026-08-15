/**
 * DevLogPanel (L4, Layer 2) — the in-app developer log surface.
 *
 * An oj-ui {@link Modal} overlay (portal + scrim + Escape + focus-trap +
 * click-outside are owned by the Modal) toggled with Ctrl/Cmd+Shift+L and via
 * the "Toggle DevLog" command in the Ctrl/Cmd+K palette. It tails the bounded
 * {@link useLogStore} ring and offers:
 *   • a header with a visible "N dropped" badge (ships day one — the ring drops
 *     under load and without this the panel would silently lie), a Clear button
 *     and a Close button;
 *   • level facet chips and scope facet chips, each with a LIVE count, that
 *     filter the list;
 *   • a debounced case-insensitive search over message + scope;
 *   • a scrollable log list; clicking a row that carries a `corr` id filters to
 *     that correlation (click-to-correlate — the L4 cross-seam capability).
 *
 * PERF at high event rates: the filtered list is rendered as a WINDOWED slice —
 * only the rows near the scroll position are mounted (fixed row height + a small
 * overscan), so a full 5000-entry ring costs O(visible) DOM nodes, not O(5000).
 * This is a lightweight manual windowing with zero new dependencies.
 * If variable-height rows or very large rings ever make manual windowing
 * insufficient, `@tanstack/react-virtual` is the natural next step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBindingSet, useModalKeymap } from '../../keymap/useKeymap';
import { useDebounce } from 'use-debounce';
import type { Severity } from '@openjammer/oj-protocol';
import {
    Modal,
    PanelHeader,
    Button,
    Input,
    Chip,
    StatusDot,
    type ChipTone,
    type StatusDotStatus,
} from '@openjammer/oj-ui';
import {
    useLogStore,
    filterEntries,
    levelCounts,
    scopeCounts,
    type LogEntry,
    type LogView,
} from '../../store/logStore';
import './DevLogPanel.css';

/** Severities in display order, for the level facet chips. */
const LEVELS: readonly Severity[] = ['Trace', 'Debug', 'Info', 'Warn', 'Error'];

/** The level → StatusDot status mapping for the facet chips' leading dots. */
const LEVEL_DOT: Readonly<Record<Severity, StatusDotStatus>> = {
    Trace: 'idle',
    Debug: 'idle',
    Info: 'info',
    Warn: 'warn',
    Error: 'bad',
};

/** The level → Chip tone mapping (Warn/Error read their state color). */
const LEVEL_TONE: Readonly<Record<Severity, ChipTone>> = {
    Trace: 'neutral',
    Debug: 'neutral',
    Info: 'neutral',
    Warn: 'warning',
    Error: 'danger',
};

/**
 * The prompt the "Ask AI to fix this" button seeds the assistant with. It nudges
 * the agent to actually USE its diagnostics tools (it has get_diagnostics /
 * get_logs / update_settings) rather than guess.
 */
const ASK_AI_SEED =
    "Something isn't working in OpenJammer. Diagnose it: call get_diagnostics and " +
    'get_logs (filter to Warn/Error), tell me in a sentence or two what is wrong, ' +
    'and fix it if you safely can — e.g. select the right audio device, adjust the ' +
    'latency settings, or wire the missing path to a speaker. Keep every change reversible.';

/** Fixed row height (px) used by the windowing math. Must match the CSS row height. */
const ROW_HEIGHT = 28;
/** Extra rows rendered above/below the viewport to keep scrolling smooth. */
const OVERSCAN = 8;

/**
 * The DevLog ships in EVERY build — including production.
 *
 * It is a hidden-until-toggled portal overlay (Ctrl/Cmd+Shift+L or the palette),
 * so it costs nothing in the live UX, but it is exactly the surface a performer
 * needs when something breaks on stage: the structured tail of engine xruns,
 * node faults, MIDI, and asset/plugin events. The AI assistant reads the SAME
 * {@link useLogStore} ring via its `get_logs` tool, so "help me get sound back"
 * and "show me the logs" are the one source of truth. Shipping it everywhere is
 * a deliberate product decision (live-debuggability > hiding the panel).
 */

/** Format an entry timestamp as HH:MM:SS.mmm for the row time column. */
function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

export function DevLogPanel() {
    // Thin wrapper kept for parity with the CommandBar/portal pattern; the panel
    // ships in every build (see the DEVLOG note above) and is hidden until toggled.
    return <DevLogPanelInner />;
}

function DevLogPanelInner() {
    const [open, setOpen] = useState(false);
    const modalEntries = useMemo(() => [{
        actionId: 'panel.devLog', run: () => { setOpen(false); return true; },
    }], []);
    useModalKeymap('dev-log', open, modalEntries);
    useBindingSet(useMemo(() => ({
        id: 'dev-log-toggle',
        scope: 'global' as const,
        entries: [{ actionId: 'panel.devLog', run: () => { setOpen((value) => !value); return true; } }],
    }), []));

    // Filter state.
    const [activeLevels, setActiveLevels] = useState<ReadonlySet<Severity> | null>(null);
    const [activeScope, setActiveScope] = useState<string | null>(null);
    const [activeCorr, setActiveCorr] = useState<number | null>(null);
    const [rawSearch, setRawSearch] = useState('');
    const [search] = useDebounce(rawSearch, 150);

    // The bounded ring + dropped counter.
    const entries = useLogStore((s) => s.entries);
    const droppedCount = useLogStore((s) => s.droppedCount);
    const clear = useLogStore((s) => s.clear);

    // Global Ctrl/Cmd+Shift+L toggle + the command bridge. (Escape-to-close is
    // owned by the Modal once the panel is open.)
    useEffect(() => {
        const onCommand = () => setOpen((v) => !v);
        window.addEventListener('openjammer:toggle-devlog', onCommand);
        return () => {
            window.removeEventListener('openjammer:toggle-devlog', onCommand);
        };
    }, []);

    // Live facet counts over the FULL ring (so a chip's count reflects reality,
    // not the already-filtered view).
    const levelTally = useMemo(() => levelCounts(entries), [entries]);
    const scopeTally = useMemo(() => scopeCounts(entries), [entries]);

    // The filtered view, recomputed when the ring or any filter changes.
    const view: LogView = useMemo(
        () => ({ levels: activeLevels, scope: activeScope, search, corr: activeCorr }),
        [activeLevels, activeScope, search, activeCorr],
    );
    const filtered = useMemo(() => filterEntries(entries, view), [entries, view]);

    const toggleLevel = useCallback((level: Severity) => {
        setActiveLevels((prev) => {
            const next = new Set(prev ?? []);
            if (next.has(level)) next.delete(level);
            else next.add(level);
            // Empty selection == "all levels" (null), so chips never lock the list empty.
            return next.size === 0 ? null : next;
        });
    }, []);

    const toggleScope = useCallback((scope: string) => {
        setActiveScope((prev) => (prev === scope ? null : scope));
    }, []);

    // Click-to-correlate: a row with a corr id pins the view to that corr.
    const onRowClick = useCallback((entry: LogEntry) => {
        if (entry.corr === undefined) return;
        setActiveCorr((prev) => (prev === entry.corr ? null : (entry.corr as number)));
    }, []);

    const resetFilters = useCallback(() => {
        setActiveLevels(null);
        setActiveScope(null);
        setActiveCorr(null);
        setRawSearch('');
    }, []);

    const close = useCallback(() => setOpen(false), []);

    const askAi = useCallback(() => {
        setOpen(false);
        window.dispatchEvent(
            new CustomEvent('openjammer:ask-ai', { detail: { prompt: ASK_AI_SEED } }),
        );
    }, []);

    return (
        <Modal open={open} onClose={close} ariaLabel="Developer Log" align="bottom" size="lg">
            <div className="devlog-panel">
                {/* ── Header ─────────────────────────────────────────────── */}
                <PanelHeader
                    title="DevLog"
                    badge={
                        <span className="devlog-badge">
                            <span className="devlog-count">
                                {filtered.length}
                                {filtered.length !== entries.length ? ` / ${entries.length}` : ''}
                            </span>
                            {droppedCount > 0 && (
                                <Chip
                                    tone="danger"
                                    title="Entries evicted because the ring buffer was full"
                                >
                                    {droppedCount} dropped
                                </Chip>
                            )}
                        </span>
                    }
                    actions={
                        <>
                            <Button
                                variant="primary"
                                onClick={askAi}
                                title="Open the AI assistant seeded to diagnose + fix this from the logs"
                            >
                                Ask AI to fix this
                            </Button>
                            <Button onClick={clear} title="Clear all log entries">
                                Clear
                            </Button>
                        </>
                    }
                    onClose={close}
                />

                {/* ── Facets + search ────────────────────────────────────── */}
                <div className="devlog-facets">
                    <div className="devlog-chips" role="group" aria-label="Filter by level">
                        {LEVELS.map((level) => {
                            const active = activeLevels?.has(level) ?? false;
                            return (
                                <Chip
                                    key={level}
                                    role="button"
                                    tabIndex={0}
                                    tone={LEVEL_TONE[level]}
                                    pressed={active}
                                    glyph={<StatusDot status={LEVEL_DOT[level]} />}
                                    count={levelTally[level]}
                                    aria-pressed={active}
                                    aria-label={`Filter by ${level} (${levelTally[level]})`}
                                    className="devlog-chip"
                                    onClick={() => toggleLevel(level)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            toggleLevel(level);
                                        }
                                    }}
                                >
                                    {level}
                                </Chip>
                            );
                        })}
                    </div>
                    {scopeTally.size > 0 && (
                        <div className="devlog-chips" role="group" aria-label="Filter by scope">
                            {Array.from(scopeTally.entries()).map(([scope, count]) => {
                                const active = activeScope === scope;
                                return (
                                    <Chip
                                        key={scope}
                                        role="button"
                                        tabIndex={0}
                                        pressed={active}
                                        count={count}
                                        aria-pressed={active}
                                        aria-label={`Filter by scope ${scope} (${count})`}
                                        className="devlog-chip devlog-chip-scope"
                                        onClick={() => toggleScope(scope)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggleScope(scope);
                                            }
                                        }}
                                    >
                                        {scope}
                                    </Chip>
                                );
                            })}
                        </div>
                    )}
                    <Input
                        className="devlog-search"
                        type="text"
                        placeholder="Search messages…"
                        value={rawSearch}
                        onChange={(e) => setRawSearch(e.target.value)}
                    />
                </div>

                {/* Active correlation banner (click-to-correlate). */}
                {activeCorr !== null && (
                    <div className="devlog-corr-banner">
                        Showing correlation #{activeCorr}
                        <Button variant="link" onClick={() => setActiveCorr(null)}>
                            clear
                        </Button>
                    </div>
                )}

                {/* ── Windowed log list ──────────────────────────────────── */}
                <LogList entries={filtered} onRowClick={onRowClick} onResetFilters={resetFilters} hasRing={entries.length > 0} />
            </div>
        </Modal>
    );
}

/** The scrollable, windowed list of filtered entries. */
function LogList({
    entries,
    onRowClick,
    onResetFilters,
    hasRing,
}: {
    entries: readonly LogEntry[];
    onRowClick: (entry: LogEntry) => void;
    onResetFilters: () => void;
    hasRing: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportH, setViewportH] = useState(0);

    // Measure the viewport once mounted and on resize so windowing maths are honest.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => setViewportH(el.clientHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const total = entries.length;
    // Clamp so a high scrollTop + a suddenly-shrunk list (filter/reset/clear) can
    // never push the window past the end and mount an empty slice despite rows.
    const rawFirst = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const firstVisible = total === 0 ? 0 : Math.min(rawFirst, total - 1);
    const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2;
    const lastVisible = Math.min(total, firstVisible + visibleCount);
    const slice = entries.slice(firstVisible, lastVisible);

    if (total === 0) {
        return (
            <div className="devlog-list devlog-empty">
                {hasRing ? (
                    <>
                        No entries match the current filters.{' '}
                        <Button variant="link" onClick={onResetFilters}>
                            reset
                        </Button>
                    </>
                ) : (
                    'No log entries yet.'
                )}
            </div>
        );
    }

    return (
        <div
            className="devlog-list"
            ref={scrollRef}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
            {/* Spacer establishes the full scroll height; rows are absolutely placed. */}
            <div className="devlog-rows" style={{ height: total * ROW_HEIGHT }}>
                {slice.map((entry, i) => {
                    const index = firstVisible + i;
                    return (
                        <div
                            key={entry.id}
                            className="devlog-row"
                            data-level={entry.level}
                            data-clickable={entry.corr !== undefined}
                            style={{ top: index * ROW_HEIGHT }}
                            onClick={() => onRowClick(entry)}
                            title={entry.corr !== undefined ? `Click to correlate (#${entry.corr})` : undefined}
                        >
                            <span className="devlog-cell-ts">{formatTime(entry.ts)}</span>
                            <span className="devlog-cell-level" data-level={entry.level}>
                                {entry.level}
                            </span>
                            <span className="devlog-cell-scope">{entry.scope}</span>
                            <span className="devlog-cell-msg">
                                {entry.message}
                                {entry.fields !== undefined && (
                                    <span className="devlog-cell-fields">{JSON.stringify(entry.fields)}</span>
                                )}
                            </span>
                            {entry.corr !== undefined && <span className="devlog-cell-corr">#{entry.corr}</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
