import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Swatch.css';

export interface SwatchProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect' | 'name'> {
    /**
     * The theme's canvas/background color. An arbitrary theme color string —
     * this is data passed in, not a literal in CSS (the one primitive that
     * legitimately takes color values as props).
     */
    bg: string;
    /** The theme's node color, shown as an inset chip on the canvas preview. */
    node: string;
    /** The theme's display name, rendered below the preview. */
    name: ReactNode;
    /** Whether this swatch is the currently chosen theme — gets a hard accent ring. */
    selected?: boolean;
    /** Called when the swatch is activated (click / keyboard). */
    onSelect?: () => void;
}

/**
 * A theme preview swatch. A small card showing the theme's `bg` color with an
 * inset `node`-color chip and the name below; the selected swatch gains a hard
 * `--accent-primary` ring (0-blur, per the Hard-Shadow Rule). Frame, border,
 * radius and ring read the semantic tokens; only `bg`/`node` are theme data.
 */
export function Swatch({
    bg,
    node,
    name,
    selected = false,
    onSelect,
    className,
    type = 'button',
    ...rest
}: SwatchProps) {
    const classes = ['oj-swatch', selected && 'is-selected', className]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            type={type}
            className={classes}
            aria-pressed={selected}
            onClick={onSelect}
            {...rest}
        >
            <span className="oj-swatch__preview" style={{ background: bg }}>
                <span className="oj-swatch__chip" style={{ background: node }} />
            </span>
            <span className="oj-swatch__name">{name}</span>
        </button>
    );
}
