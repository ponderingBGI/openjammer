import type { HTMLAttributes, ReactNode } from 'react';
import './Chip.css';

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
    /**
     * Semantic tone. `neutral` (default) is the quiet sand pill; `success`,
     * `warning` and `danger` tint the border and text via the state accent
     * tokens. Per Signal-Not-Brand, a toned chip always carries its label or
     * glyph — the color reports state, it is never the chip's whole meaning.
     */
    tone?: ChipTone;
    /** Leading glyph/icon, read before the words (e.g. a status dot or tool mark). */
    glyph?: ReactNode;
    /** Trailing exact count, set in mono (Mono-Means-Exact) — e.g. a tag tally. */
    count?: number;
    /** Toggled state for a filter chip — fills with the tertiary surface. */
    pressed?: boolean;
    /** The chip's label. */
    children?: ReactNode;
}

/**
 * A small pill/badge. Rounded ink-light border, Caveat voice, compact. Used for
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
            {glyph != null && (
                <span className="oj-chip__glyph" aria-hidden="true">
                    {glyph}
                </span>
            )}
            {children != null && <span className="oj-chip__label">{children}</span>}
            {count != null && <span className="oj-chip__count">{count}</span>}
        </span>
    );
}
