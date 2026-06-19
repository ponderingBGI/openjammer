import { IconSpeaker } from '@openjammer/oj-ui';

/** IconSpeaker at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconSpeaker size={16} />
        <IconSpeaker size={24} />
        <IconSpeaker size={32} />
        <IconSpeaker size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconSpeaker size={32} title="IconSpeaker" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconSpeaker size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconSpeaker size={32} /></span>
    </div>
);
