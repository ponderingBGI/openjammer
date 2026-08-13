import type { HTMLAttributes } from 'react';
import './Surface.css';

export type SurfaceElevation = 'rest' | 'menu' | 'lifted';
export type SurfaceRadius = 'md' | 'lg' | 'xl';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * How far the card lifts off the paper. `rest` (default) is the node-rest
     * hard shadow; `menu` is the raised context-menu shadow; `lifted` is a
     * slightly heavier hard offset for the topmost panels. Every value is a
     * blur-free ink offset (DESIGN.md Hard-Shadow).
     */
    elevation?: SurfaceElevation;
    /** Corner softness — maps to the radius token scale. Defaults to `lg`. */
    radius?: SurfaceRadius;
}

/**
 * An inked, lifted card container. White node fill, 2px ink border, and a hard
 * (blur-free) shadow — the chrome behind dropdowns, the help panel, and the
 * various `*-panel` cards. Theme-agnostic: styled entirely via semantic CSS
 * variables, so it follows the active theme. Compose content via `children`.
 */
export function Surface({
    elevation = 'rest',
    radius = 'lg',
    className,
    ...rest
}: SurfaceProps) {
    const classes = [
        'oj-surface',
        `oj-surface--elevation-${elevation}`,
        `oj-surface--radius-${radius}`,
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return <div className={classes} {...rest} />;
}
