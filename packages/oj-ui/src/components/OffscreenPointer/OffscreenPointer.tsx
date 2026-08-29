import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import './OffscreenPointer.css';

export interface OffscreenPointerProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
    /**
     * Heading of the arrow glyph, in degrees. `0` points right; the value is
     * fed to a CSS custom property and rotates only the arrow, never the box,
     * so the affordance stays put while it tells the player which way to jump.
     */
    rotation: number;
    /** Caption naming where the jump leads. */
    label: ReactNode;
    /** Invoked when the player jumps back toward the offscreen content. */
    onClick: () => void;
}

/**
 * OffscreenPointer — a floating "jump back" affordance that points offscreen
 * when the action has scrolled out of view. The arrow consumes a rotation value
 * without animating direction; the surface pill keeps a stable hit target.
 */
export function OffscreenPointer({
    rotation,
    label,
    onClick,
    className,
    type = 'button',
    style,
    ...rest
}: OffscreenPointerProps) {
    const classes = ['oj-offscreen-pointer', className].filter(Boolean).join(' ');

    return (
        <button
            type={type}
            className={classes}
            onClick={onClick}
            style={{ '--oj-pointer-rotation': `${rotation}deg`, ...style } as CSSProperties}
            {...rest}
        >
            <span className="oj-offscreen-pointer__arrow" aria-hidden="true">
                →
            </span>
            <span className="oj-offscreen-pointer__label">{label}</span>
        </button>
    );
}
