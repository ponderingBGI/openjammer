import { Button } from '@openjammer/oj-ui';

export const Variants = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button>Node</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="success">Success</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="success" active>
            ● Armed
        </Button>
        <Button iconOnly aria-label="Close">
            ✕
        </Button>
    </div>
);

export const States = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Button variant="primary">Enabled</Button>
        <Button variant="primary" disabled>
            Disabled
        </Button>
    </div>
);
