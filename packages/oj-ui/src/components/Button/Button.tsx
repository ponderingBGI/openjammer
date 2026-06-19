import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

export type ButtonVariant = 'node' | 'primary' | 'secondary' | 'success' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Visual role. `node` (default) is the white-fill node button; `primary`
     * is the accent-filled call to action; `success`/`danger` are the semantic
     * state fills. All read the theme's semantic tokens, never literal colors.
     */
    variant?: ButtonVariant;
    /** Toggled/armed state (e.g. an engaged record button) — uses the success fill. */
    active?: boolean;
}

/**
 * The OpenJammer button. Hand-drawn ink border, hard offset feel, lifts on
 * hover and presses on click (DESIGN.md §5). Theme-agnostic: styled entirely
 * via semantic CSS variables, so it restyles with the active theme.
 */
export function Button({
    variant = 'node',
    active = false,
    className,
    type = 'button',
    ...rest
}: ButtonProps) {
    const classes = [
        'oj-btn',
        variant !== 'node' && `oj-btn--${variant}`,
        active && 'is-active',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return <button type={type} className={classes} {...rest} />;
}
