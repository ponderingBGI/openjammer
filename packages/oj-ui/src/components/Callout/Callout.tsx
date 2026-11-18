import type { HTMLAttributes, ReactNode } from 'react';
import { Surface } from '../Surface/Surface';
import './Callout.css';

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger' | 'tip';

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /**
     * The signal this box carries. It tints the title and optional icon only;
     * the body remains neutral for sustained readability.
     */
    variant?: CalloutVariant;
    /** Optional heading in the functional Outfit face. */
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
 * A compact raised message surface. State is carried by the title/icon rather
 * than a stripe or tinted body, keeping the construction calm and legible.
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
        <Surface elevation="raised" radius="lg" className={classes} role="note" {...rest}>
            {icon && (
                <span className="oj-callout__icon" aria-hidden="true">
                    {icon}
                </span>
            )}
            <div className="oj-callout__body">
                {title && <div className="oj-callout__title">{title}</div>}
                <div className="oj-callout__content">{children}</div>
            </div>
        </Surface>
    );
}
