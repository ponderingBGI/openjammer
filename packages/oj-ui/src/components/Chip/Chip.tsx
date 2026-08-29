import { isValidElement } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { StatusDot } from '../StatusDot/StatusDot';
import './Chip.css';

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
    /**
     * Semantic tone. `neutral` (default) is the quiet inset pill; `success`,
     * `warning` and `danger` tint text only via contrast-safe ink tokens.
     */
    tone?: ChipTone;
    /**
     * Leading non-dot glyph/icon. @deprecated for status dots: dot strings and
     * `StatusDot` elements remain accepted but intentionally render nothing.
     */
    glyph?: ReactNode;
    /** Trailing exact count, set in mono (Mono-Means-Exact) — e.g. a tag tally. */
    count?: number;
    /** Toggled state for a filter chip — lifts onto the node surface. */
    pressed?: boolean;
    /** The chip's label. */
    children?: ReactNode;
}

/**
 * A small Outfit pill/badge with an inset neutral construction. Used for
 * status markers, tags, and toggleable filter chips. Theme-agnostic: styled
 * entirely via semantic CSS variables, so it follows the active theme.
 */
export function Chip({
    tone = 'neutral',
    glyph,
    count,
    pressed = false,
    className,
    children,
    ...rest
}: ChipProps) {
    const isDotString = typeof glyph === 'string' && /^[●•·∙◉○]$/.test(glyph.trim());
    const isStatusDot = isValidElement(glyph) && glyph.type === StatusDot;
    const visibleGlyph = isDotString || isStatusDot ? null : glyph;
    const classes = [
        'oj-chip',
        tone !== 'neutral' && `oj-chip--${tone}`,
        pressed && 'is-pressed',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes} {...rest}>
            {visibleGlyph != null && (
                <span className="oj-chip__glyph" aria-hidden="true">
                    {visibleGlyph}
                </span>
            )}
            {children != null && <span className="oj-chip__label">{children}</span>}
            {count != null && <span className="oj-chip__count">{count}</span>}
        </span>
    );
}
