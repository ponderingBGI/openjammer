import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Input } from '../Input/Input';
import './EditableLabel.css';

export interface EditableLabelProps {
    /** The committed label text shown when not editing and seeded into the input on edit. */
    value: string;
    /**
     * Controlled edit mode. When provided, the component does not own the editing
     * flag — the parent flips it via `onCommit`/`onCancel`. Omit to use `defaultEditing`.
     */
    editing?: boolean;
    /** Uncontrolled initial edit mode (ignored when `editing` is provided). */
    defaultEditing?: boolean;
    /** Placeholder for the input and the empty-label hint while resting. */
    placeholder?: string;
    /** Text alignment of both the resting label and the input. */
    align?: 'left' | 'center';
    /** Uses the exact-value mono face in both display and edit modes. */
    mono?: boolean;
    /** Prevents entering or changing edit mode. */
    disabled?: boolean;
    /** Called with the trimmed draft when committed (Enter or blur). */
    onCommit: (value: string) => void;
    /** Called when editing is abandoned (Escape) — the draft reverts to `value`. */
    onCancel?: () => void;
    /** Extra class on the wrapper. */
    className?: string;
}

/**
 * Inline-rename label. Rests as an Outfit label (double-click or Enter to edit);
 * in edit mode it renders an {@link Input} seeded with `value`. Enter and blur
 * commit via `onCommit`; Escape reverts the draft and calls `onCancel`.
 *
 * Works controlled (`editing`) or uncontrolled (`defaultEditing`). Theme-agnostic:
 * styled only via semantic tokens. Replaces the hand-rolled inline rename in
 * CanvasIO / Container / MIDI / Input / OutputPanel.
 */
export function EditableLabel({
    value,
    editing,
    defaultEditing = false,
    placeholder,
    align = 'left',
    mono = false,
    disabled = false,
    onCommit,
    onCancel,
    className,
}: EditableLabelProps) {
    const isControlled = editing !== undefined;
    const [internalEditing, setInternalEditing] = useState(defaultEditing);
    const isEditing = isControlled ? editing : internalEditing;

    const [draft, setDraft] = useState(value);
    const suppressNextBlur = useRef(false);

    // Reseed the draft each time we enter edit mode so stale edits never linger.
    useEffect(() => {
        if (isEditing) setDraft(value);
        // Only reseed on the edit-mode transition, not on every `value` change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    const stopEditing = () => {
        if (!isControlled) setInternalEditing(false);
    };

    const beginEditing = () => {
        if (disabled) return;
        if (!isControlled) setInternalEditing(true);
    };

    const commit = () => {
        suppressNextBlur.current = false;
        onCommit(draft.trim());
        stopEditing();
    };

    const cancel = () => {
        suppressNextBlur.current = true;
        setDraft(value);
        onCancel?.();
        stopEditing();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        }
    };

    const classes = [
        'oj-editable-label',
        align === 'center' && 'oj-editable-label--center',
        mono && 'oj-editable-label--mono',
        disabled && 'is-disabled',
        isEditing && 'is-editing',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    const isEmpty = value.length === 0;

    return (
        <span className={classes}>
            <span
                className={[
                    'oj-editable-label__text',
                    isEmpty && 'is-placeholder',
                ]
                    .filter(Boolean)
                    .join(' ')}
                role="button"
                tabIndex={isEditing || disabled ? -1 : 0}
                aria-disabled={disabled || undefined}
                aria-hidden={isEditing || undefined}
                onDoubleClick={beginEditing}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        beginEditing();
                    }
                }}
                title="Double-click or Enter to edit"
            >
                {isEmpty ? placeholder ?? '' : value}
            </span>
            {isEditing && (
                <Input
                    className="oj-editable-label__input"
                    mono={mono}
                    disabled={disabled}
                    value={draft}
                    placeholder={placeholder}
                    autoFocus
                    onFocus={(e: FocusEvent<HTMLInputElement>) => e.target.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        if (suppressNextBlur.current) {
                            suppressNextBlur.current = false;
                            return;
                        }
                        commit();
                    }}
                />
            )}
        </span>
    );
}
