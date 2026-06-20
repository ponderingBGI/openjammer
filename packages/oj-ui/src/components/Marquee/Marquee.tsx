import type { HTMLAttributes } from 'react';
import './Marquee.css';

export interface MarqueeProps extends HTMLAttributes<HTMLDivElement> {
    /** Left edge of the selection rectangle, in canvas pixels. */
    x: number;
    /** Top edge of the selection rectangle, in canvas pixels. */
    y: number;
    /** Width of the selection rectangle, in canvas pixels. */
    width: number;
    /** Height of the selection rectangle, in canvas pixels. */
    height: number;
}

/**
 * The drag-to-select rectangle overlay. A dashed accent border with a faint
 * accent fill, absolutely positioned and non-interactive (`pointer-events:
 * none`) so it never steals a drag from the canvas underneath. Theme-agnostic:
 * styled entirely via semantic CSS variables. Replaces `.selection-box`.
 */
export function Marquee({ x, y, width, height, className, style, ...rest }: MarqueeProps) {
    const classes = ['oj-marquee', className].filter(Boolean).join(' ');

    return (
        <div
            className={classes}
            style={{ left: x, top: y, width, height, ...style }}
            {...rest}
        />
    );
}
