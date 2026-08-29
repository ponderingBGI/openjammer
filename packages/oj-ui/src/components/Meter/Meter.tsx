import {
    forwardRef,
    useImperativeHandle,
    useRef,
    type CSSProperties,
    type HTMLAttributes,
} from 'react';
import './Meter.css';

/**
 * The imperative handle a level source drives. There is no `value` prop and no
 * state: a meter that re-rendered React 60 times a second would put the whole
 * component tree on the audio-visual hot path for a number that is only ever a
 * pixel height. The owner subscribes to the engine once and calls
 * {@link MeterHandle.setSignal} from ONE shared animation frame.
 */
export interface MeterHandle {
    /** Write a 0..1 level. Clamped; NaN is treated as silence. */
    setSignal(value: number): void;
}

export interface MeterProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** Number of bars. Default 6 (the transport pill's size). */
    bars?: number;
    /** Bar height in px. Default 18. */
    height?: number;
    /** Bar width in px. Default 3.5. */
    barWidth?: number;
    /**
     * Accessible name. Provided → the meter is exposed as a `meter` role with a
     * live text alternative; omitted → it is `aria-hidden` decoration beside a
     * control that already carries the meaning.
     */
    label?: string;
    /** Level at or above which the meter reads as clipping. Default 0.99. */
    clipThreshold?: number;
    /** How long the clip indication latches after the peak. Default 1200ms. */
    clipLatchMs?: number;
}

/**
 * Per-bar coefficients. A flat row of identical bars reads as a progress bar;
 * a gently arched one reads as a meter — the same trick the handoff prototype
 * uses (`--k`). Deterministic, so two meters of the same size always match.
 */
function coefficients(bars: number): number[] {
    if (bars <= 1) return [1];
    return Array.from({ length: bars }, (_, index) => {
        const t = index / (bars - 1);
        // 0.55 at the edges, 1.0 in the middle — one smooth arch.
        return Number((0.55 + 0.45 * Math.sin(Math.PI * t)).toFixed(3));
    });
}

/**
 * A live level meter — one of the only two things in OpenJammer allowed to move
 * with the sound (the other is a cable). It is a READOUT, not decoration, which
 * is why `global.css` exempts `.oj-meter` from the blanket reduced-motion rule:
 * suppressing it would not calm the interface, it would blind it.
 *
 * The bars scale from a single custom property, `--oj-meter-signal` (0..1),
 * written on the root element by the owner's animation frame. Nothing here
 * subscribes, and nothing here holds state, so a meter costs one style write per
 * frame and zero React work. Above `clipThreshold` the meter turns
 * `--accent-danger` and LATCHES for `clipLatchMs` — a clip you missed is a clip
 * you would have kept.
 */
export const Meter = forwardRef<MeterHandle, MeterProps>(function Meter(
    {
        bars = 6,
        height = 18,
        barWidth = 3.5,
        label,
        clipThreshold = 0.99,
        clipLatchMs = 1200,
        className,
        style,
        ...rest
    },
    ref,
) {
    const rootRef = useRef<HTMLSpanElement>(null);
    const clipUntil = useRef(0);

    useImperativeHandle(
        ref,
        (): MeterHandle => ({
            setSignal(value) {
                const node = rootRef.current;
                if (!node) return;
                const safe = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
                node.style.setProperty('--oj-meter-signal', safe.toFixed(3));
                const now = Date.now();
                if (safe >= clipThreshold) clipUntil.current = now + clipLatchMs;
                const clipping = now < clipUntil.current;
                if (node.classList.contains('is-clipping') !== clipping) {
                    node.classList.toggle('is-clipping', clipping);
                }
                if (label) node.setAttribute('aria-valuenow', String(Math.round(safe * 100)));
            },
        }),
        [clipThreshold, clipLatchMs, label],
    );

    const ks = coefficients(bars);
    const classes = ['oj-meter', className].filter(Boolean).join(' ');
    const rootStyle = {
        ...style,
        '--oj-meter-height': `${height}px`,
        '--oj-meter-bar-width': `${barWidth}px`,
    } as CSSProperties;

    return (
        <span
            ref={rootRef}
            className={classes}
            style={rootStyle}
            role={label ? 'meter' : undefined}
            aria-label={label}
            aria-valuemin={label ? 0 : undefined}
            aria-valuemax={label ? 100 : undefined}
            aria-valuenow={label ? 0 : undefined}
            aria-hidden={label ? undefined : true}
            {...rest}
        >
            {ks.map((k, index) => (
                // The `<i>` is the TRACK — a meter at rest must still read as a
                // meter, not as a dashed rule — and the span inside it is the
                // fill that moves. Only the fill transitions, which is why the
                // reduced-motion exemption is written for `.oj-meter *`.
                <i key={index} className="oj-meter__bar" style={{ '--oj-meter-k': k } as CSSProperties}>
                    <span className="oj-meter__fill" />
                </i>
            ))}
        </span>
    );
});
