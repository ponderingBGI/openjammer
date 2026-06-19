import { useRef, useState } from 'react';
import type { Story } from '@ladle/react';
import { ValueScrubber } from './ValueScrubber';

export default { title: 'Composites/ValueScrubber' };

/** Click the value to type a new number; Enter/blur commits, Escape reverts. */
export const Editable: Story = () => {
    const [gain, setGain] = useState(0.75);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <ValueScrubber
                label="Gain"
                value={gain}
                display={`${gain.toFixed(2)} dB`}
                onCommit={setGain}
            />
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                committed: {gain}
            </span>
        </div>
    );
};

/**
 * Scrubbing is wired by the PARENT: it attaches onPointerDown/onWheel (spread
 * onto the display span). Here a tiny wheel handler nudges the value to show the
 * contract — ValueScrubber imports no scroll/wheel hook itself.
 */
export const ParentWiredScrub: Story = () => {
    const [freq, setFreq] = useState(440);
    const dragging = useRef(false);
    const lastX = useRef(0);

    return (
        <ValueScrubber
            label="Freq"
            value={freq}
            display={`${freq.toFixed(0)} Hz`}
            onCommit={setFreq}
            onWheel={(e) => {
                e.preventDefault();
                setFreq((f) => Math.max(20, Math.round(f - Math.sign(e.deltaY) * 5)));
            }}
            onPointerDown={(e) => {
                dragging.current = true;
                lastX.current = e.clientX;
                e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (!dragging.current) return;
                const dx = e.clientX - lastX.current;
                lastX.current = e.clientX;
                setFreq((f) => Math.max(20, Math.round(f + dx)));
            }}
            onPointerUp={() => {
                dragging.current = false;
            }}
        />
    );
};

/** Read-only (not editable) and disabled — no scrub cursor, no editor. */
export const ReadOnlyAndDisabled: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <ValueScrubber label="BPM" value={120} display="120.0" editable={false} onCommit={() => {}} />
        <ValueScrubber label="Mix" value={0.5} display="50%" disabled onCommit={() => {}} />
    </div>
);
