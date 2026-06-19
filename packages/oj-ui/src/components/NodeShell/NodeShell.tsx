import type { HTMLAttributes, ReactNode } from 'react';
import './NodeShell.css';

export interface NodeShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Node title (Caveat voice). Overrides the DOM `title` (tooltip) attribute. */
    title: ReactNode;
    /** Muted type label shown in the header. */
    nodeType?: ReactNode;
    selected?: boolean;
    dragging?: boolean;
    /** The AI agent just added this node in a not-yet-undone run — shows the
     *  audio-blue live-build ring (a state pulse, stilled for reduced-motion). */
    agentPending?: boolean;
    /** Props for the draggable header strip (e.g. drag handlers, `cursor`). */
    headerProps?: HTMLAttributes<HTMLDivElement>;
    children: ReactNode;
}

/**
 * The signature node card: white surface, 2px ink border, 14px radius, hard
 * offset shadow, with a paper-panel header (title + muted type) and a content
 * area (DESIGN.md §5 The Node). Layout-agnostic — the canvas positions it; this
 * only owns the chrome. Theme-agnostic (semantic tokens only).
 */
export function NodeShell({
    title,
    nodeType,
    selected = false,
    dragging = false,
    agentPending = false,
    headerProps,
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
                <span className="oj-node__title">{title}</span>
                {nodeType != null && <span className="oj-node__type">{nodeType}</span>}
            </div>
            <div className="oj-node__content">{children}</div>
        </div>
    );
}
