import { Surface } from '@openjammer/oj-ui';

const demoStyle = {
    padding: 'var(--space-md)',
    fontFamily: 'var(--font-sketch)',
    color: 'var(--text-primary)',
    minWidth: '160px',
};

export const Elevations = () => (
    <div
        style={{
            display: 'flex',
            gap: 'var(--space-xl)',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            padding: 'var(--space-lg)',
        }}
    >
        <Surface elevation="rest" style={demoStyle}>
            Rest
        </Surface>
        <Surface elevation="menu" style={demoStyle}>
            Menu
        </Surface>
        <Surface elevation="lifted" style={demoStyle}>
            Lifted
        </Surface>
    </div>
);

export const Radii = () => (
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
