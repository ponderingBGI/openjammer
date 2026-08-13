import { IconCheck } from '@openjammer/oj-ui';

/** IconCheck at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconCheck size={16} />
        <IconCheck size={24} />
        <IconCheck size={32} />
        <IconCheck size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconCheck size={32} title="IconCheck" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconCheck size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconCheck size={32} /></span>
    </div>
);
