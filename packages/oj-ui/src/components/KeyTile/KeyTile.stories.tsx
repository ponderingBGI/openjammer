import type { Story } from '@ladle/react';
import { KeyTile } from './KeyTile';

export default { title: 'Composites/KeyTile' };

export const Variants: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <KeyTile variant="white" label="C" />
        <KeyTile variant="black" label="C#" />
        <KeyTile variant="key" label="A" />
        <KeyTile variant="pad" label="Kick" />
    </div>
);

export const States: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <KeyTile variant="key" label="rest" />
        <KeyTile variant="key" label="lit" active />
        <KeyTile variant="key" label="wired" connected />
        <KeyTile variant="pad" label="hit" active connected />
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
