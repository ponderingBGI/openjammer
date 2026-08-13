import type { HTMLAttributes } from 'react';
import './Waveform.css';

export interface WaveformProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /**
     * Sample/peak values to draw. May be a bipolar buffer (`-1..1`, drawn around
     * a center axis) or a unipolar envelope (`0..1`, drawn as height); the
     * component detects which from the data and scales to the viewBox.
     */
    data: number[];
    /**
     * Playback position as a fraction `0..1`. When present, a thin accent line is
     * drawn at that x. Omitted = no playhead (e.g. a static thumbnail).
     */
    playhead?: number;
    /**
     * Tints the trace with `--accent-danger` to signal a live capture (the
     * Looper/Sampler/Microphone "armed" state). No blur — a hard color shift only.
     */
    recording?: boolean;
    /** Draws a faint horizontal axis at the vertical center (`--border-subtle`). */
    showCenterLine?: boolean;
    /** Rendered pixel height of the SVG. Defaults to 48. Width fills the parent. */
    height?: number;
    /** Accessible name for the trace (no visible label of its own). */
    'aria-label'?: string;
}

/** Internal viewBox geometry — width is arbitrary; the SVG scales to its box. */
const VIEW_W = 1000;
const VIEW_H = 100;
const CENTER_Y = VIEW_H / 2;

/**
 * A pure-SVG waveform trace. Reads only semantic tokens: the stroke is
 * `--audio-output` (or `--accent-danger` while `recording`), the playhead is a
 * thin `--accent-primary` line, the optional center axis is `--border-subtle`.
 * No literal colors, no gradient, no blur. Replaces the inline waveform SVGs in
 * the Looper, Sampler, and Microphone nodes.
 */
export function Waveform({
    data,
    playhead,
    recording = false,
    showCenterLine = false,
    height = 48,
    className,
    style,
    'aria-label': ariaLabel,
    ...rest
}: WaveformProps) {
    const classes = [
        'oj-waveform',
        recording && 'is-recording',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    // Detect unipolar (0..1 envelope) vs bipolar (-1..1 buffer): if no sample is
    // negative, treat the data as a top-down envelope so a 0..1 input fills the box.
    const hasNegative = data.some((v) => v < 0);
    const points = buildPoints(data, hasNegative);

    const hasPlayhead = typeof playhead === 'number' && Number.isFinite(playhead);
    const playheadX = hasPlayhead
        ? Math.min(Math.max(playhead, 0), 1) * VIEW_W
        : 0;

    return (
        <div className={classes} style={{ height, ...style }} {...rest}>
            <svg
                className="oj-waveform__svg"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={ariaLabel}
            >
                {showCenterLine ? (
                    <line
                        className="oj-waveform__center"
                        x1={0}
                        y1={CENTER_Y}
                        x2={VIEW_W}
                        y2={CENTER_Y}
                    />
                ) : null}
                {points ? (
                    <polyline className="oj-waveform__trace" points={points} />
                ) : null}
                {hasPlayhead ? (
                    <line
                        className="oj-waveform__playhead"
                        x1={playheadX}
                        y1={0}
                        x2={playheadX}
                        y2={VIEW_H}
                    />
                ) : null}
            </svg>
        </div>
    );
}

/**
 * Map samples to a `points` string in viewBox space. Bipolar data is drawn
 * around the center axis; unipolar (`0..1`) data is drawn as height from the
 * bottom. Returns `null` for an empty/single-point buffer (nothing to stroke).
 */
function buildPoints(data: number[], hasNegative: boolean): string | null {
    const n = data.length;
    if (n < 2) return null;

    const step = VIEW_W / (n - 1);
    const coords = new Array<string>(n);
    for (let i = 0; i < n; i += 1) {
        const x = i * step;
        let y: number;
        const sample = data[i] ?? 0;
        if (hasNegative) {
            const clamped = Math.min(Math.max(sample, -1), 1);
            y = CENTER_Y - clamped * CENTER_Y;
        } else {
            const clamped = Math.min(Math.max(sample, 0), 1);
            y = VIEW_H - clamped * VIEW_H;
        }
        coords[i] = `${round(x)},${round(y)}`;
    }
    return coords.join(' ');
}

/** Trim float noise so the emitted SVG path stays compact. */
function round(v: number): number {
    return Math.round(v * 100) / 100;
}
