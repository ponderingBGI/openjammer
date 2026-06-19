import type { ReactNode } from 'react';
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
    /** Required accessible name for the group (the control has no visible label). */
    'aria-label': string;
    /** Extra class names, merged after the base/orientation classes. */
    className?: string;
}

/**
 * A segmented selector — a row (or column) of sketch buttons where exactly one
 * is active. Rendered as a `tablist` of `tab`s. The active segment inks with the
 * accent fill; selection is the only feedback — segments never move on hover or
 * press (DESIGN.md No-Surprise). Theme-agnostic: styled entirely via semantic
 * CSS variables. Replaces `.minimal-tab-btn` and `.oj-upd-seg`.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    orientation = 'horizontal',
    'aria-label': ariaLabel,
    className,
}: SegmentedControlProps<T>) {
    const classes = [
        'oj-seg',
        orientation === 'vertical' && 'oj-seg--vertical',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            aria-orientation={orientation}
            className={classes}
        >
            {options.map(option => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
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
