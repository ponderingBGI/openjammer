import type { HTMLAttributes } from 'react';
import { Button } from '../Button/Button';
import { Surface } from '../Surface/Surface';
import { IconBolt, IconChevronDown } from '../Icons/Icons';
import './DeviceSelect.css';

export interface DeviceSelectItem {
    /** Stable identifier passed back through `onSelect`. */
    id: string;
    /** Human-readable device name shown in the trigger and the list. */
    label: string;
    /**
     * Marks a fast-path device — gets a trailing lightning bolt. The bolt rides
     * alongside its label (Signal-Not-Brand: the mark sits with a name, never on
     * the surface itself).
     */
    lowLatency?: boolean;
}

export interface DeviceSelectProps
    extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
    /** Devices to choose from. */
    items: DeviceSelectItem[];
    /** The selected device `id` (controlled). */
    value: string;
    /** Whether the popover list is open (controlled by the parent). */
    open: boolean;
    /** Fired when the trigger is clicked — the parent flips `open`. */
    onToggle: () => void;
    /** Fired with the chosen device `id` when a list row is clicked. */
    onSelect: (id: string) => void;
    /**
     * Accessible name for the picker (e.g. "Microphone" / "Speaker"). Surfaces
     * as `aria-label` on the trigger so the control announces what it picks.
     */
    ariaLabel: string;
    /** Shown on the trigger when no item matches `value`. Defaults to "Select device". */
    placeholder?: string;
}

/**
 * An audio-device picker with a low-latency badge — the replacement for the
 * Microphone/Speaker device dropdowns. The trigger is a node `Button` showing
 * the selected label; when `open`, a `Surface` (menu elevation, popover layer)
 * lists each device as a row button, marking the fast-path ones with an
 * `IconBolt`.
 *
 * Pure presentation: selection and open/close are controlled by the parent
 * (props in, callbacks out). Theme-agnostic — styled entirely via semantic
 * tokens, so it follows the active theme.
 */
export function DeviceSelect({
    items,
    value,
    open,
    onToggle,
    onSelect,
    ariaLabel,
    placeholder = 'Select device',
    className,
    ...rest
}: DeviceSelectProps) {
    const selected = items.find((item) => item.id === value);
    const classes = ['oj-device-select', className].filter(Boolean).join(' ');

    return (
        <div className={classes} {...rest}>
            <Button
                variant="node"
                className="oj-device-select__trigger"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={onToggle}
            >
                <span className="oj-device-select__label">
                    {selected ? selected.label : placeholder}
                </span>
                {selected?.lowLatency && (
                    <IconBolt size={14} className="oj-device-select__trigger-bolt" />
                )}
                <IconChevronDown
                    size={14}
                    className="oj-device-select__caret"
                />
            </Button>

            {open && (
                <Surface
                    elevation="menu"
                    radius="md"
                    className="oj-device-select__list"
                    role="listbox"
                    aria-label={ariaLabel}
                    style={{ zIndex: 'var(--z-popover)' }}
                >
                    {items.map((item) => {
                        const isSelected = item.id === value;
                        return (
                            <Button
                                key={item.id}
                                variant="ghost"
                                role="option"
                                aria-selected={isSelected}
                                active={isSelected}
                                className="oj-device-select__option"
                                onClick={() => onSelect(item.id)}
                            >
                                <span className="oj-device-select__label">
                                    {item.label}
                                </span>
                                {item.lowLatency && (
                                    <IconBolt
                                        size={14}
                                        className="oj-device-select__option-bolt"
                                    />
                                )}
                            </Button>
                        );
                    })}
                </Surface>
            )}
        </div>
    );
}
