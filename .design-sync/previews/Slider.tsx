import { useState } from 'react';
import { Slider } from '@openjammer/oj-ui';

function Demo({
    label,
    initial = 50,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
}: {
    label: string;
    initial?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
}) {
    const [value, setValue] = useState(initial);
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <span style={{ fontFamily: 'var(--font-sketch)', color: 'var(--text-secondary)' }}>
                {label}
            </span>
            <Slider
                aria-label={label}
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={setValue}
            />
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {value}
            </span>
        </label>
    );
}

export const States = () => (
    <div
        style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-lg)',
            maxWidth: '320px',
        }}
    >
        <Demo label="Default 0–100" />
        <Demo label="Gain (dB)" initial={-6} min={-60} max={6} step={0.5} />
        <Demo label="Fine step" initial={0.25} min={0} max={1} step={0.01} />
        <Demo label="Disabled" initial={70} disabled />
    </div>
);
