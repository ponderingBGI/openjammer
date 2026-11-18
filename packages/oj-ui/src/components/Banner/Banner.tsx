import type { HTMLAttributes, ReactNode } from 'react';
import { Surface } from '../Surface/Surface';
import './Banner.css';

export type BannerTone = 'warning' | 'danger' | 'info';

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /**
     * The signal this banner carries. Tone tints the title and optional icon;
     * the surface and message stay neutral.
     */
    tone: BannerTone;
    /**
     * A glyph tinted with the tone accent. Pair it with the title so the state
     * always carries a label or icon, never color alone (Signal-Not-Brand).
     */
    icon?: ReactNode;
    /** The 14px/600 Outfit headline, tinted by the tone. */
    title: ReactNode;
    /** A quieter 13px Outfit line under the title. */
    message?: ReactNode;
    /**
     * Right-aligned slot for the response Buttons (Fix Now / Ask AI / Dismiss).
     * The caller owns their exact shape — compose Button here.
     */
    actions?: ReactNode;
}

/**
 * A full-width raised notice surface. State is expressed by the title/icon,
 * never a stripe or tinted card. The `actions` slot composes committed Buttons.
 */
export function Banner({
    tone,
    icon,
    title,
    message,
    actions,
    className,
    ...rest
}: BannerProps) {
    const classes = ['oj-banner', `oj-banner--${tone}`, className]
        .filter(Boolean)
        .join(' ');

    return (
        <Surface
            elevation="raised"
            radius="lg"
            className={classes}
            role="status"
            {...rest}
        >
            {icon != null && (
                <span className="oj-banner__icon" aria-hidden="true">
                    {icon}
                </span>
            )}
            <div className="oj-banner__body">
                <div className="oj-banner__title">{title}</div>
                {message != null && <div className="oj-banner__message">{message}</div>}
            </div>
            {actions != null && <div className="oj-banner__actions">{actions}</div>}
        </Surface>
    );
}
