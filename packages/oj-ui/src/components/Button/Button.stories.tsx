import type { CSSProperties } from 'react';
import type { Story } from '@ladle/react';
import { Button } from './Button';

export default { title: 'Primitives/Button' };

const row: CSSProperties = {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    alignItems: 'center',
};

export const Variants: Story = () => (
    <div style={row}>
        <Button>Node</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="success">Success</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button active>● Armed</Button>
        <Button iconOnly aria-label="Close">
            ✕
        </Button>
    </div>
);

export const States: Story = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={row}>
            <Button variant="primary">Enabled</Button>
            <Button variant="primary" disabled>
                Disabled
            </Button>
            <Button variant="primary" loading>
                Rendering
            </Button>
        </div>
        <div style={row}>
            <Button>Enabled</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Scanning</Button>
        </div>
        <div style={row}>
            <Button variant="danger">Delete</Button>
            <Button variant="danger" disabled>
                Delete
            </Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="ghost" disabled>
                Ghost
            </Button>
        </div>
    </div>
);

/**
 * The loading button keeps its label's exact width — nothing on the toolbar
 * reflows while work is in flight.
 */
export const Loading: Story = () => (
    <div style={row}>
        <Button variant="primary">Export</Button>
        <Button variant="primary" loading>
            Export
        </Button>
    </div>
);
