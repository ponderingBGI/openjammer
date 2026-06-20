import type { ReactNode } from 'react';
import './Toggle.css';

export interface ToggleProps {
    /** On/off state. Controlled — the parent owns the value. */
    checked: boolean;
    /** Fires with the next value when the player flips the switch. */
    onChange: (checked: boolean) => void;
    /** The switch label (Caveat voice). */
    label: ReactNode;
    /** Optional muted line under the label explaining what the switch does. */
    description?: ReactNode;
    /** Greys out and blocks interaction. */
    disabled?: boolean;
    /** Associates the visually-hidden checkbox (and lets a sibling label point at it). */
    id?: string;
}

/**
 * A labeled on/off switch. A real (visually-hidden) checkbox drives a hand-drawn
 * sketch track and knob, so it stays keyboard- and screen-reader-native while
 * looking inked. The knob slides on toggle; nothing reflows on hover or press
 * (No-Surprise §4). Theme-agnostic: styled only via semantic tokens.
 */
export function Toggle({ checked, onChange, label, description, disabled = false, id }: ToggleProps) {
    const classes = ['oj-toggle', checked && 'is-checked', disabled && 'is-disabled']
        .filter(Boolean)
        .join(' ');

    return (
        <label className={classes}>
            <input
                type="checkbox"
                className="oj-toggle__input"
                id={id}
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
            />
            <span className="oj-toggle__track" aria-hidden="true">
                <span className="oj-toggle__knob" />
            </span>
            <span className="oj-toggle__text">
                <span className="oj-toggle__label">{label}</span>
                {description != null && <span className="oj-toggle__desc">{description}</span>}
            </span>
        </label>
    );
}
