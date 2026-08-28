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
     * Visual role. `node` (default) and `secondary` are the flat inset button;
     * `primary` is the one solid accent fill; `danger`/`success` are semantic
     * *tints* — a wash of the state colour with `--danger-ink`/`--success-ink`
     * text, never a solid alarm fill; `ghost` is transparent until touched;
     * `link` is text-only. All read semantic tokens, never literals.
     */
    variant?: ButtonVariant;
    /** Toggled/armed state (e.g. an engaged record button) — accent fill. */
    active?: boolean;
    /** Square, equal-padding button for a single glyph (compose with IconButton). */
    iconOnly?: boolean;
    /**
     * Work is in flight. The label keeps its box (nothing reflows) and three
     * dots march in its place; the button stops accepting clicks and reports
     * `aria-busy`. CSS-only — no Spinner dependency.
     */
    loading?: boolean;
}

/**
 * The OpenJammer button. New DNA: a flat inset recess — no border, no shadow —
 * that compresses under the finger (`scale(.96)` on the one spring curve) and
 * shows a single focus ring. Theme-agnostic: styled entirely via semantic CSS
 * variables, so it restyles with the active theme.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'node',
        active = false,
        iconOnly = false,
        loading = false,
        className,
        type = 'button',
        disabled,
        children,
        ...rest
    },
    ref,
) {
    const classes = [
        'oj-btn',
        variant !== 'node' && `oj-btn--${variant}`,
        active && 'is-active',
        iconOnly && 'oj-btn--icon-only',
        loading && 'is-loading',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            ref={ref}
            type={type}
            className={classes}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            {...rest}
        >
            {loading ? (
                <>
                    <span className="oj-btn__label">{children}</span>
                    <span className="oj-btn__loader" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                    </span>
                </>
            ) : (
                children
            )}
        </button>
    );
});
