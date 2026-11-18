import type { HTMLAttributes, ReactNode } from 'react';
import './NodeShell.css';

export interface NodeShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Node title — 15px/600 Outfit in the header. Overrides the DOM `title`
     *  (tooltip) attribute. */
    title: ReactNode;
    /** Type label, rendered as a mono chip on the header's right. */
    nodeType?: ReactNode;
    selected?: boolean;
    dragging?: boolean;
    /** The AI agent just added this node in a not-yet-undone run — shows the
     *  violet live-build hairline (a state pulse, stilled for reduced-motion). */
    agentPending?: boolean;
    /** Show the 2×2 grip dots that mark the header as the drag handle. */
    grip?: boolean;
    /** Props for the draggable header strip (e.g. drag handlers, `cursor`). */
    headerProps?: HTMLAttributes<HTMLDivElement>;
    headerAction?: ReactNode;
    /** Input sockets — compose `PortRow side="input"`. Rendered as the left
     *  group of the port row that opens the node body. */
    inputs?: ReactNode;
    /** Output sockets — compose `PortRow side="output"`. Right group. */
    outputs?: ReactNode;
    children: ReactNode;
}

/** An empty array is still "no ports" — without this the body opens with a
 *  blank 24px row and a gap on every node that has none. */
function hasPorts(slot: ReactNode): boolean {
    return slot != null && !(Array.isArray(slot) && slot.length === 0);
}

/**
 * The signature node card (master-plan D7): a surface card with a 1px hairline,
 * 14px radius and the soft overlay shadow; a header carrying the grip dots, the
 * title and a mono type chip; and a body whose FIRST ROW is the ports — inputs
 * grouped left, outputs grouped right, both inside the body padding so every
 * socket is a well sunk into the card rather than a dot stuck on its edge.
 * Cables run under the card (the canvas keeps the connection layer below the
 * node layer) and terminate in the well, which is the whole "plugged in" read.
 *
 * Layout-agnostic — the canvas positions it (compose with NodeFrame); this owns
 * the chrome. Theme-agnostic (semantic tokens only).
 */
export function NodeShell({
    title,
    nodeType,
    selected = false,
    dragging = false,
    agentPending = false,
    grip = true,
    headerProps,
    headerAction,
    inputs,
    outputs,
    className,
    children,
    ...rest
}: NodeShellProps) {
    const classes = [
        'oj-node',
        selected && 'is-selected',
        dragging && 'is-dragging',
        agentPending && 'is-agent-pending',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <div className={classes} {...rest}>
            <div className="oj-node__header" {...headerProps}>
                {grip && (
                    <span className="oj-node__grip" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <i />
                    </span>
                )}
                <span className="oj-node__title">{title}</span>
                {nodeType != null && <span className="oj-node__type">{nodeType}</span>}
                {headerAction}
            </div>
            <div className="oj-node__content">
                {(hasPorts(inputs) || hasPorts(outputs)) && (
                    <div className="oj-node__ports">
                        <div className="oj-node__ports-in">{inputs}</div>
                        <div className="oj-node__ports-out">{outputs}</div>
                    </div>
                )}
                {children}
            </div>
        </div>
    );
}
