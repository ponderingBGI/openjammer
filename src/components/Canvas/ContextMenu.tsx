/**
 * Context Menu (M4) — a FILTERED PROJECTION of the Action registry.
 *
 * ComfyUI-style right-click menu. As of M4 it no longer hardcodes a node list:
 * it reads the SAME {@link queryActions} registry the Ctrl+K palette reads,
 * filtered to `surface: 'menu'`. Adding an action with `surfaces: ['palette',
 * 'menu']` makes it appear here for free — the menu is a curated SUBSET of the
 * palette SUPERSET. AI-authored DSP nodes therefore show up automatically.
 *
 * The friendly NESTED-CATEGORY UX is preserved: items are grouped by
 * `action.path?.[0]` (falling back to `action.group`) into the existing
 * category → submenu structure with the SAME CSS classes, rendered in the
 * historical menu order (Input, Instruments, Routing, Effects, Utility, Output),
 * with any extra groups (e.g. 'AI DSP') appended after.
 *
 * The MIDI special-case is preserved: selecting the "Add Midi" action
 * (`node.add.midi`) opens the device browser via `onOpenMIDIBrowser` instead of
 * spawning a node directly.
 */

import { useEffect, useMemo, useRef } from 'react';
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

interface MenuCategory {
    name: string;
    items: Action[];
}

/** Group `actions` by menu category and order categories historically. */
function groupByCategory(actions: readonly Action[]): MenuCategory[] {
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

    const ordered: MenuCategory[] = [];
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
    const menuRef = useRef<HTMLDivElement>(null);
    const screenToCanvas = useCanvasStore((s) => s.screenToCanvas);

    // Build the menu context ONCE per open (the clicked canvas point). The
    // registry is the single source — group the projected actions into the
    // nested category UX. Recomputed when the open position changes.
    const categories = useMemo(() => {
        const menuCtx = buildMenuCtx({ point: screenToCanvas(position) });
        const items = queryActions(menuCtx, { surface: 'menu' });
        return groupByCategory(items);
    }, [position, screenToCanvas]);

    // Close on click outside / Escape.
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        }

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // Adjust position to keep menu in viewport.
    useEffect(() => {
        if (!menuRef.current) return;

        const menu = menuRef.current;
        const rect = menu.getBoundingClientRect();

        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }, [position]);

    const handleSelect = (action: Action) => {
        // MIDI special-case: open the device browser instead of adding directly.
        if (action.id === MIDI_ADD_ID && onOpenMIDIBrowser) {
            onOpenMIDIBrowser();
            onClose();
            return;
        }
        // Rebuild the ctx at select time (mutation discipline: re-read stores).
        const menuCtx = buildMenuCtx({ point: screenToCanvas(position) });
        action.run(menuCtx);
        // Use requestAnimationFrame to ensure menu closes after React finishes
        // updating. This prevents timing issues where state updates could
        // interfere with close.
        requestAnimationFrame(() => {
            onClose();
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
        }
    };

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{ left: position.x, top: position.y }}
            role="menu"
            aria-label="Add node menu"
        >
            <div className="context-menu-header" id="context-menu-title">Add Node</div>

            {categories.map((category) => (
                <div
                    key={category.name}
                    className="context-menu-category"
                    role="group"
                    aria-label={category.name}
                >
                    <div className="context-menu-category-header">
                        <span>
                            {CATEGORY_ICON[category.name] && (
                                <span className="context-menu-category-icon" aria-hidden="true">
                                    {CATEGORY_ICON[category.name]}
                                </span>
                            )}
                            {category.name}
                        </span>
                        <span className="context-menu-category-arrow" aria-hidden="true">▶</span>
                    </div>

                    <div className="context-menu-submenu" role="group">
                        {category.items.map((action) => (
                            <div
                                key={action.id}
                                className="context-menu-item"
                                role="menuitem"
                                tabIndex={0}
                                onClick={() => handleSelect(action)}
                                onKeyDown={(e) => handleKeyDown(e, () => handleSelect(action))}
                            >
                                {action.title}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            <div className="context-menu-separator" role="separator" />

            <div
                className="context-menu-item"
                role="menuitem"
                tabIndex={0}
                onClick={onClose}
                onKeyDown={(e) => handleKeyDown(e, onClose)}
            >
                Cancel
            </div>
        </div>
    );
}
