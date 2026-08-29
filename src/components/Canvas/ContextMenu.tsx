/**
 * Context Menu (M4 → W4-P5) — a FILTERED PROJECTION of the Action registry,
 * rendered with the oj-ui `Menu` family.
 *
 * ComfyUI-style right-click menu. It reads the SAME {@link queryActions}
 * registry the Ctrl+K palette reads, filtered to `surface: 'menu'`. Adding an
 * action with `surfaces: ['palette', 'menu']` makes it appear here for free —
 * the menu is a curated SUBSET of the palette SUPERSET. AI-authored DSP nodes
 * therefore show up automatically.
 *
 * The friendly NESTED-CATEGORY UX is preserved: items are grouped by
 * `action.path?.[0]` (falling back to `action.group`) and rendered in the
 * historical menu order (Input, Instruments, Routing, Effects, Utility,
 * Output), with any extra groups (e.g. 'AI DSP') appended after.
 *
 * W4-P5 replaces the bespoke CSS engine with `Menu`/`MenuItem`/`MenuCategory`/
 * `MenuSeparator` and fixes the two audited defects:
 *   - UI-003 — the menu is fully keyboard-operable: roving focus (oj-ui Menu),
 *     Home/End, typeahead, Left/Right submenu disclosure, Enter/Space, an
 *     Escape cascade, and focus restored to whatever held it before the menu
 *     opened. Disclosure is DRIVEN BY STATE (`data-open`), never by `:hover`,
 *     so touch and keyboard reach a submenu exactly the way a mouse does.
 *   - UI-004 — the root panel AND every submenu are measured, flipped and
 *     clamped inside the viewport (recomputed on resize).
 *
 * The MIDI special-case is preserved: selecting the "Add Midi" action
 * (`node.add.midi`) opens the device browser via `onOpenMIDIBrowser` instead of
 * spawning a node directly.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuCategory, MenuItem, MenuSeparator } from '@openjammer/oj-ui';
import type { Position } from '../../engine/types';
import { useCanvasStore } from '../../store/canvasStore';
import { buildMenuCtx } from '../../store/actionContext';
import { queryActions, type Action } from '../../store/commandRegistry';
import './ContextMenu.css';

interface ContextMenuProps {
    /** Screen-space point where the menu opens (the right-click position). */
    position: Position;
    onClose: () => void;
    /** MIDI special-case: open the device browser instead of adding a node. */
    onOpenMIDIBrowser?: () => void;
}

/** The action id of the MIDI add, special-cased to open the device browser. */
const MIDI_ADD_ID = 'node.add.midi';

/** Breathing room kept between any menu panel and the viewport edge. */
const VIEWPORT_PAD = 8;

/** How long a typeahead buffer stays alive between keystrokes. */
const TYPEAHEAD_MS = 700;

/**
 * Historical category order (matches `menuCategories` in the registry). Groups
 * not in this list (e.g. 'AI DSP') are appended after, in first-seen order.
 */
const CATEGORY_ORDER = ['Input', 'Instruments', 'Routing', 'Effects', 'Utility', 'Output'];

/**
 * Presentational icon per known category, so the byte-faithful nested UX keeps
 * its emoji. This is a MENU-LOCAL display concern (the registry carries no
 * icons); unknown groups (e.g. 'AI DSP') render without one.
 */
const CATEGORY_ICON: Record<string, string> = {
    Input: '⌨️',
    Instruments: '🎻',
    Routing: '🔄',
    Effects: '✨',
    Utility: '🔧',
    Output: '🔊',
};

/** The group an action belongs to in the menu: `path[0]`, else `group`. */
function menuGroupOf(action: Action): string {
    return action.path?.[0] ?? action.group;
}

interface MenuCategoryModel {
    name: string;
    items: Action[];
}

/** Group `actions` by menu category and order categories historically. */
function groupByCategory(actions: readonly Action[]): MenuCategoryModel[] {
    const byName = new Map<string, Action[]>();
    for (const action of actions) {
        const name = menuGroupOf(action);
        const bucket = byName.get(name);
        if (bucket) {
            bucket.push(action);
        } else {
            byName.set(name, [action]);
        }
    }

    const ordered: MenuCategoryModel[] = [];
    // Known categories first, in historical order.
    for (const name of CATEGORY_ORDER) {
        const items = byName.get(name);
        if (items) {
            ordered.push({ name, items });
            byName.delete(name);
        }
    }
    // Any remaining (unknown/extra) groups, in first-seen (insertion) order.
    for (const [name, items] of byName) {
        ordered.push({ name, items });
    }
    return ordered;
}

export function ContextMenu({ position, onClose, onOpenMIDIBrowser }: ContextMenuProps) {
    // The fixed-position host; the oj-ui `Menu` panel is its only child, so the
    // component keeps its own positioning without oj-ui needing a ref API.
    const hostRef = useRef<HTMLDivElement>(null);

    const screenToCanvas = useCanvasStore((s) => s.screenToCanvas);

    /** Which category's submenu is disclosed (null = none). */
    const [openCategory, setOpenCategory] = useState<string | null>(null);

    /** Bumped on resize so every panel re-measures without re-opening. */
    const [measureTick, setMeasureTick] = useState(0);

    const typeaheadRef = useRef<{ buffer: string; at: number; scope: string }>({
        buffer: '',
        at: 0,
        scope: '',
    });

    /**
     * Run buffered typeahead inside ONE panel. `scope` names the panel that owns
     * focus, so a buffer typed in the root never bleeds into a submenu (or back)
     * — crossing panels starts a fresh word, the way the eye expects.
     */
    const focusTypeaheadMatch = useCallback((
        key: string,
        rows: HTMLElement[],
        active: HTMLElement | null,
        scope: string,
    ) => {
        const now = Date.now();
        const state = typeaheadRef.current;
        const stale = now - state.at > TYPEAHEAD_MS || state.scope !== scope;
        state.buffer = stale ? key : state.buffer + key;
        state.at = now;
        state.scope = scope;
        const needle = state.buffer.toLowerCase();
        const from = rows.indexOf(active as HTMLElement);
        for (let i = 1; i <= rows.length; i += 1) {
            const candidate = rows[(from + i + rows.length) % rows.length];
            // Match the LABEL, not the row — the leading category emoji is
            // decoration and would make every row start with a glyph.
            const label = candidate
                ?.querySelector('.oj-menu-item__label')
                ?.textContent?.trim()
                .toLowerCase();
            // Submenu actions are all phrased "Add Speaker" / "Add Oscillator",
            // so the verb carries no information: reaching for "s" must find
            // Speaker. The literal label still matches, so nothing is lost.
            const noun = label?.replace(/^add\s+/, '');
            if (label?.startsWith(needle) || noun?.startsWith(needle)) {
                candidate.focus();
                return;
            }
        }
    }, []);

    /** The oj-ui panel element (the roving-focus root). */
    const panelEl = useCallback(
        () => hostRef.current?.querySelector<HTMLElement>(':scope > .oj-menu') ?? null,
        [],
    );

    /** The rows the ROOT panel's roving focus / typeahead can land on. */
    const rootRows = useCallback((): HTMLElement[] => {
        const panel = panelEl();
        if (!panel) return [];
        return Array.from(
            panel.querySelectorAll<HTMLElement>(
                ':scope > .oj-menu-item:not([aria-disabled="true"])',
            ),
        );
    }, [panelEl]);

    /** Move focus to a category row by name (after a submenu closes). */
    const focusCategoryRow = useCallback(
        (name: string) => {
            rootRows()
                .find((row) => row.dataset.category === name)
                ?.focus();
        },
        [rootRows],
    );

    // Build the menu context ONCE per open (the clicked canvas point). The
    // registry is the single source — group the projected actions into the
    // nested category UX. Recomputed when the open position changes.
    const categories = useMemo(() => {
        const menuCtx = buildMenuCtx({ point: screenToCanvas(position) });
        const items = queryActions(menuCtx, { surface: 'menu' });
        return groupByCategory(items);
    }, [position, screenToCanvas]);

    // Restore focus to whatever held it before the menu opened (UI-003). A menu
    // that steals focus and never gives it back strands the keyboard player.
    // Then drop focus on the first row so arrows/typeahead work immediately.
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        rootRows()[0]?.focus();
        return () => {
            if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
        };
    }, [rootRows]);

    // Close on click outside / Escape. Escape CASCADES: an open submenu closes
    // first (focus returns to its category row), then the menu itself.
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (hostRef.current && !hostRef.current.contains(e.target as Node)) onClose();
        }

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            if (openCategory) {
                setOpenCategory(null);
                focusCategoryRow(openCategory);
                return;
            }
            onClose();
        }

        function handleViewportChange() {
            setMeasureTick((t) => t + 1);
        }

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleViewportChange);

        // The panel's own size settles late (webfonts, the emoji glyphs, a
        // registry that grows while the menu is open). Clamping once against a
        // stale height is exactly how a menu ends up hanging off the screen, so
        // re-measure whenever it actually changes size.
        const panel = panelEl();
        const observer =
            panel && typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(handleViewportChange)
                : null;
        if (panel && observer) observer.observe(panel);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleViewportChange);
            observer?.disconnect();
        };
    }, [focusCategoryRow, onClose, openCategory, panelEl]);

    // UI-004 — measure, flip and clamp EVERY panel inside the viewport, before
    // paint and in one pass (the root first, then whichever submenu is
    // disclosed, which must be placed against the root's final position).
    // Written straight to the DOM: this is layout the browser owns, not state
    // React should re-render for.
    useLayoutEffect(() => {
        const host = hostRef.current;
        const panel = panelEl();
        if (!host || !panel) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Park the host at the raw click point, then measure. The delta between
        // what we asked for and where the panel actually landed is the offset of
        // the host's containing block — non-zero whenever an ancestor carries a
        // transform, which is exactly what made the clamp miss by the height of
        // the topbar. Every number below is therefore in VIEWPORT space, and the
        // offset is subtracted once at the end.
        host.style.left = `${position.x}px`;
        host.style.top = `${position.y}px`;
        const rect = panel.getBoundingClientRect();
        const offsetX = rect.left - position.x;
        const offsetY = rect.top - position.y;
        const { width, height } = rect;

        // Flip to the click point's other side when there is no room, then clamp
        // so a tall menu never hangs off the top/left either.
        let left = position.x;
        if (left + width > vw - VIEWPORT_PAD) left = position.x - width;
        left = Math.min(Math.max(VIEWPORT_PAD, left), Math.max(VIEWPORT_PAD, vw - width - VIEWPORT_PAD));
        let top = position.y;
        if (top + height > vh - VIEWPORT_PAD) top = position.y - height;
        top = Math.min(Math.max(VIEWPORT_PAD, top), Math.max(VIEWPORT_PAD, vh - height - VIEWPORT_PAD));
        host.style.left = `${left - offsetX}px`;
        host.style.top = `${top - offsetY}px`;

        // The disclosed submenu is measured on its own — the audited bug was that
        // submenus always opened right and clipped at the edge.
        const sub = panel.querySelector<HTMLElement>(
            '.oj-menu-item[data-open="true"] > .oj-menu-item__submenu',
        );
        if (!sub) return;
        // Reset before measuring — a stale flip would measure itself into a corner.
        sub.style.left = '';
        sub.style.right = '';
        sub.style.top = '';
        sub.removeAttribute('data-flipped');

        if (sub.getBoundingClientRect().right > vw - VIEWPORT_PAD) {
            sub.style.left = 'auto';
            sub.style.right = '100%';
            sub.setAttribute('data-flipped', 'true');
        }
        const flipped = sub.getBoundingClientRect();
        const overflowBottom = flipped.bottom - (vh - VIEWPORT_PAD);
        if (overflowBottom > 0) {
            // Never push the panel's top above the viewport while fixing the bottom.
            const headroom = Math.max(0, flipped.top - VIEWPORT_PAD);
            sub.style.top = `${-Math.min(overflowBottom, headroom)}px`;
        }
    }, [categories, measureTick, openCategory, panelEl, position]);

    const handleSelect = useCallback(
        (action: Action) => {
            // MIDI special-case: open the device browser instead of adding directly.
            if (action.id === MIDI_ADD_ID && onOpenMIDIBrowser) {
                onOpenMIDIBrowser();
                onClose();
                return;
            }
            // Rebuild the ctx at select time (mutation discipline: re-read stores).
            const menuCtx = buildMenuCtx({ point: screenToCanvas(position) });
            action.run(menuCtx);
            // Defer the close a frame so React finishes the graph update first.
            requestAnimationFrame(() => onClose());
        },
        [onClose, onOpenMIDIBrowser, position, screenToCanvas],
    );

    /** Disclose a category and drop focus onto its first item. */
    const discloseCategory = useCallback(
        (name: string) => {
            typeaheadRef.current = { buffer: '', at: 0, scope: '' };
            setOpenCategory(name);
            // The submenu only becomes focusable once displayed — wait a frame.
            requestAnimationFrame(() => {
                panelEl()
                    ?.querySelector<HTMLElement>(
                        '.oj-menu-item[data-open="true"] .oj-menu-item__submenu .oj-menu-item',
                    )
                    ?.focus();
            });
        },
        [panelEl],
    );

    /**
     * Root-panel keys the oj-ui `Menu` does not own: Left/Right submenu
     * disclosure, Enter/Space on a category row, and typeahead. Runs BEFORE
     * `Menu`'s roving focus, which bails whenever we `preventDefault`.
     */
    const onRootKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.defaultPrevented) return; // already handled by an open submenu
        const active = document.activeElement as HTMLElement | null;
        const row = active?.closest<HTMLElement>('.oj-menu-item[data-category]') ?? null;
        const name = row?.dataset.category;
        const isRootRow = Boolean(row && row.parentElement === panelEl());

        if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && isRootRow && name) {
            e.preventDefault();
            discloseCategory(name);
            return;
        }
        if (e.key === 'ArrowLeft' && openCategory) {
            e.preventDefault();
            setOpenCategory(null);
            focusCategoryRow(openCategory);
            return;
        }
        // Typeahead — jump to the next root row whose label starts with what was
        // typed. One printable character at a time, buffered briefly.
        if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            focusTypeaheadMatch(e.key, rootRows(), active, 'root');
        }
    };

    /** Submenu keys stay scoped to their panel; Left returns to the category row. */
    const onSubmenuKeyDown = (name: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setOpenCategory(null);
            focusCategoryRow(name);
            return;
        }
        if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const active = document.activeElement as HTMLElement | null;
            const submenu = active?.closest<HTMLElement>('.context-menu-submenu');
            const rows = submenu
                ? Array.from(
                    submenu.querySelectorAll<HTMLElement>(
                        ':scope > .oj-menu-item:not([aria-disabled="true"])',
                    ),
                )
                : [];
            focusTypeaheadMatch(e.key, rows, active, `submenu:${name}`);
        }
    };

    // Portalled to the body: the menu is an overlay, and rendering it inside the
    // canvas put it inside a TRANSFORMED containing block, where `position:
    // fixed` no longer means "the viewport" — the clamp then missed by the
    // height of the shell chrome. React events still bubble through NodeCanvas's
    // tree, so its props and handlers are untouched.
    return createPortal(
        <div
            ref={hostRef}
            className="context-menu-host"
            style={{ left: position.x, top: position.y }}
        >
            <Menu ariaLabel="Add node menu" className="context-menu" onKeyDown={onRootKeyDown}>
                <MenuCategory label="Add node" onMouseEnter={() => setOpenCategory(null)} />

                {categories.map((category) => {
                    const isOpen = openCategory === category.name;
                    return (
                        <MenuItem
                            key={category.name}
                            label={category.name}
                            leadingIcon={CATEGORY_ICON[category.name]}
                            data-category={category.name}
                            data-open={isOpen ? 'true' : 'false'}
                            aria-expanded={isOpen}
                            // A tap/click always DISCLOSES (never toggles): the
                            // pointer has usually already opened the row via
                            // hover, so a toggle would shut the submenu the
                            // player just reached for. Closing is Escape,
                            // ArrowLeft, another category, or clicking away.
                            onClick={() => discloseCategory(category.name)}
                            onMouseEnter={() => setOpenCategory(category.name)}
                            submenu={
                                <Menu
                                    ariaLabel={category.name}
                                    className="context-menu-submenu"
                                    onKeyDown={onSubmenuKeyDown(category.name)}
                                >
                                    {category.items.map((action) => (
                                        <MenuItem
                                            key={action.id}
                                            label={action.title}
                                            onSelect={() => handleSelect(action)}
                                        />
                                    ))}
                                </Menu>
                            }
                        />
                    );
                })}

                <MenuSeparator />

                <MenuItem
                    label="Cancel"
                    onSelect={onClose}
                    onMouseEnter={() => setOpenCategory(null)}
                />
            </Menu>
        </div>,
        document.body,
    );
}
