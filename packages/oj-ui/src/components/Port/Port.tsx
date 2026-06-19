import type { HTMLAttributes } from 'react';
import './Port.css';

export type PortKind = 'audio' | 'control' | 'universal';
export type PortDirection = 'input' | 'output';

export interface PortProps extends HTMLAttributes<HTMLSpanElement> {
    /** What travels the cable: `audio` (blue), `control` (grey), or `universal`
     *  (violet until typed). The type is the source of truth; the color follows
     *  from it (Port-Color-Is-Meaning). */
    kind: PortKind;
    /** Input vs output — selects the in/out shade of the kind's color. */
    direction?: PortDirection;
    /** Live connection: brightens and gains the one allowed soft glow. */
    connected?: boolean;
    /** For a `universal` port: the kind it resolved to once connected, so it
     *  takes that wiring color instead of the violet placeholder. */
    resolvedKind?: PortKind;
    /** A faint, dashed "add a port" slot. */
    placeholder?: boolean;
}

/**
 * A connection port — 16px circle, 2px ink border, filled by wiring color.
 * Audio is blue, control is grey, universal is violet (DESIGN.md §5 Ports).
 * Theme-agnostic. Spreads `...rest`, so the `data-node-id` / `data-port-id` /
 * `data-port-type` attributes the canvas uses for connection lookup forward
 * as-is — that DOM contract is load-bearing; keep it.
 */
export function Port({
    kind,
    direction,
    connected = false,
    resolvedKind,
    placeholder = false,
    className,
    ...rest
}: PortProps) {
    const colorKind = resolvedKind ?? kind;
    const classes = [
        'oj-port',
        colorKind === 'universal'
            ? 'oj-port--universal'
            : direction && `oj-port--${colorKind}-${direction}`,
        connected && 'is-connected',
        placeholder && 'is-placeholder',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return <span className={classes} {...rest} />;
}
