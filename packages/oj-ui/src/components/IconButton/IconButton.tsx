import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from '../Button/Button';
import './IconButton.css';

export type IconButtonVariant = 'ghost' | 'node';

export interface IconButtonProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    /**
     * The glyph to render (an icon component or any node). Equivalent to
     * passing `children`; `icon` wins when both are given.
     */
    icon?: ReactNode;
    /**
     * Accessible name — REQUIRED. An icon-only control carries no text, so the
     * label is the only thing a screen reader has to go on; it becomes the
     * button's `aria-label`.
     */
    label: string;
    /**
     * Visual role. `ghost` (default) is the borderless toolbar/menu trigger;
     * `node` is the white-fill node button. Both read the theme's tokens.
     */
    variant?: IconButtonVariant;
    /** Toggled/armed state (e.g. an engaged toggle) — uses the success fill. */
    active?: boolean;
}

/**
 * A square, single-glyph button. Composes {@link Button} with `iconOnly`, so it
 * inherits the hand-drawn ink border, hard offset feel, and press physics
 * (DESIGN.md §5) and stays theme-agnostic. Replaces the legacy `.toolbar-btn-icon`
 * and every ✕/close icon trigger. The required `label` keeps the control named
 * for assistive tech even though it shows no text.
 */
export function IconButton({
    icon,
    label,
    variant = 'ghost',
    active = false,
    children,
    className,
    ...rest
}: IconButtonProps) {
    const classes = ['oj-icon-btn', className].filter(Boolean).join(' ');

    return (
        <Button
            iconOnly
            variant={variant}
            active={active}
            aria-label={label}
            className={classes}
            {...rest}
        >
            {icon ?? children}
        </Button>
    );
}
