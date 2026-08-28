import { forwardRef, type InputHTMLAttributes } from 'react';
import './Input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    /**
     * Render the value in JetBrains Mono with tabular figures. Set it for
     * numeric / exact fields (Mono-Means-Exact); leave it off for prose, names
     * and search — those are Outfit like the rest of the UI.
     */
    mono?: boolean;
}

/**
 * Text / numeric input. New DNA: `--bg-node` fill, one `--border-strong`
 * hairline, 10px radius, Outfit 500; focus shifts the border to the accent and
 * adds the one focus ring, `aria-invalid` shifts both to danger. Theme-agnostic.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { className, mono = false, ...rest },
    ref,
) {
    const classes = ['oj-input', mono && 'oj-input--mono', className].filter(Boolean).join(' ');
    return <input ref={ref} className={classes} {...rest} />;
});
