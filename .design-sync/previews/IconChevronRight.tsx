import { IconChevronRight } from '@openjammer/oj-ui';

/** IconChevronRight at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconChevronRight size={16} />
        <IconChevronRight size={24} />
        <IconChevronRight size={32} />
        <IconChevronRight size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconChevronRight size={32} title="IconChevronRight" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconChevronRight size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconChevronRight size={32} /></span>
    </div>
);
