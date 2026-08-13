import type { SelectHTMLAttributes } from 'react';
import './Select.css';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Dropdown select. Same paper/ink/6px shape as Input, but the Caveat voice for
 * its options (text choices, not exact values). Theme-agnostic.
 */
export function Select({ className, ...rest }: SelectProps) {
    return <select className={['oj-select', className].filter(Boolean).join(' ')} {...rest} />;
}
