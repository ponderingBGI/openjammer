import type { SelectHTMLAttributes } from 'react';
import './Select.css';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Dropdown select. Input's shape — surface fill, one `--border-strong`
 * hairline, 10px radius, Outfit 500 — with a `--text-muted` caret drawn in the
 * padding so the native arrow never fights the theme. Text choices, not exact
 * values, so no mono. Theme-agnostic.
 */
export function Select({ className, ...rest }: SelectProps) {
    return <select className={['oj-select', className].filter(Boolean).join(' ')} {...rest} />;
}
