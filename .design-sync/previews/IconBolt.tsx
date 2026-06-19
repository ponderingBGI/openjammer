import { IconBolt } from '@openjammer/oj-ui';

/** IconBolt at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconBolt size={16} />
        <IconBolt size={24} />
        <IconBolt size={32} />
        <IconBolt size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconBolt size={32} title="IconBolt" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconBolt size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconBolt size={32} /></span>
    </div>
);
