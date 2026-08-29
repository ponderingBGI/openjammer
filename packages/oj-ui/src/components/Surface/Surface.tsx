import type { HTMLAttributes } from 'react';
import './Surface.css';

/**
 * Visual depth of a surface. The legacy names remain accepted so existing
 * consumers migrate without a flag day; they are normalized to the two New
 * DNA elevations in the rendered class name.
 */
export type SurfaceElevation =
    | 'raised'
    | 'overlay'
    /** @deprecated Use `raised`. */
    | 'rest'
    /** @deprecated Use `overlay`. */
    | 'menu'
    /** @deprecated Use `raised`. */
    | 'lifted';
export type SurfaceRadius = 'md' | 'lg' | 'xl';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * How far the surface lifts. `raised` is the default card depth and
     * `overlay` is reserved for menus and dialogs.
     */
    elevation?: SurfaceElevation;
    /** Corner softness — maps to the radius token scale. Defaults to `lg`. */
    radius?: SurfaceRadius;
}

/**
 * The shared New DNA surface: node fill, a subtle hairline and one of two
 * semantic depth levels. Compose content via `children`.
 */
export function Surface({
    elevation = 'raised',
    radius = 'lg',
    className,
    ...rest
}: SurfaceProps) {
    const normalizedElevation =
        elevation === 'menu' ? 'overlay' : elevation === 'rest' || elevation === 'lifted' ? 'raised' : elevation;
    const classes = [
        'oj-surface',
        `oj-surface--elevation-${normalizedElevation}`,
        `oj-surface--radius-${radius}`,
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return <div className={classes} {...rest} />;
}
