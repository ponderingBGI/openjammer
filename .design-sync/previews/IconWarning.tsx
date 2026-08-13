import { IconWarning } from '@openjammer/oj-ui';

/** IconWarning at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconWarning size={16} />
        <IconWarning size={24} />
        <IconWarning size={32} />
        <IconWarning size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconWarning size={32} title="IconWarning" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconWarning size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconWarning size={32} /></span>
    </div>
);
