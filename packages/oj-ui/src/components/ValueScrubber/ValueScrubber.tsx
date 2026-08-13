import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Input } from '../Input/Input';
import './ValueScrubber.css';

export interface ValueScrubberProps
    extends Omit<HTMLAttributes<HTMLSpanElement>, 'onChange'> {
    /** The current numeric value (the source of truth, owned by the parent). */
    value: number;
    /**
     * Pre-formatted text the parent has already rendered for `value` (units,
     * precision, sign). Shown in `--font-mono` so digits read exactly
     * (DESIGN.md Mono-Means-Exact). The parent formats; this never touches it.
     */
    display: string;
    /** Optional label shown beside the value (Caveat voice). */
    label?: ReactNode;
    /**
     * Whether clicking opens an inline editor and the display can be scrubbed.
     * Defaults to `true`. When `false`, the value is read-only text.
     */
    editable?: boolean;
    /** Greys out and blocks both editing and scrubbing. */
    disabled?: boolean;
    /**
     * Fired with the parsed numeric value when an inline edit commits
     * (Enter or blur). Scrub gestures are wired by the parent through the
     * spread native handlers (`onPointerDown`/`onWheel`), not here.
     */
    onCommit: (value: number) => void;
}

/**
 * A compact numeric value that reads as exact mono text and becomes an inline
 * editor on click. The parent owns the value and wires drag/wheel scrubbing by
 * attaching `onPointerDown`/`onWheel` (spread onto the display span) — this
 * component imports no scroll/wheel hook and holds only the transient edit
 * buffer. Click (when editable) opens an `Input` to type a number; Enter or
 * blur commits the parsed value via `onCommit`, Escape reverts. Theme-agnostic;
 * styled entirely via semantic CSS variables.
 */
export function ValueScrubber({
    value,
    display,
    label,
    editable = true,
    disabled = false,
    onCommit,
    className,
    ...rest
}: ValueScrubberProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    const canEdit = editable && !disabled;

    const open = () => {
        if (!canEdit) return;
        setDraft(String(value));
        setEditing(true);
    };

    const commit = () => {
        const parsed = parseFloat(draft);
        setEditing(false);
        if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
    };

    const cancel = () => setEditing(false);

    const classes = [
        'oj-value-scrubber',
        canEdit && 'oj-value-scrubber--editable',
        disabled && 'is-disabled',
        editing && 'is-editing',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes}>
            {label != null && <span className="oj-value-scrubber__label">{label}</span>}
            {editing ? (
                <Input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    className="oj-value-scrubber__input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancel();
                        }
                    }}
                    aria-label="Edit value"
                />
            ) : (
                <span
                    className="oj-value-scrubber__value"
                    role={canEdit ? 'button' : undefined}
                    tabIndex={canEdit ? 0 : undefined}
                    aria-disabled={disabled || undefined}
                    onClick={open}
                    onKeyDown={(e) => {
                        if (!canEdit) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            open();
                        }
                    }}
                    {...rest}
                >
                    {display}
                </span>
            )}
        </span>
    );
}
