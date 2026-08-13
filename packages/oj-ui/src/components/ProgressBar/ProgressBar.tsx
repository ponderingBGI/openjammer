import type { HTMLAttributes } from 'react';
import './ProgressBar.css';

export type ProgressBarTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
    /** Current progress, clamped to `[0, max]`. */
    value: number;
    /** Upper bound of `value`. Defaults to `1` (a 0..1 fraction). */
    max?: number;
    /**
     * Fill color role. `neutral` (default) uses the accent; `success`/`warning`/
     * `danger` carry machine state. The fill is a SOLID token, never a gradient
     * (Signal-Not-Brand): the bar is a signal, not a brand flourish.
     */
    tone?: ProgressBarTone;
    /** Accessible name for the bar (no visible label of its own). */
    'aria-label'?: string;
}

/**
 * A determinate progress bar. Track is `--bg-tertiary` hairlined with
 * `--sketch-light`; the fill is a solid tone token at `--radius-sm`. Renders as
 * a `role=progressbar` with `aria-valuenow/min/max`, and reads the theme's
 * semantic tokens only — no literal colors, no gradient, no blur.
 */
export function ProgressBar({
    value,
    max = 1,
    tone = 'neutral',
    className,
    style,
    ...rest
}: ProgressBarProps) {
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.min(Math.max(value, 0), safeMax);
    const fraction = clamped / safeMax;

    const classes = [
        'oj-progress',
        tone !== 'neutral' && `oj-progress--${tone}`,
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            role="progressbar"
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={safeMax}
            style={style}
            {...rest}
        >
            <div
                className="oj-progress__fill"
                style={{ width: `${fraction * 100}%` }}
            />
        </div>
    );
}
