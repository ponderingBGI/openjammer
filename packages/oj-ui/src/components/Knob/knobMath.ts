/**
 * Knob value mapping — the whole of the dial's arithmetic, kept out of the
 * component so it can be unit-tested (and reused by anything mapping a rotary
 * gesture onto a parameter) without rendering anything.
 */

/** The tick's angle at `min`. */
export const KNOB_MIN_ANGLE = -135;
/** Degrees swept between `min` and `max`. */
export const KNOB_ANGLE_SWEEP = 270;

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * True only when a logarithmic mapping is actually well-defined. A `min` of 0
 * has no logarithm; falling back to linear beats handing a performer a NaN.
 */
export function knobUsesLog(log: boolean | undefined, min: number, max: number): boolean {
    return Boolean(log) && min > 0 && max > 0 && max !== min;
}

/** value → 0..1, clamped. */
export function knobNorm(value: number, min: number, max: number, log?: boolean): number {
    if (knobUsesLog(log, min, max)) return clamp01(Math.log(value / min) / Math.log(max / min));
    if (max === min) return 0;
    return clamp01((value - min) / (max - min));
}

/** 0..1 → value. Inverse of {@link knobNorm}. */
export function knobValue(norm: number, min: number, max: number, log?: boolean): number {
    const n = clamp01(norm);
    if (knobUsesLog(log, min, max)) return min * Math.pow(max / min, n);
    return min + n * (max - min);
}

/** The tick angle, in degrees, for a value. */
export function knobRotation(value: number, min: number, max: number, log?: boolean): number {
    return KNOB_MIN_ANGLE + KNOB_ANGLE_SWEEP * knobNorm(value, min, max, log);
}
