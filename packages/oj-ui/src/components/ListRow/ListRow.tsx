import type { HTMLAttributes, ReactNode } from 'react';
import './ListRow.css';

export interface ListProps extends HTMLAttributes<HTMLDivElement> {
    /** Accessible name for the list when it has no visible label. */
    'aria-label'?: string;
    /** ARIA role for the container (e.g. `listbox`, `menu`); defaults to `list`. */
    role?: string;
    children: ReactNode;
}

/**
 * A flex-column scroll container for a stack of {@link ListRow}s — the command
 * palette result list, the /resume session picker, the looper's loop list, the
 * model picker. Layout-only chrome: it owns the column rhythm and the scroll, and
 * leaves every row to own its own state. Theme-agnostic (semantic tokens only).
 */
export function List({ role = 'list', className, children, ...rest }: ListProps) {
    const classes = ['oj-list', className].filter(Boolean).join(' ');
    return (
        <div role={role} className={classes} {...rest}>
            {children}
        </div>
    );
}

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
    /** Chosen/active in a multi-pick sense — draws the accent ring + faint fill. */
    selected?: boolean;
    /** The row that is live now; shown with a compact dot before its label. */
    current?: boolean;
    /** Dims and blocks pointer interaction; sets `aria-disabled` for assistive tech. */
    disabled?: boolean;
    /** Trailing slot (controls, meta badges) pinned to the row's end. */
    actions?: ReactNode;
    children: ReactNode;
}

/**
 * One row in a {@link List}. Owns the single selected / hover / current ruleset
 * shared by every list surface (DESIGN.md §4 No-Surprise: feedback is color and
 * border only). Hover fills with `--bg-tertiary`; `selected` adds an accent
 * outline on keyboard focus; `current` adds a six-pixel dot before the label.
 */
export function ListRow({
    selected = false,
    current = false,
    disabled = false,
    actions,
    className,
    children,
    ...rest
}: ListRowProps) {
    const classes = [
        'oj-list-row',
        selected && 'is-selected',
        current && 'is-current',
        disabled && 'is-disabled',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            aria-disabled={disabled || undefined}
            aria-selected={selected || undefined}
            aria-current={current || undefined}
            {...rest}
        >
            <span className="oj-list-row__body">{children}</span>
            {actions != null && <span className="oj-list-row__actions">{actions}</span>}
        </div>
    );
}
