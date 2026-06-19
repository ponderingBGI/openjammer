import type { HTMLAttributes, ReactNode } from 'react';
import './Callout.css';

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger' | 'tip';

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /**
     * The signal this box carries. The accent shows ONLY on the left border and
     * the icon (Signal-Not-Brand) — never on the surface or title text:
     * `info` → --audio-connection, `success` → --accent-success,
     * `warning` → --accent-warning, `danger` → --accent-danger,
     * `tip` → --accent-secondary. All read theme tokens, never literals.
     */
    variant?: CalloutVariant;
    /** Optional heading, set in the Caveat voice (Caveat-Is-the-Voice). */
    title?: ReactNode;
    /**
     * A glyph tinted with the variant accent. Pair it with the title/content so
     * the state always carries a label or icon, never color alone.
     */
    icon?: ReactNode;
    /** The message body. */
    children?: ReactNode;
}

/**
 * A boxed message. Hard-edged node surface with a 2px ink sketch border; the
 * variant accent appears only on the thick left edge and the icon, so the box
 * reads as a labelled signal rather than a brand-colored panel (DESIGN.md
 * Signal-Not-Brand). Theme-agnostic: styled entirely via semantic CSS
 * variables, so it restyles with the active theme. Replaces GuideInfoBox and
 * the various info/warning banners.
 */
export function Callout({
    variant = 'info',
    title,
    icon,
    className,
    children,
    ...rest
}: CalloutProps) {
    const classes = ['oj-callout', `oj-callout--${variant}`, className]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classes} role="note" {...rest}>
            {icon && (
                <span className="oj-callout__icon" aria-hidden="true">
                    {icon}
                </span>
            )}
            <div className="oj-callout__body">
                {title && <div className="oj-callout__title">{title}</div>}
                <div className="oj-callout__content">{children}</div>
            </div>
        </div>
    );
}
