import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type HTMLAttributes,
    type KeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { clamp01, knobNorm, knobRotation, knobValue } from './knobMath';
import './Knob.css';

export interface KnobProps
    extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
    /** Current value in its own units. Controlled — the knob holds no value. */
    value: number;
    /** Lower bound. */
    min: number;
    /** Upper bound. */
    max: number;
    /**
     * Logarithmic mapping — the right default for frequencies. Requires a
     * strictly positive `min`/`max`; a non-positive bound falls back to linear
     * rather than producing NaN under a performer's hand.
     */
    log?: boolean;
    /** Uppercase micro-label under the dial (mono). Also the accessible name. */
    label: string;
    /** Formats the value for the readout under the label. Mono-Means-Exact. */
    format?: (v: number) => string;
    /** Live, per-frame while dragging — feeds the optimistic graph edit. */
    onChange: (v: number) => void;
    /** Fired once when the gesture ends — the undo boundary. */
    onCommit?: (v: number) => void;
    /** Vertical px for the full range. Default 150 (matches the prototype). */
    dragRange?: number;
    /** Dial diameter in px. Default 52. */
    size?: number;
    /**
     * Keyboard/wheel increment in value units. Defaults to 1% of the range —
     * and, when `log` is set, to 1% of the *normalised* range, so a log knob
     * steps evenly across its whole sweep instead of crawling at the bottom.
     */
    step?: number;
    /** Double-click target. Omit it and double-click does nothing. */
    defaultValue?: number;
    disabled?: boolean;
}

/** Normalised increment used when no explicit `step` is given. */
const DEFAULT_STEP_NORM = 0.01;
/** Wheel notches and key repeats share one undo boundary after input settles. */
const QUIET_COMMIT_MS = 180;

/**
 * A rotary control — the thing that makes a node read as an instrument.
 *
 * Physics: vertical pointer drag, `dragRange` px (150 by default) for the full
 * sweep, `Shift` for a tenth of that. The dial resists — it never jumps to the
 * pointer, it moves *with* it, so the value under your finger is the value you
 * left there. `onChange` fires per move (drive the optimistic edit with it),
 * `onCommit` fires exactly once when the gesture ends (that is the undo
 * boundary). Double-click returns to `defaultValue`.
 *
 * A11y: a real `role="slider"` with `aria-valuenow/min/max/valuetext`, in the
 * tab order, driven by Arrow (+/-1 step), PageUp/PageDown (+/-10) and Home/End
 * — the prototype had none of that. A focused knob also takes the wheel.
 * Keyboard and wheel changes stream immediately, then coalesce into one commit
 * after 180ms without input (or sooner on blur, pointer-down, or unmount).
 *
 * The tick is a *value*, not an animation: it never transitions, in any motion
 * preference. Only the hover ring moves, on `--motion-fast`.
 */
export function Knob({
    value,
    min,
    max,
    log = false,
    label,
    format,
    onChange,
    onCommit,
    dragRange = 150,
    size = 52,
    step,
    defaultValue,
    disabled = false,
    className,
    style,
    ...rest
}: KnobProps) {
    const dialRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);

    /** Live gesture state — refs, so a move never re-renders on its own account. */
    const gesture = useRef({ lastY: 0, norm: 0, value, pointerId: -1, open: false });
    /** Latest props the window handlers need without re-subscribing every frame. */
    const latest = useRef({ min, max, log, dragRange, onChange, onCommit });
    const quietCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quietCommitValue = useRef<number | null>(null);
    /* Refreshed after every render, never during one: the window handlers read
       it, and they can only fire once the render has committed. */
    useEffect(() => {
        latest.current = { min, max, log, dragRange, onChange, onCommit };
    });

    const rotation = knobRotation(value, min, max, log);
    const display = format ? format(value) : String(value);

    const emit = useCallback((next: number) => {
        gesture.current.value = next;
        latest.current.onChange(next);
    }, []);

    const flushQuietCommit = useCallback(() => {
        if (quietCommitTimer.current != null) {
            clearTimeout(quietCommitTimer.current);
            quietCommitTimer.current = null;
        }
        const pending = quietCommitValue.current;
        quietCommitValue.current = null;
        if (pending != null) latest.current.onCommit?.(pending);
    }, []);

    const scheduleQuietCommit = useCallback(
        (next: number) => {
            if (quietCommitTimer.current != null) clearTimeout(quietCommitTimer.current);
            quietCommitValue.current = next;
            quietCommitTimer.current = setTimeout(flushQuietCommit, QUIET_COMMIT_MS);
        },
        [flushQuietCommit],
    );

    /** Close an open gesture exactly once, committing the value it ended on. */
    const endGesture = useCallback(() => {
        if (!gesture.current.open) return;
        gesture.current.open = false;
        setDragging(false);
        latest.current.onCommit?.(gesture.current.value);
    }, []);

    useEffect(() => {
        if (!dragging) return;

        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== gesture.current.pointerId) return;
            const { lastY } = gesture.current;
            const { dragRange: range, min: lo, max: hi, log: isLog } = latest.current;
            const fine = event.shiftKey ? 0.1 : 1;
            gesture.current.lastY = event.clientY;
            gesture.current.norm = clamp01(
                gesture.current.norm + ((lastY - event.clientY) / range) * fine,
            );
            emit(knobValue(gesture.current.norm, lo, hi, isLog));
        };
        const onUp = (event: PointerEvent) => {
            if (event.pointerId !== gesture.current.pointerId) return;
            endGesture();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        const onWindowBlur = () => {
            endGesture();
            flushQuietCommit();
        };
        window.addEventListener('blur', onWindowBlur);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            window.removeEventListener('blur', onWindowBlur);
        };
    }, [dragging, emit, endGesture, flushQuietCommit]);

    /* Unmount closes either kind of open gesture without losing its last value. */
    useEffect(
        () => () => {
            endGesture();
            flushQuietCommit();
        },
        [endGesture, flushQuietCommit],
    );

    /* Wheel, attached natively so it can be non-passive: only a FOCUSED knob
       takes the wheel, so scrolling a panel full of knobs still scrolls. */
    useEffect(() => {
        const el = dialRef.current;
        if (!el || disabled) return;
        const onWheel = (event: WheelEvent) => {
            if (document.activeElement !== el) return;
            event.preventDefault();
            const { min: lo, max: hi, log: isLog } = latest.current;
            const dir = event.deltaY > 0 ? -1 : 1;
            const current = gesture.current.value;
            const next =
                step != null
                    ? current + dir * step
                    : knobValue(
                          knobNorm(current, lo, hi, isLog) + dir * DEFAULT_STEP_NORM,
                          lo,
                          hi,
                          isLog,
                      );
            const clamped = Math.min(hi, Math.max(lo, next));
            if (clamped === current) return;
            emit(clamped);
            scheduleQuietCommit(clamped);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [disabled, emit, scheduleQuietCommit, step]);

    /* Keep the gesture's idea of the value in step with the controlled prop —
       the wheel handler reads it. Never touched during render. */
    useEffect(() => {
        if (!gesture.current.open) gesture.current.value = value;
    });

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (disabled || event.button !== 0) return;
        flushQuietCommit();
        event.preventDefault();
        event.stopPropagation();
        dialRef.current?.focus();
        try {
            dialRef.current?.setPointerCapture(event.pointerId);
        } catch {
            /* Capture is an optimisation; the window listeners are the contract. */
        }
        gesture.current = {
            lastY: event.clientY,
            norm: knobNorm(value, min, max, log),
            value,
            pointerId: event.pointerId,
            open: true,
        };
        setDragging(true);
    };

    const nudge = (steps: number) => {
        const current = gesture.current.value;
        const currentNorm = knobNorm(current, min, max, log);
        const next =
            step != null
                ? current + steps * step
                : knobValue(currentNorm + steps * DEFAULT_STEP_NORM, min, max, log);
        const clamped = Math.min(max, Math.max(min, next));
        if (clamped === current) return;
        emit(clamped);
        scheduleQuietCommit(clamped);
    };

    const jumpTo = (target: number, quiet: boolean) => {
        if (target === gesture.current.value) return;
        emit(target);
        if (quiet) scheduleQuietCommit(target);
        else {
            flushQuietCommit();
            latest.current.onCommit?.(target);
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowRight':
                nudge(1);
                break;
            case 'ArrowDown':
            case 'ArrowLeft':
                nudge(-1);
                break;
            case 'PageUp':
                nudge(10);
                break;
            case 'PageDown':
                nudge(-10);
                break;
            case 'Home':
                jumpTo(min, true);
                break;
            case 'End':
                jumpTo(max, true);
                break;
            default:
                return;
        }
        event.preventDefault();
    };

    const handleDoubleClick = () => {
        if (disabled || defaultValue == null) return;
        jumpTo(defaultValue, false);
    };

    const classes = ['oj-knob-wrap', disabled && 'is-disabled', className]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            style={{ ...style, '--oj-knob-size': `${size}px` } as CSSProperties}
            {...rest}
        >
            <div
                ref={dialRef}
                className={dragging ? 'oj-knob is-dragging' : 'oj-knob'}
                style={{ '--oj-knob-rot': `${rotation}deg` } as CSSProperties}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={label}
                aria-valuenow={value}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuetext={display}
                aria-orientation="vertical"
                aria-disabled={disabled || undefined}
                onPointerDown={handlePointerDown}
                onKeyDown={handleKeyDown}
                onBlur={flushQuietCommit}
                onDoubleClick={handleDoubleClick}
            />
            <span className="oj-knob__label">{label}</span>
            <span className="oj-knob__value">{display}</span>
        </div>
    );
}
