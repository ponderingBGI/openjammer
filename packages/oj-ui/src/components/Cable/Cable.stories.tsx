import type { Story } from '@ladle/react';
import { Cable } from './Cable';
import type { CableKind } from './Cable';

export default { title: 'Composites/Cable' };

/** A canvas-like SVG overlay so the cables have somewhere to live. */
function Stage({ children }: { children: React.ReactNode }) {
    return (
        <svg
            width={360}
            height={220}
            style={{
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
            }}
        >
            {children}
        </svg>
    );
}

export const Kinds: Story = () => {
    const kinds: CableKind[] = ['audio', 'control', 'universal'];
    return (
        <Stage>
            {kinds.map((kind, i) => (
                <Cable
                    key={kind}
                    kind={kind}
                    start={{ x: 30, y: 40 + i * 60 }}
                    end={{ x: 330, y: 40 + i * 60 }}
                />
            ))}
        </Stage>
    );
};

export const SelectedAndBundled: Story = () => (
    <Stage>
        <Cable kind="audio" start={{ x: 30, y: 50 }} end={{ x: 330, y: 50 }} selected />
        <Cable
            kind="audio"
            start={{ x: 30, y: 130 }}
            end={{ x: 330, y: 130 }}
            bundled
            bundleCount={4}
        />
    </Stage>
);

/** Quiet is the resting state of every cable on the canvas: 2.5px, 45%, no
 *  glow. Only the signal formula lights a wire up. */
export const Quiet: Story = () => (
    <Stage>
        <Cable kind="audio" start={{ x: 30, y: 60 }} end={{ x: 330, y: 60 }} />
        <Cable kind="control" start={{ x: 30, y: 110 }} end={{ x: 330, y: 110 }} />
        <Cable kind="universal" start={{ x: 30, y: 160 }} end={{ x: 330, y: 160 }} />
    </Stage>
);

export const SignalLevels: Story = () => (
    <Stage>
        <Cable kind="audio" start={{ x: 30, y: 40 }} end={{ x: 330, y: 40 }} signalLevel={0} />
        <Cable kind="audio" start={{ x: 30, y: 110 }} end={{ x: 330, y: 110 }} signalLevel={0.5} />
        <Cable kind="audio" start={{ x: 30, y: 180 }} end={{ x: 330, y: 180 }} signalLevel={1} />
    </Stage>
);

export const TempDrag: Story = () => (
    <Stage>
        <Cable kind="control" start={{ x: 30, y: 110 }} end={{ x: 280, y: 60 }} temp />
    </Stage>
);

export const Selectable: Story = () => (
    <Stage>
        <Cable
            kind="audio"
            start={{ x: 30, y: 110 }}
            end={{ x: 330, y: 110 }}
            onSelect={() => alert('cable selected')}
        />
    </Stage>
);
