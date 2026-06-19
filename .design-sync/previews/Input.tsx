import { Input } from '@openjammer/oj-ui';

/** Text input — placeholder, filled, numeric, and disabled. */
export const Variants = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 240 }}>
        <Input placeholder="Search nodes…" />
        <Input defaultValue="Sunset session" />
        <Input type="number" defaultValue={120} />
        <Input placeholder="Disabled" disabled />
    </div>
);
