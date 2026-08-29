import type { Story } from '@ladle/react';
import { KeyTile } from './KeyTile';

export default { title: 'Composites/KeyTile' };

export const Variants: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <KeyTile variant="white" label="C" />
        <KeyTile variant="black" label="C#" />
        <KeyTile variant="key" label="C4" hint="A" />
        <KeyTile variant="pad" label="Kick" />
        <KeyTile variant="pad" label="34" size={34} />
    </div>
);

export const States: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <KeyTile variant="key" label="C4" hint="A" />
        <KeyTile variant="key" label="D4" hint="S" active />
        <KeyTile variant="key" label="E4" hint="D" connected />
        <KeyTile variant="pad" label="hit" active connected />
        <KeyTile variant="pad" label="off" disabled />
    </div>
);

/** A small piano octave assembled from white and black keys. */
export const PianoOctave: Story = () => (
    <div style={{ position: 'relative', display: 'flex', gap: 'var(--space-xs)' }}>
        <KeyTile variant="white" label="C" />
        <KeyTile variant="white" label="D" active />
        <KeyTile variant="white" label="E" />
        <KeyTile variant="white" label="F" />
        <KeyTile variant="white" label="G" connected />
        <KeyTile variant="white" label="A" />
        <KeyTile variant="white" label="B" />
    </div>
);

/** A drum-pad grid, the MIDIVisual pad layout. */
export const PadGrid: Story = () => (
    <div
        style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, max-content)',
            gap: 'var(--space-sm)',
        }}
    >
        {Array.from({ length: 8 }, (_, i) => (
            <KeyTile key={i} variant="pad" label={`P${i + 1}`} active={i === 2} connected={i === 5} />
        ))}
    </div>
);

/**
 * Exactly what KeyboardVisualNode renders: `variant="key"` with an inline
 * 50x50 (and 300x50 spacebar) override and no hint chip. The socket keeps its
 * own reserved band here too, so the letter stays readable.
 */
export const Inline50: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <KeyTile variant="key" label="C4" style={{ width: 50, height: 50 }} />
        <KeyTile variant="key" label="D4" active style={{ width: 50, height: 50 }} />
        <KeyTile variant="key" label="SPACE" style={{ width: 300, height: 50 }} />
    </div>
);
