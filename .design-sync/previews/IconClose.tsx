import { IconClose } from '@openjammer/oj-ui';

/** IconClose at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconClose size={16} />
        <IconClose size={24} />
        <IconClose size={32} />
        <IconClose size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconClose size={32} title="IconClose" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconClose size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconClose size={32} /></span>
    </div>
);
