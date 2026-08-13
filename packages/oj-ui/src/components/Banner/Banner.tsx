import type { HTMLAttributes, ReactNode } from 'react';
import { Surface } from '../Surface/Surface';
import './Banner.css';

export type BannerTone = 'warning' | 'danger' | 'info';

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    /**
     * The signal this banner carries. The accent shows ONLY on the thick left
     * edge and the icon (Signal-Not-Brand) — never on the surface or title:
     * `warning` → --accent-warning, `danger` → --accent-danger,
     * `info` → --audio-connection. All read theme tokens, never literals.
     */
    tone: BannerTone;
    /**
     * A glyph tinted with the tone accent. Pair it with the title so the state
     * always carries a label or icon, never color alone (Signal-Not-Brand).
     */
    icon?: ReactNode;
    /** The headline, set in the Caveat voice and neutral ink (Caveat-Is-the-Voice). */
    title: ReactNode;
    /** A quieter line under the title, set in Inter for dense reading. */
    message?: ReactNode;
    /**
     * Right-aligned slot for the response Buttons (Fix Now / Ask AI / Dismiss).
     * The caller owns their exact shape — compose Button here.
     */
    actions?: ReactNode;
}

/**
 * A full-width notice banner. Composes {@link Surface} (node fill, 2px ink
 * sketch border, hard blur-free menu shadow) with a tone accent confined to the
 * thick left edge and the icon, so the strip reads as a labelled signal rather
 * than a brand-colored panel (DESIGN.md Signal-Not-Brand, Hard-Shadow). The
 * title stays neutral ink; the `actions` slot holds Buttons. Props in, callbacks
 * out — no app state. Theme-agnostic: styled entirely via semantic CSS
 * variables, so it follows the active theme. Replaces the LatencyWarningBanner
 * surface (a full rewrite off its clay fill).
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
            elevation="menu"
            radius="lg"
            className={classes}
            role="alert"
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
