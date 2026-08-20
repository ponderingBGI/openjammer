import { useState } from 'react';
import type { ReactNode } from 'react';
import { ParamRow, SegmentedControl } from '@openjammer/oj-ui';

/** ParamRow is a node-panel row — narrow, stacked, label + readout over the slider. */
const panel = (children: ReactNode) => (
    <div
        style={{
            width: 264,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
            padding: 'var(--space-md)',
            background: 'var(--bg-node)',
            border: 'var(--border-sketch-width) solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
        }}
    >
        {children}
    </div>
);

function Param({
    label,
    initial,
    min,
    max,
    step,
    format,
    ...rest
}: {
    label: string;
    initial: number;
    min: number;
    max: number;
    step?: number;
    format: (value: number) => string;
    driven?: boolean;
    pinned?: boolean;
    readOnly?: boolean;
}) {
    const [value, setValue] = useState(initial);
    return (
        <ParamRow
            label={label}
            value={value}
            valueText={format(value)}
            min={min}
            max={max}
            step={step}
            onChange={setValue}
            {...rest}
        />
    );
}

/** The everyday case: a filter node's parameters, each with a formatted readout. */
export const Default = () => panel(
    <>
        <Param label="Cutoff" initial={2400} min={20} max={12000} step={10} format={(v) => `${v.toFixed(0)} Hz`} />
        <Param label="Resonance" initial={0.32} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Param label="Drive" initial={-4.5} min={-24} max={12} step={0.5} format={(v) => `${v.toFixed(1)} dB`} />
    </>,
);

/**
 * The row's states: `pinned` marks the label (⌐), `driven` underlines a value an
 * automation lane is writing, `readOnly` drops the slider and leaves the readout.
 */
export const States = () => panel(
    <>
        <Param label="Level" initial={0.78} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} pinned />
        <Param label="Pan" initial={-0.25} min={-1} max={1} step={0.01} format={(v) => (v === 0 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)} driven />
        <Param label="Sample rate" initial={48000} min={8000} max={96000} format={() => '48 000 Hz'} readOnly />
    </>,
);

/** `control` swaps the slider out when the parameter isn't a continuous range. */
export const CustomControl = () => panel(
    <ParamRow
        label="Oversample"
        value={2}
        valueText="4×"
        min={0}
        max={2}
        control={
            <SegmentedControl
                aria-label="Oversample"
                value="4x"
                onChange={() => {}}
                options={[
                    { value: '1x', label: '1×' },
                    { value: '2x', label: '2×' },
                    { value: '4x', label: '4×' },
                ]}
            />
        }
    />,
);
