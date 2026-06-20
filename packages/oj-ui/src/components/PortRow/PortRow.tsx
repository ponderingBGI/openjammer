import type { HTMLAttributes, ReactNode } from 'react';
import { Port, type PortKind, type PortDirection } from '../Port/Port';
import './PortRow.css';

export interface PortRowProps
    extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** The port's name shown beside the dot (Caveat voice). */
    label: ReactNode;
    /** `input` lays out [Port][label]; `output` lays out [label][Port]. */
    side: PortDirection;
    /** What travels the cable — sets the Port's wiring color. */
    kind: PortKind;
    /** Live connection — brightens the dot and gives it the one allowed glow. */
    connected?: boolean;
    /** For a `universal` port: the kind it resolved to once connected. */
    resolvedKind?: PortKind;
    /** A faint, dashed "add a port" slot. */
    placeholder?: boolean;
    /** Hide the text label but keep it in the DOM for assistive tech (aria). */
    hideLabel?: boolean;
    /** Slot replacing the static label — e.g. an inline-editing field. When
     *  present it renders instead of `label` (which still names the row). */
    editableLabel?: ReactNode;
}

/**
 * A labeled port row for node bodies (DESIGN.md §5 Ports). Composes Port and
 * sits it beside its name: `input` rows read [dot][label] left-to-right,
 * `output` rows read [label][dot] right-aligned (row-reverse) so the dot always
 * hugs the node edge it wires to. The `...rest` — including the canvas's
 * `data-node-id` / `data-port-id` / `data-port-type` and pointer handlers —
 * forwards to the Port, since that DOM is the connection target, not the row.
 * Theme-agnostic (semantic tokens only).
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
