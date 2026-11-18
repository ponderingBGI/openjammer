import { useState, type CSSProperties } from 'react';
import type { Story } from '@ladle/react';
import { Knob } from './Knob';

export default { title: 'Primitives/Knob' };

const row: CSSProperties = {
    display: 'flex',
    gap: 'var(--space-xl)',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
};

function Dial({
    label,
    initial,
    min,
    max,
    log = false,
    format,
    size,
    disabled = false,
    defaultValue,
}: {
    label: string;
    initial: number;
    min: number;
    max: number;
    log?: boolean;
    format?: (v: number) => string;
    size?: number;
    disabled?: boolean;
    defaultValue?: number;
}) {
    const [value, setValue] = useState(initial);
    /* `exactOptionalPropertyTypes` is on in this package: an optional prop is
       either present with a value or absent, never explicitly `undefined`. */
    const optional = {
        ...(size === undefined ? {} : { size }),
        ...(format === undefined ? {} : { format }),
        ...(defaultValue === undefined ? {} : { defaultValue }),
    };
    return (
        <Knob
            {...optional}
            label={label}
            value={value}
            min={min}
            max={max}
            log={log}
            disabled={disabled}
            onChange={setValue}
        />
    );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);

/**
 * Drag vertically — 150px is the whole range. Hold Shift for a tenth of that,
 * double-click to return to the default, or focus the dial and use the arrows,
 * PageUp/PageDown, Home/End and the wheel.
 */
export const States: Story = () => (
    <div style={row}>
        <Dial label="LEVEL" initial={0.75} min={0} max={1} format={pct} defaultValue={0.75} />
        <Dial label="CUTOFF" initial={1200} min={20} max={20000} log format={hz} defaultValue={1200} />
        <Dial label="MIX" initial={0.3} min={0} max={1} format={pct} disabled />
        <Dial label="RES" initial={0.4} min={0} max={1} format={pct} size={34} />
    </div>
);

/** Linear vs logarithmic at the same normalised position — the sweep is identical. */
export const LinearVsLog: Story = () => (
    <div style={row}>
        <Dial label="LINEAR" initial={10010} min={20} max={20000} format={hz} />
        <Dial label="LOG" initial={632.5} min={20} max={20000} log format={hz} />
    </div>
);

/** The full sweep, -135° to +135°, frozen at five positions. */
export const Sweep: Story = () => (
    <div style={row}>
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
            <Knob
                key={n}
                label={`${n * 100}%`}
                value={n}
                min={0}
                max={1}
                format={pct}
                onChange={() => {}}
            />
        ))}
    </div>
);

/** Sizes: the 52px panel dial and the 34px canvas dial are one object. */
export const Sizes: Story = () => (
    <div style={row}>
        <Dial label="52" initial={0.6} min={0} max={1} format={pct} />
        <Dial label="42" initial={0.6} min={0} max={1} format={pct} size={42} />
        <Dial label="34" initial={0.6} min={0} max={1} format={pct} size={34} />
    </div>
);
