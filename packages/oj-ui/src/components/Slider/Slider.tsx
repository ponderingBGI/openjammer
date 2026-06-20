import type { InputHTMLAttributes } from 'react';
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
 * The OpenJammer range slider. A token-driven track (`--bg-tertiary` rail,
 * `--sketch-light` fill) with a hand-drawn thumb (`--accent-primary` fill, 2px
 * `--sketch-black` ink border). Stateless: render from `value`, report through
 * `onChange`. No layout shift on interaction (DESIGN.md No-Surprise) — feedback
 * is color and a ≤2px transform only. Theme-agnostic; styled entirely via
 * semantic CSS variables.
 */
export function Slider({
    value,
    min = 0,
    max = 100,
    step = 1,
    onChange,
    className,
    ...rest
}: SliderProps) {
    const classes = ['oj-slider', className].filter(Boolean).join(' ');

    return (
        <input
            type="range"
            className={classes}
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.valueAsNumber)}
            {...rest}
        />
    );
}
