import { IconMute } from '@openjammer/oj-ui';

/** IconMute at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconMute size={16} />
        <IconMute size={24} />
        <IconMute size={32} />
        <IconMute size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconMute size={32} title="IconMute" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconMute size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconMute size={32} /></span>
    </div>
);
