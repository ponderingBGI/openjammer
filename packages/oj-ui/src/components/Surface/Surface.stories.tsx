import type { Story } from '@ladle/react';
import { Surface } from './Surface';

export default { title: 'Primitives/Surface' };

const demoStyle = {
    padding: 'var(--space-md)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)',
    minWidth: '160px',
};

export const Elevations: Story = () => (
    <div
        style={{
            display: 'flex',
            gap: 'var(--space-xl)',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            padding: 'var(--space-lg)',
        }}
    >
        <Surface elevation="raised" style={demoStyle}>
            Raised
        </Surface>
        <Surface elevation="overlay" style={demoStyle}>
            Overlay
        </Surface>
    </div>
);

export const Radii: Story = () => (
    <div
        style={{
            display: 'flex',
            gap: 'var(--space-xl)',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            padding: 'var(--space-lg)',
        }}
    >
        <Surface radius="md" style={demoStyle}>
            Radius md
        </Surface>
        <Surface radius="lg" style={demoStyle}>
            Radius lg
        </Surface>
        <Surface radius="xl" style={demoStyle}>
            Radius xl
        </Surface>
    </div>
);
