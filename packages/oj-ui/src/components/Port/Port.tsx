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
    /**
     * The port's own name, as printed beside it ("Level", "In 1", "Audio out").
     * Used only to build the default accessible name — `PortRow` forwards its
     * `label` here so every socket on the canvas says WHICH socket it is, not
     * merely what type it carries. Never rendered: the row draws the text.
     */
    name?: string;
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
    // `direction` never reaches the DOM (`direction` is not a valid span
    // attribute) and it no longer selects a colour — D7 retired the directional
    // port shades. It stays on the API because the ROW's layout reads it, the
    // Figma Code Connect example pins it, and, since U8, it is half of the
    // socket's spoken name: "Audio out" is a different socket from "Audio in".
    direction,
    connected = false,
    resolvedKind,
    placeholder = false,
    active = false,
    name,
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
    const described = describePort(kind, direction, name, placeholder);
    /*
     * A socket is a CONTROL, and until U8 it did not say so: 42 of 42 ports
     * measured on the canvas carried no role, no name and no title, so the app's
     * single most-repeated verb was invisible to assistive tech and had no hover
     * affordance at all (HEURISTIC-AUDIT HA-02). `role="button"` is the honest
     * shape — one press starts a cable, a second press lands it — and the label
     * names the type, the direction and the socket, in that order, because that
     * is the order the eye reads the legend.
     *
     * `rest` is spread AFTER, so a caller that knows better (a gated port
     * explaining why it is inert) still wins. `tabIndex` is deliberately absent:
     * the canvas owns ONE roving tab stop per node, and putting every socket in
     * the tab order is the 128-stop failure the piano roll already learned from.
     */
    return (
        <span
            role="button"
            aria-label={described}
            title={described}
            className={classes}
            {...rest}
        />
    );
}

/** Human words for a socket: what it carries, which way it faces, what it is
 *  called, and what to do with it. One sentence, spoken and hovered alike. */
function describePort(
    kind: PortKind,
    direction: PortDirection | undefined,
    name: string | undefined,
    placeholder: boolean,
): string {
    const carries = kind === 'audio' ? 'Audio' : kind === 'universal' ? 'Universal' : 'Control';
    const facing = direction === 'output' ? ' out' : direction === 'input' ? ' in' : '';
    // "Audio out — Audio out" helps nobody: drop a name that only repeats the
    // two words already said. Anything else ("Level", "In 2") earns its place.
    const bare = (name ?? '').trim();
    const redundant = !bare || /^(in|out|input|output|audio in|audio out|in \d+|out \d+)$/i.test(bare);
    const named = redundant ? '' : ` — ${bare}`;
    if (placeholder) return `${carries}${facing}${named} — empty slot, drop a cable here to add a port`;
    return `${carries}${facing}${named} — drag to connect, or press Enter`;
}
