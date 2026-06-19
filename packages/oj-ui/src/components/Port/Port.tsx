import type { HTMLAttributes } from 'react';
import './Port.css';

export type PortKind = 'audio' | 'control';
export type PortDirection = 'input' | 'output';

export interface PortProps extends HTMLAttributes<HTMLSpanElement> {
    /** What travels the cable: `audio` (blue) or `control` (grey). The type is
     *  the source of truth; the color follows from it (Port-Color-Is-Meaning). */
    kind: PortKind;
    /** Input vs output — selects the in/out shade of the kind's color. */
    direction?: PortDirection;
    /** Live connection: brightens and gains the one allowed soft glow. */
    connected?: boolean;
}

/**
 * A connection port — 16px circle, 2px ink border, filled by wiring color.
 * Audio is blue, control is grey (DESIGN.md §5 Ports). Theme-agnostic.
 */
export function Port({ kind, direction, connected = false, className, ...rest }: PortProps) {
    const classes = [
        'oj-port',
        direction && `oj-port--${kind}-${direction}`,
        connected && 'is-connected',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return <span className={classes} {...rest} />;
}
