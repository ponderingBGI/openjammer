import type { TextareaHTMLAttributes } from 'react';
import './Textarea.css';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multiline text input — Input's sibling. Surface fill, one `--border-strong`
 * hairline, 10px radius; focus shifts the border to the accent and adds the one
 * focus ring. Outfit so prose reads as prose (Mono-Means-Exact: mono is
 * reserved for exact numerics, opt in with `font-family: var(--font-mono)`).
 * Theme-agnostic — styled only via semantic CSS variables.
 */
export function Textarea({ className, ...rest }: TextareaProps) {
    return <textarea className={['oj-textarea', className].filter(Boolean).join(' ')} {...rest} />;
}
