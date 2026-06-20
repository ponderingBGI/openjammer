import type { HTMLAttributes } from 'react';
import './Spinner.css';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
    /**
     * Diameter of the ring in pixels (default 16). Drives both the box size
     * and the border thickness so the spinner stays proportional at any size.
     */
    size?: number;
}

/**
 * An indeterminate loading spinner — a rotating ring drawn from a circle's
 * border with one arc tinted `--accent-primary` (DESIGN.md Signal-Not-Brand:
 * a transient progress signal, never a decorative surface). The motion is the
 * only feedback, so it respects `prefers-reduced-motion` and falls still there.
 * Theme-agnostic: styled entirely via semantic tokens, no literal colors.
 */
export function Spinner({ size = 16, className, style, ...rest }: SpinnerProps) {
    const classes = ['oj-spinner', className].filter(Boolean).join(' ');

    return (
        <span
            role="status"
            aria-label="Loading"
            className={classes}
            style={{ width: size, height: size, ...style }}
            {...rest}
        />
    );
}
