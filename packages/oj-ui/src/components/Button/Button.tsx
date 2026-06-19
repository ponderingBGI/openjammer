import { forwardRef, type ButtonHTMLAttributes } from 'react';
import './Button.css';

export type ButtonVariant =
    | 'node'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'danger'
    | 'ghost'
    | 'link';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Visual role. `node` (default) is the white-fill node button; `primary`
     * is the accent-filled call to action; `success`/`danger` are the semantic
     * state fills; `ghost` is a borderless trigger (toolbar/menus, no lift);
     * `link` is text-only. All read the theme's semantic tokens, never literals.
     */
    variant?: ButtonVariant;
    /** Toggled/armed state (e.g. an engaged record button) — uses the success fill. */
    active?: boolean;
    /** Square, equal-padding button for a single glyph (compose with IconButton). */
    iconOnly?: boolean;
}

/**
 * The OpenJammer button. Hand-drawn ink border, hard offset feel, lifts on
 * hover and presses on click (DESIGN.md §5). Theme-agnostic: styled entirely
 * via semantic CSS variables, so it restyles with the active theme.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'node', active = false, iconOnly = false, className, type = 'button', ...rest },
    ref,
) {
    const classes = [
        'oj-btn',
        variant !== 'node' && `oj-btn--${variant}`,
        active && 'is-active',
        iconOnly && 'oj-btn--icon-only',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return <button ref={ref} type={type} className={classes} {...rest} />;
});
