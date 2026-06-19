import type { Story } from '@ladle/react';
import {
    IconClose,
    IconChevronDown,
    IconChevronRight,
    IconMute,
    IconSpeaker,
    IconDownload,
    IconBolt,
    IconCheck,
    IconWarning,
    IconWindows,
    IconApple,
    IconLinux,
} from './Icons';

export default { title: 'Primitives/Icons' };

const ICONS = [
    ['IconClose', IconClose],
    ['IconChevronDown', IconChevronDown],
    ['IconChevronRight', IconChevronRight],
    ['IconMute', IconMute],
    ['IconSpeaker', IconSpeaker],
    ['IconDownload', IconDownload],
    ['IconBolt', IconBolt],
    ['IconCheck', IconCheck],
    ['IconWarning', IconWarning],
    ['IconWindows', IconWindows],
    ['IconApple', IconApple],
    ['IconLinux', IconLinux],
] as const;

export const Grid: Story = () => (
    <div
        style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 'var(--space-md)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
        }}
    >
        {ICONS.map(([name, IconComp]) => (
            <div
                key={name}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-md)',
                    border: 'var(--border-sketch-width) solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)',
                }}
            >
                <IconComp size={24} title={name} />
                <span style={{ color: 'var(--text-muted)' }}>{name}</span>
            </div>
        ))}
    </div>
);

export const Sizes: Story = () => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-md)',
            color: 'var(--accent-primary)',
        }}
    >
        <IconBolt size={12} title="12px" />
        <IconBolt size={16} title="16px" />
        <IconBolt size={24} title="24px" />
        <IconBolt size={32} title="32px" />
    </div>
);

export const InheritsColor: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent-success)' }}>
            <IconCheck size={20} title="Done" />
        </span>
        <span style={{ color: 'var(--accent-warning)' }}>
            <IconWarning size={20} title="Warning" />
        </span>
        <span style={{ color: 'var(--accent-danger)' }}>
            <IconClose size={20} title="Error" />
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
            <IconMute size={20} title="Muted" />
        </span>
    </div>
);
