import { IconWindows } from '@openjammer/oj-ui';

/** IconWindows at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconWindows size={16} />
        <IconWindows size={24} />
        <IconWindows size={32} />
        <IconWindows size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconWindows size={32} title="IconWindows" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconWindows size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconWindows size={32} /></span>
    </div>
);
