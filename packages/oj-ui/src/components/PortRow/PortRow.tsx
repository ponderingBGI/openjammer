import type { HTMLAttributes, ReactNode } from 'react';
import { Port, type PortKind, type PortDirection } from '../Port/Port';
import './PortRow.css';

export interface PortRowProps
    extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** The port's name shown beside the socket — rendered in the 9.5px mono
     *  micro-voice, uppercased by CSS. */
    label: ReactNode;
    /** `input` lays out [socket][label]; `output` lays out [label][socket]. */
    side: PortDirection;
    /** What travels the cable — sets the socket core's wiring color once live. */
    kind: PortKind;
    /** Live connection — fills the socket core with the wiring color. */
    connected?: boolean;
    /** For a `universal` port: the kind it resolved to once connected. */
    resolvedKind?: PortKind;
    /** An empty, dashed "add a port" slot. */
    placeholder?: boolean;
    /** Hide the text label but keep it in the DOM for assistive tech (aria). */
    hideLabel?: boolean;
    /** Slot replacing the static label — e.g. an inline-editing field. When
     *  present it renders instead of `label` (which still names the row). */
    editableLabel?: ReactNode;
}

/**
 * A labeled port row — the atom a node body's port block is built from
 * (master-plan D7). Composes Port and sits it beside its name: `input` rows read
 * [socket][label] left-to-right, `output` rows read [label][socket] right-aligned
 * (row-reverse), so the two groups mirror across the body and every socket faces
 * the side its cable arrives from. The row is 24px tall minimum — the socket is
 * 18px, but the target has to be bigger than the drawing.
 *
 * The `...rest` — including the canvas's `data-node-id` / `data-port-id` /
 * `data-port-type` and pointer handlers — forwards to the Port, since that DOM
 * is the connection target, not the row. Theme-agnostic (semantic tokens only).
 */
export function PortRow({
    label,
    side,
    kind,
    connected = false,
    resolvedKind,
    placeholder = false,
    hideLabel = false,
    editableLabel,
    className,
    ...rest
}: PortRowProps) {
    const classes = [
        'oj-port-row',
        `oj-port-row--${side}`,
        connected && 'is-connected',
        placeholder && 'is-placeholder',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes}>
            <Port
                kind={kind}
                direction={side}
                connected={connected}
                placeholder={placeholder}
                // The row already knows what this socket is CALLED; the socket
                // needs it to say its own name (U8). Only a plain string can be
                // spoken — a node that renders a widget as its label keeps the
                // type+direction name Port derives on its own.
                {...(typeof label === 'string' ? { name: label } : {})}
                {...(resolvedKind ? { resolvedKind } : {})}
                {...rest}
            />
            {editableLabel != null ? (
                <span className="oj-port-row__label">{editableLabel}</span>
            ) : (
                <span
                    className={[
                        'oj-port-row__label',
                        hideLabel && 'oj-port-row__label--hidden',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
                    {label}
                </span>
            )}
        </span>
    );
}
