import type { ReactNode } from 'react';
import type { Story } from '@ladle/react';
import { Waveform } from './Waveform';

export default { title: 'Composites/Waveform' };

/** A bipolar buffer (-1..1) — a few cycles of a decaying sine. */
const bipolar = Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    return Math.sin(t * Math.PI * 12) * (1 - t * 0.7);
});

/** A unipolar envelope (0..1) — peaks rising then tailing off. */
const unipolar = Array.from({ length: 64 }, (_, i) => {
    const t = i / 63;
    return Math.abs(Math.sin(t * Math.PI * 5)) * (1 - t * 0.5);
});

const frame = (label: string, children: ReactNode) => (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
        <div
            style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-xs)',
            }}
        >
            {label}
        </div>
        <div
            style={{
                width: 360,
                padding: 'var(--space-sm)',
                background: 'var(--bg-node)',
                border: 'var(--border-sketch-width) solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
            }}
        >
            {children}
        </div>
    </div>
);

export const Default: Story = () => (
    <div style={{ maxWidth: 420 }}>
        {frame(
            'bipolar buffer + center line',
            <Waveform data={bipolar} showCenterLine aria-label="Loop buffer" />,
        )}
        {frame(
            'with playhead at 0.4',
            <Waveform data={bipolar} playhead={0.4} showCenterLine aria-label="Playing loop" />,
        )}
        {frame(
            'recording (danger tint)',
            <Waveform data={bipolar} recording aria-label="Recording" />,
        )}
        {frame(
            'unipolar peaks (0..1 envelope)',
            <Waveform data={unipolar} aria-label="Sample peaks" />,
        )}
    </div>
);

export const Heights: Story = () => (
    <div style={{ maxWidth: 420 }}>
        {frame('height 24', <Waveform data={bipolar} height={24} showCenterLine />)}
        {frame('height 48 (default)', <Waveform data={bipolar} showCenterLine />)}
        {frame('height 96', <Waveform data={bipolar} height={96} showCenterLine />)}
    </div>
);

export const Empty: Story = () => (
    <div style={{ maxWidth: 420 }}>
        {frame('no samples yet (empty buffer)', <Waveform data={[]} showCenterLine />)}
    </div>
);
