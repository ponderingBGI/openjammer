import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Surface } from '../Surface/Surface';
import { Kbd } from '../Kbd/Kbd';
import { IconChevronRight } from '../Icons/Icons';
import './Menu.css';

/**
 * Selector for the items the roving keyboard focus can land on — direct rows
 * only (a nested submenu's items are scoped away so arrows walk one level).
 */
const ENABLED_ITEM = ':scope > .oj-menu-item:not([aria-disabled="true"])';

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-label'> {
    /**
     * Accessible name for the menu (`aria-label` on the `role="menu"` panel).
     * A menu is always labelled — it is the curated set of actions, not chrome.
     */
    ariaLabel: string;
    /**
     * Fired when the player presses Escape inside the open panel. Open/close and
     * anchor positioning stay with the consumer; the Menu only signals intent so
     * the owner can tear down its own open state (and restore trigger focus).
     */
    onEscape?: () => void;
    /** The rows — `MenuItem`, `MenuCategory`, `MenuSeparator`. */
    children: ReactNode;
}

/** Move focus to a list entry, wrapping at either end. */
function focusAt(list: HTMLElement[], index: number) {
    if (list.length === 0) return;
    list[(index + list.length) % list.length]?.focus();
}

/**
 * A keyboard-navigable menu panel — the consolidation of the toolbar dropdown
 * and the canvas context-menu engines into one theme-agnostic shape. Renders a
 * `Surface`-backed `role="menu"` container and owns only the *internal* roving
 * focus (ArrowUp/Down across enabled items, Home/End to the ends) plus Escape.
 *
 * Pure presentation: the OPEN/CLOSE decision and anchor positioning stay with
 * the consumer (it renders `<Menu>` only while open, wherever it wants). The
 * Menu just renders the open panel and moves focus within it. Theme-agnostic —
 * styled entirely via semantic tokens, so it follows the active theme.
 */
export function Menu({ ariaLabel, onEscape, className, children, onKeyDown, ...rest }: MenuProps) {
    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;

        // Walk only this panel's own rows (the event's currentTarget), so a
        // submenu manages its own level — no ref needed, keeping Menu pure.
        const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ENABLED_ITEM));
        const current = list.indexOf(document.activeElement as HTMLElement);

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                onEscape?.();
                break;
            case 'ArrowDown':
                e.preventDefault();
                focusAt(list, current < 0 ? 0 : current + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                focusAt(list, current < 0 ? list.length - 1 : current - 1);
                break;
            case 'Home':
                e.preventDefault();
                focusAt(list, 0);
                break;
            case 'End':
                e.preventDefault();
                focusAt(list, list.length - 1);
                break;
            default:
                break;
        }
    };

    const classes = ['oj-menu', className].filter(Boolean).join(' ');

    return (
        <Surface
            elevation="menu"
            radius="md"
            className={classes}
            role="menu"
            aria-label={ariaLabel}
            onKeyDown={handleKeyDown}
            {...rest}
        >
            {children}
        </Surface>
    );
}

export interface MenuItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
    /** The row's primary content — the Caveat-voiced action label. */
    label: ReactNode;
    /** Optional shortcut hint, rendered as a `Kbd` keycap (Mono-Means-Exact). */
    shortcut?: string;
    /** Optional glyph before the label — a decorative leading icon. */
    leadingIcon?: ReactNode;
    /** Dimmed and non-actionable (`aria-disabled`); skipped by arrow nav. */
    disabled?: boolean;
    /**
     * A nested `Menu` (or items) revealed on hover/focus. When present the row
     * shows a trailing chevron and never fires `onSelect` itself.
     */
    submenu?: ReactNode;
    /** Fired on click / Enter / Space when the row is enabled and leaf. */
    onSelect?: () => void;
}

/**
 * A single actionable menu row (`role="menuitem"`). Hover/focus fills with the
 * accent and flips text to `--text-on-accent` (the per-theme token for text on
 * a fill — never a literal white). A `submenu` turns the row into a disclosure
 * with a trailing chevron; a `shortcut` renders as a mono `Kbd` keycap.
 */
export function MenuItem({
    label,
    shortcut,
    leadingIcon,
    disabled = false,
    submenu,
    onSelect,
    className,
    onClick,
    onKeyDown,
    ...rest
}: MenuItemProps) {
    const hasSubmenu = submenu != null;

    const activate = () => {
        if (disabled || hasSubmenu) return;
        onSelect?.();
    };

    const classes = [
        'oj-menu-item',
        hasSubmenu && 'oj-menu-item--has-submenu',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            role="menuitem"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            aria-haspopup={hasSubmenu || undefined}
            onClick={(e) => {
                onClick?.(e);
                if (e.defaultPrevented) return;
                activate();
            }}
            onKeyDown={(e) => {
                onKeyDown?.(e);
                if (e.defaultPrevented) return;
                if (!hasSubmenu && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    activate();
                }
            }}
            {...rest}
        >
            {leadingIcon != null && (
                <span className="oj-menu-item__icon" aria-hidden="true">
                    {leadingIcon}
                </span>
            )}
            <span className="oj-menu-item__label">{label}</span>
            {shortcut && <Kbd className="oj-menu-item__shortcut">{shortcut}</Kbd>}
            {hasSubmenu && (
                <span className="oj-menu-item__chevron" aria-hidden="true">
                    <IconChevronRight size={14} />
                </span>
            )}
            {hasSubmenu && <div className="oj-menu-item__submenu">{submenu}</div>}
        </div>
    );
}

export interface MenuCategoryProps extends HTMLAttributes<HTMLDivElement> {
    /** The group title — a muted, non-interactive section header. */
    label: ReactNode;
    /** Optional decorative glyph before the label. */
    icon?: ReactNode;
}

/**
 * A non-interactive group header inside a menu (`role="presentation"`). Muted
 * label in the work face so it reads as structure, not an action — it is never
 * focusable and never fires a select.
 */
export function MenuCategory({ label, icon, className, ...rest }: MenuCategoryProps) {
    const classes = ['oj-menu-category', className].filter(Boolean).join(' ');

    return (
        <div className={classes} role="presentation" {...rest}>
            {icon != null && (
                <span className="oj-menu-category__icon" aria-hidden="true">
                    {icon}
                </span>
            )}
            <span className="oj-menu-category__label">{label}</span>
        </div>
    );
}

export type MenuSeparatorProps = HTMLAttributes<HTMLDivElement>;

/** A hairline rule between menu groups (`role="separator"`). */
export function MenuSeparator({ className, ...rest }: MenuSeparatorProps) {
    const classes = ['oj-menu-separator', className].filter(Boolean).join(' ');

    return <div className={classes} role="separator" {...rest} />;
}
