import type { HTMLAttributes } from 'react';
import './StatusDot.css';

export type StatusDotStatus = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
    /**
     * The condition the dot reports: `ok` (success), `warn` (warning), `bad`
     * (danger), `idle` (muted/inactive), or `info` (the audio-connection blue).
     * Each maps to a semantic token, never a literal color. Per the
     * Signal-Not-Brand Rule a state color must always carry a label, so always
     * pair this dot with adjacent text — it is a signal, not a standalone glyph.
     */
    status: StatusDotStatus;
}

/**
 * A small status indicator dot — an ~8px ink-bordered circle filled by the
 * token for its status. Theme-agnostic: styled entirely via semantic CSS
 * variables, so it follows the active theme. No pulse or animation
 * (No-Surprise Rule); the color alone is the signal. Always pair with a label.
 * Replaces `.ah-dot`, the device-connected dot, and the devlog level dot.
 */
export function StatusDot({ status, className, ...rest }: StatusDotProps) {
    const classes = ['oj-status-dot', `oj-status-dot--${status}`, className]
        .filter(Boolean)
        .join(' ');

    return <span className={classes} data-status={status} {...rest} />;
}
