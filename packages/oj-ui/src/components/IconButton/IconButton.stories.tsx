import type { Story } from '@ladle/react';
import { IconButton } from './IconButton';
import { IconClose, IconDownload, IconMute, IconSpeaker } from '../Icons/Icons';

export default { title: 'Composites/IconButton' };

export const Variants: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Close" icon={<IconClose />} />
        <IconButton label="Download" variant="node" icon={<IconDownload />} />
        <IconButton label="Children glyph">✕</IconButton>
    </div>
);

export const Toggle: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Live output" icon={<IconSpeaker />} />
        <IconButton label="Muted output" active icon={<IconMute />} />
    </div>
);

export const Disabled: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Close" icon={<IconClose />} />
        <IconButton label="Close (disabled)" disabled icon={<IconClose />} />
    </div>
);
