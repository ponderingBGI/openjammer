import type { CSSProperties, InputHTMLAttributes } from 'react';
import './Slider.css';

export interface SliderProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
    /** Current position. Controlled — the slider holds no state of its own. */
    value: number;
    /** Lower bound. Defaults to 0. */
    min?: number;
    /** Upper bound. Defaults to 100. */
    max?: number;
    /** Step granularity. Defaults to 1. */
    step?: number;
    /** Fired with the parsed numeric value on every drag tick. */
    onChange: (value: number) => void;
    /** Accessible name — required, since the slider carries no visible label. */
    'aria-label': string;
}

/**
 * The OpenJammer range slider. New DNA: a 6px pill rail (`--bg-tertiary`) with
 * an `--accent-primary` progress fill and an 18px `--bg-node` thumb ringed in
 * `--border-control`. A real `<input type="range">`, so keyboard stepping,
 * `role="slider"` and screen-reader value reporting are native — the e2e suite
 * and assistive tech both find it by role.
 *
 * WebKit has no `::-moz-range-progress`, so the filled portion is painted with
 * a hard-stop gradient driven by the `--oj-slider-progress` custom property
 * (0–100) written here. Stateless: render from `value`, report via `onChange`.
 * Nothing reflows on interaction — the thumb swells, the track does not move.
 */
export function Slider({
    value,
    min = 0,
    max = 100,
    step = 1,
    onChange,
    className,
    style,
    ...rest
}: SliderProps) {
    const classes = ['oj-slider', className].filter(Boolean).join(' ');
    const span = max - min;
    const progress = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;

    return (
        <input
            type="range"
            className={classes}
            style={{ ...style, '--oj-slider-progress': progress } as CSSProperties}
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.valueAsNumber)}
            {...rest}
        />
    );
}
