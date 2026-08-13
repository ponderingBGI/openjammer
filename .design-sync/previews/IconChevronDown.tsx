import { IconChevronDown } from '@openjammer/oj-ui';

/** IconChevronDown at the sizes the UI uses — 16 (inline), 24, 32, 48 — plus an
 *  accessible instance with a title. Inherits color via currentColor. */
export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', color: 'var(--text-primary)' }}>
        <IconChevronDown size={16} />
        <IconChevronDown size={24} />
        <IconChevronDown size={32} />
        <IconChevronDown size={48} />
    </div>
);

export const Accent = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-primary)' }}><IconChevronDown size={32} title="IconChevronDown" /></span>
        <span style={{ color: 'var(--audio-output)' }}><IconChevronDown size={32} /></span>
        <span style={{ color: 'var(--accent-danger)' }}><IconChevronDown size={32} /></span>
    </div>
);
