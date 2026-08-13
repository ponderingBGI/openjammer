import type { HTMLAttributes, ReactNode } from 'react';
import './NodeFrame.css';

export interface NodeFramePosition {
    x: number;
    y: number;
}

export interface NodeFrameProps extends HTMLAttributes<HTMLDivElement> {
    /** Canvas position in CSS px, applied as a `translate` transform. */
    position: NodeFramePosition;
    /**
     * The node is mid-drag — switches the cursor to `grabbing`. Visual node
     * state (selected / agentPending) is the child NodeShell's job; this frame
     * only positions and signals the grab.
     */
    dragging?: boolean;
    /** The node card (typically a NodeShell). */
    children: ReactNode;
}

/**
 * The absolute-positioned canvas slot that places a node at `{x, y}`. Distinct
 * from NodeShell, which owns the card chrome — NodeFrame owns *where* the node
 * sits and the grab affordance. Replaces NodeWrapper's `.node` outer container.
 *
 * Theme-agnostic: positioning uses a `translate` transform and the `--z-node`
 * layer token, never literal coordinates baked into styles. Forwards `...rest`
 * (e.g. `onPointerDown` for drag-start, `onClick`, `data-*`) to the div.
 */
export function NodeFrame({
    position,
    dragging = false,
    className,
    style,
    children,
    ...rest
}: NodeFrameProps) {
    const classes = ['oj-node-frame', dragging && 'is-dragging', className]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            style={{
                transform: `translate(${position.x}px, ${position.y}px)`,
                ...style,
            }}
            {...rest}
        >
            {children}
        </div>
    );
}
