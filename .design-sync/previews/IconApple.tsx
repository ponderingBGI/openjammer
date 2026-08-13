import { IconApple } from '@openjammer/oj-ui';

/** IconApple at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconApple size={16} />
        <IconApple size={24} />
        <IconApple size={32} />
        <IconApple size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconApple size={32} title="IconApple" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconApple size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconApple size={32} /></span>
    </div>
);
