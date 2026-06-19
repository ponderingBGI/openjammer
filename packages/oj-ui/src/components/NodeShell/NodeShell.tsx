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
    /** Left-rail input ports — compose `PortRow side="input"`. Edge-anchored,
     *  rendered full-bleed (outside the content padding) so dots hug the card edge. */
    inputs?: ReactNode;
    /** Right-rail output ports — compose `PortRow side="output"`. Edge-anchored. */
    outputs?: ReactNode;
    children: ReactNode;
}

/**
 * The signature node card: white surface, 2px ink border, 14px radius, hard
 * offset shadow, a paper-panel header (title + muted type), the left/right port
 * rails hugging the edges, and a padded content area (DESIGN.md §5 The Node).
 * Layout-agnostic — the canvas positions it (compose with NodeFrame); this owns
 * the chrome. Theme-agnostic (semantic tokens only).
 */
export function NodeShell({
    title,
    nodeType,
    selected = false,
    dragging = false,
    agentPending = false,
    headerProps,
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
                <span className="oj-node__title">{title}</span>
                {nodeType != null && <span className="oj-node__type">{nodeType}</span>}
            </div>
            {(inputs != null || outputs != null) && (
                <div className="oj-node__ports">
                    <div className="oj-node__ports-left">{inputs}</div>
                    <div className="oj-node__ports-right">{outputs}</div>
                </div>
            )}
            <div className="oj-node__content">{children}</div>
        </div>
    );
}
