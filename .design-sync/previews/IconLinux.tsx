import { IconLinux } from '@openjammer/oj-ui';

/** IconLinux at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconLinux size={16} />
        <IconLinux size={24} />
        <IconLinux size={32} />
        <IconLinux size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconLinux size={32} title="IconLinux" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconLinux size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconLinux size={32} /></span>
    </div>
);
