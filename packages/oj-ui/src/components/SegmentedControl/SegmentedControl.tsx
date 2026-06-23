import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import './SegmentedControl.css';

/** One selectable segment: a stable `value` and its rendered `label`. */
export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
    /** The selectable segments, in display order. */
    options: SegmentedOption<T>[];
    /** The currently-selected value (controlled). */
    value: T;
    /** Fired with the next value when a segment is chosen. */
    onChange: (value: T) => void;
    /**
     * Lay the segments out left-to-right (`horizontal`, default — the channel
     * toggle it replaces) or top-to-bottom (`vertical` — the Settings sidebar).
     */
    orientation?: 'horizontal' | 'vertical';
    /**
     * Greys the whole control and blocks interaction (clicks + keys). Mirrors
     * `Toggle`'s `disabled` — used when a choice is frozen (e.g. the release
     * channel while an update is pinned after a rollback).
     */
    disabled?: boolean;
    /** Required accessible name for the group (the control has no visible label). */
    'aria-label': string;
    /** Extra class names, merged after the base/orientation classes. */
    className?: string;
}

/**
 * A segmented selector — a row (or column) of sketch buttons where exactly one
 * is active. Rendered as a `tablist` of `tab`s with roving tabindex: the active
 * segment is in the tab order, and Arrow/Home/End move *and* select between
 * segments (automatic activation, the standard tablist pattern) so the control
 * is fully keyboard-operable — a hard requirement on a live instrument. The
 * active segment inks with the accent fill; selection is the only feedback —
 * segments never move on hover or press (DESIGN.md No-Surprise). Theme-agnostic:
 * styled entirely via semantic CSS variables. Replaces `.minimal-tab-btn` and
 * `.oj-upd-seg`.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    orientation = 'horizontal',
    disabled = false,
    'aria-label': ariaLabel,
    className,
}: SegmentedControlProps<T>) {
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);

    const classes = [
        'oj-seg',
        orientation === 'vertical' && 'oj-seg--vertical',
        disabled && 'is-disabled',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    const selectAt = (index: number) => {
        const next = options[index];
        if (!next) return;
        onChange(next.value);
        buttons.current[index]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled || options.length === 0) return;
        const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
        const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
        const current = Math.max(0, options.findIndex(option => option.value === value));

        if (event.key === forward) {
            event.preventDefault();
            selectAt((current + 1) % options.length);
        } else if (event.key === backward) {
            event.preventDefault();
            selectAt((current - 1 + options.length) % options.length);
        } else if (event.key === 'Home') {
            event.preventDefault();
            selectAt(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            selectAt(options.length - 1);
        }
    };

    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            aria-orientation={orientation}
            className={classes}
            onKeyDown={handleKeyDown}
        >
            {options.map((option, index) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        ref={element => {
                            buttons.current[index] = element;
                        }}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
                        disabled={disabled}
                        className={selected ? 'oj-seg__btn is-active' : 'oj-seg__btn'}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export type TabsProps<T extends string> = Omit<SegmentedControlProps<T>, 'orientation'>;

/**
 * A thin vertical `SegmentedControl` — the Settings-sidebar layout. Same
 * implementation, orientation locked to `vertical`.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
    return <SegmentedControl {...props} orientation="vertical" />;
}
