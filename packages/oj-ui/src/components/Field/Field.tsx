import { cloneElement, useId, type AriaAttributes, type ReactElement, type ReactNode } from 'react';
import './Field.css';

type FieldControlProps = Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> & {
    id?: string;
};

export interface FieldProps {
    /** The field label — rendered as an uppercase micro-caption. */
    label: ReactNode;
    /** Associates the label with a control `id`; generated when omitted. */
    htmlFor?: string;
    /** Lay the label and control side by side instead of stacked. */
    row?: boolean;
    /** A quiet line announced after, but never folded into, the accessible name. */
    description?: ReactNode;
    /** Validation message. Marks the control invalid and announces as an alert. */
    error?: ReactNode;
    className?: string;
    children: ReactElement<FieldControlProps>;
}

/**
 * A labeled form group: an uppercase micro-label paired with its control
 * (stacked by default, `row` for inline), with optional description and error
 * slots underneath. Pure layout + the label voice; the control inside is any
 * oj-ui input/select. Theme-agnostic.
 */
export function Field({
    label,
    htmlFor,
    row = false,
    description,
    error,
    className,
    children,
}: FieldProps) {
    const generatedId = `oj-field-${useId().replace(/:/g, '')}`;
    const controlId = htmlFor ?? children.props.id ?? generatedId;
    const descriptionId = `${controlId}-description`;
    const errorId = `${controlId}-error`;
    const describedBy = [
        children.props['aria-describedby'],
        description != null ? descriptionId : undefined,
        error != null ? errorId : undefined,
    ]
        .filter(Boolean)
        .join(' ');
    const controlProps: FieldControlProps = { id: controlId };
    if (describedBy) controlProps['aria-describedby'] = describedBy;
    if (error != null) controlProps['aria-invalid'] = true;
    const control = cloneElement(children, controlProps);
    const classes = ['oj-field', row && 'oj-field--row', className].filter(Boolean).join(' ');
    return (
        <div className={classes}>
            <label className="oj-field__label" htmlFor={controlId}>
                {label}
            </label>
            {control}
            {description != null && (
                <span className="oj-field__description" id={descriptionId}>
                    {description}
                </span>
            )}
            {error != null && (
                <span className="oj-field__error" id={errorId} role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}
