import type { ReactNode } from 'react';
import './Field.css';

export interface FieldProps {
    /** The field label (Caveat voice). */
    label: ReactNode;
    /** Associates the label with a control `id`. */
    htmlFor?: string;
    /** Lay the label and control side by side instead of stacked. */
    row?: boolean;
    className?: string;
    children: ReactNode;
}

/**
 * A labeled form group: a Caveat label paired with its control (stacked by
 * default, `row` for inline). Pure layout + the label voice; the control inside
 * is any oj-ui input/select. Theme-agnostic.
 */
export function Field({ label, htmlFor, row = false, className, children }: FieldProps) {
    const classes = ['oj-field', row && 'oj-field--row', className].filter(Boolean).join(' ');
    return (
        <label className={classes} htmlFor={htmlFor}>
            <span className="oj-field__label">{label}</span>
            {children}
        </label>
    );
}
