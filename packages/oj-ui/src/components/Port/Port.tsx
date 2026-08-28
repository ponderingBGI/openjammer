import type { HTMLAttributes } from 'react';
import './Port.css';

export type PortKind = 'audio' | 'control' | 'universal';
export type PortDirection = 'input' | 'output';

export interface PortProps extends HTMLAttributes<HTMLSpanElement> {
    /** What travels the cable: `audio` (teal), `control` (grey), or `universal`
     *  (violet until typed). The type is the source of truth; the CORE color
     *  follows from it once something is plugged in (Port-Color-Is-Meaning). */
    kind: PortKind;
    /** Which side of the node body the socket's row sits on. Presentational —
     *  PortRow uses it to order [socket][label] vs [label][socket]. It no longer
     *  selects a color (New DNA D7 retired the directional port shades), but it
     *  stays on the API: the row layout needs it and Code Connect pins it. */
    direction?: PortDirection;
    /** Something is plugged in — the core takes the wiring color. */
    connected?: boolean;
    /** For a `universal` port: the kind it resolved to once connected, so the
     *  core takes that wiring color instead of the violet placeholder. */
    resolvedKind?: PortKind;
    /** An empty, dashed "add a port" slot — the well with no core. */
    placeholder?: boolean;
    /** This control port is firing right now (e.g. a held control key) — the
     *  core goes success-ink. A performance signal you read mid-set. */
    active?: boolean;
}

/**
 * A connection port — an 18px recessed socket well sunk into the node body,
 * with a core dot that is muted when idle and wiring-colored when live
 * (master-plan D7). Never glows, never scales under the pointer: hover paints a
 * 1px accent ring on the well so the target a performer is aiming at stays put.
 *
 * Theme-agnostic. Spreads `...rest`, so the `data-node-id` / `data-port-id` /
 * `data-port-type` attributes the canvas uses for connection lookup and
 * hit-testing forward as-is — that DOM contract is load-bearing; keep it.
 */
export function Port({
    kind,
    // Destructured, deliberately unread: `direction` is the ROW's business
    // (PortRow orders [socket][label] or [label][socket] from it) and it must
    // not reach the DOM, where `direction` is not a valid span attribute. D7
    // retired the directional port colours; the prop stays because the row
    // layout and the Figma Code Connect example both depend on it.
    direction: _direction,
    connected = false,
    resolvedKind,
    placeholder = false,
    active = false,
    className,
    ...rest
}: PortProps) {
    const colorKind = resolvedKind ?? kind;
    const classes = [
        'oj-port',
        `oj-port--${colorKind}`,
        connected && 'is-connected',
        placeholder && 'is-placeholder',
        active && 'is-active',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return <span className={classes} {...rest} />;
}
