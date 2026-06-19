import type { TextareaHTMLAttributes } from 'react';
import './Textarea.css';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multiline text input — Input's sibling. Paper fill, 2px ink border, 6px
 * radius; focus shifts the border to the accent (no glow — Hard-Shadow ethos).
 * Sans by default so prose reads as prose (Mono-Means-Exact: mono is reserved
 * for exact numerics, so it is opt-in via `font-family: var(--font-mono)`).
 * Theme-agnostic — styled only via semantic CSS variables.
 */
export function Textarea({ className, ...rest }: TextareaProps) {
    return <textarea className={['oj-textarea', className].filter(Boolean).join(' ')} {...rest} />;
}
