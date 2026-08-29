import { useEffect, useId, useRef, useState } from 'react';
import type { HTMLAttributes, KeyboardEvent } from 'react';
import { Surface } from '../Surface/Surface';
import { IconBolt, IconChevronDown } from '../Icons/Icons';
import './DeviceSelect.css';

export interface DeviceSelectItem {
    /** Stable identifier passed back through `onSelect`. */
    id: string;
    /** Human-readable device name shown in the trigger and the list. */
    label: string;
    /** Marks a fast-path device with both a bolt and visible "low latency" text. */
    lowLatency?: boolean;
}

export interface DeviceSelectProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
    items: DeviceSelectItem[];
    value: string;
    open: boolean;
    onToggle: () => void;
    onSelect: (id: string) => void;
    ariaLabel: string;
    placeholder?: string;
    disabled?: boolean;
}

/** Controlled audio-device picker with arrow, Enter, Escape, and typeahead support. */
export function DeviceSelect({
    items,
    value,
    open,
    onToggle,
    onSelect,
    ariaLabel,
    placeholder = 'Select device',
    disabled = false,
    className,
    ...rest
}: DeviceSelectProps) {
    const selectedIndex = items.findIndex((item) => item.id === value);
    const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
    const itemContext = `${value}\u0000${items.map((item) => item.id).join('\u0001')}`;
    const [activeItem, setActiveItem] = useState<{ context: string; id: string } | null>(null);
    const storedActiveIndex = activeItem?.context === itemContext
        ? items.findIndex((item) => item.id === activeItem.id)
        : -1;
    const activeIndex = storedActiveIndex >= 0 ? storedActiveIndex : Math.max(selectedIndex, 0);
    const typeahead = useRef('');
    const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reactId = useId().replace(/:/g, '');
    const listId = `oj-device-select-${reactId}`;

    useEffect(() => () => {
        if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    }, []);

    const optionId = (index: number) => `${listId}-option-${index}`;
    const activateIndex = (index: number) => {
        const item = items[index];
        if (item) setActiveItem({ context: itemContext, id: item.id });
    };
    const moveActive = (delta: number) => {
        if (items.length === 0) return;
        activateIndex((activeIndex + delta + items.length) % items.length);
    };
    const openFromKeyboard = () => {
        if (!open) onToggle();
    };
    const runTypeahead = (key: string) => {
        typeahead.current += key.toLocaleLowerCase();
        if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
        typeaheadTimer.current = setTimeout(() => {
            typeahead.current = '';
        }, 500);
        const match = items.findIndex((item) =>
            item.label.toLocaleLowerCase().startsWith(typeahead.current),
        );
        if (match >= 0) {
            activateIndex(match);
            openFromKeyboard();
        }
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
                const nextIndex = Math.max(selectedIndex, 0);
                activateIndex(nextIndex);
                onToggle();
            } else {
                moveActive(event.key === 'ArrowDown' ? 1 : -1);
            }
        } else if (event.key === 'Home' && open) {
            event.preventDefault();
            activateIndex(0);
        } else if (event.key === 'End' && open) {
            event.preventDefault();
            activateIndex(Math.max(items.length - 1, 0));
        } else if ((event.key === 'Enter' || event.key === ' ') && open) {
            event.preventDefault();
            const item = items[activeIndex];
            if (item) onSelect(item.id);
        } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            activateIndex(Math.max(selectedIndex, 0));
            onToggle();
        } else if (
            event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey
        ) {
            runTypeahead(event.key);
        }
    };

    const classes = ['oj-device-select', open && 'is-open', className]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classes} {...rest}>
            <button
                type="button"
                role="combobox"
                className="oj-device-select__trigger"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={open && items[activeIndex] ? optionId(activeIndex) : undefined}
                disabled={disabled}
                onClick={() => {
                    activateIndex(Math.max(selectedIndex, 0));
                    onToggle();
                }}
                onKeyDown={handleKeyDown}
            >
                <span className="oj-device-select__label">
                    {selected ? selected.label : placeholder}
                </span>
                {selected?.lowLatency && <LowLatencyMark className="oj-device-select__trigger-bolt" />}
                <IconChevronDown size={14} className="oj-device-select__caret" aria-hidden="true" />
            </button>

            {open && (
                <Surface
                    id={listId}
                    elevation="overlay"
                    radius="md"
                    className="oj-device-select__list"
                    role="listbox"
                    aria-label={ariaLabel}
                >
                    {items.map((item, index) => {
                        const isSelected = item.id === value;
                        const isActive = index === activeIndex;
                        return (
                            <button
                                id={optionId(index)}
                                key={item.id}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                aria-selected={isSelected}
                                className={[
                                    'oj-device-select__option',
                                    isSelected && 'is-selected',
                                    isActive && 'is-active',
                                ].filter(Boolean).join(' ')}
                                onPointerMove={() => activateIndex(index)}
                                onClick={() => {
                                    activateIndex(index);
                                    onSelect(item.id);
                                }}
                            >
                                <span className="oj-device-select__label">{item.label}</span>
                                {item.lowLatency && <LowLatencyMark className="oj-device-select__option-bolt" />}
                            </button>
                        );
                    })}
                </Surface>
            )}
        </div>
    );
}

function LowLatencyMark({ className }: { className: string }) {
    return (
        <span className={['oj-device-select__latency', className].join(' ')}>
            <IconBolt size={13} aria-hidden="true" />
            <span>low latency</span>
        </span>
    );
}
