import type { HTMLAttributes, ReactNode } from 'react';
import { Waveform } from '../Waveform/Waveform';
import './WaveformView.css';

export interface WaveformViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** Peak/sample values for the clip preview (forwarded to `Waveform` as `data`). */
    peaks: number[];
    /** Exact clip length, drawn in `--font-mono` (the Mono-Means-Exact Rule). */
    durationLabel: string;
    /** The clip's display name — Caveat, truncated to a single line. */
    name: ReactNode;
    /** Marks the clip as showing a cropped region (a small corner indicator). */
    cropped?: boolean;
    /** Selected state — a hard accent ring (0 blur), no layout shift. */
    selected?: boolean;
    /** Being dragged — dims the card so the drag layer reads as the live copy. */
    dragging?: boolean;
    /** Hovered as a valid drop target — a hard success ring (0 blur). */
    dropTarget?: boolean;
    /** Whether the card is HTML5-draggable (native drag for library drops). */
    draggable?: boolean;
}

/**
 * A clip preview card. Composes `Waveform` for the trace, with the clip name in
 * Caveat (truncating) and the exact `durationLabel` in mono. `selected` and
 * `dropTarget` apply hard accent/success rings with zero blur (Hard-Shadow
 * Rule); nothing reflows on state change (No-Surprise Rule). Presentational
 * only — drag/select/edit logic stays in the app and arrives via callbacks.
 * Replaces the AudioClipVisual presentation.
 */
export function WaveformView({
    peaks,
    durationLabel,
    name,
    cropped = false,
    selected = false,
    dragging = false,
    dropTarget = false,
    draggable = false,
    className,
    ...rest
}: WaveformViewProps) {
    const classes = [
        'oj-waveform-view',
        selected && 'is-selected',
        dragging && 'is-dragging',
        dropTarget && 'is-drop-target',
        cropped && 'is-cropped',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classes} draggable={draggable} {...rest}>
            <div className="oj-waveform-view__preview">
                <Waveform
                    className="oj-waveform-view__trace"
                    data={peaks}
                    showCenterLine
                    height={40}
                />
                {cropped ? (
                    <span className="oj-waveform-view__crop" aria-label="Cropped region">
                        ⟩⟨
                    </span>
                ) : null}
                <span className="oj-waveform-view__duration">{durationLabel}</span>
            </div>
            <div className="oj-waveform-view__name">{name}</div>
        </div>
    );
}
