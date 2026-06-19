import { IconDownload } from '@openjammer/oj-ui';

/** IconDownload at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconDownload size={16} />
        <IconDownload size={24} />
        <IconDownload size={32} />
        <IconDownload size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconDownload size={32} title="IconDownload" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconDownload size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconDownload size={32} /></span>
    </div>
);
