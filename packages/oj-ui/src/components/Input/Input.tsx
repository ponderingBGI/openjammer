import { forwardRef, type InputHTMLAttributes } from 'react';
import './Input.css';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Text / numeric input. Paper fill, 2px ink border, 6px radius; focus shifts the
 * border to the accent (no glow — Hard-Shadow ethos). Monospace by default so
 * exact values read digit-by-digit (DESIGN.md Mono-Means-Exact). Theme-agnostic.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={['oj-input', className].filter(Boolean).join(' ')} {...rest} />;
});
