import { IconButton } from '@openjammer/oj-ui';
import { IconClose, IconDownload, IconMute, IconSpeaker } from '@openjammer/oj-ui';

export const Variants = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Close" icon={<IconClose />} />
        <IconButton label="Download" variant="node" icon={<IconDownload />} />
        <IconButton label="Children glyph">✕</IconButton>
    </div>
);

export const Toggle = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Live output" icon={<IconSpeaker />} />
        <IconButton label="Muted output" active icon={<IconMute />} />
    </div>
);

export const Disabled = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <IconButton label="Close" icon={<IconClose />} />
        <IconButton label="Close (disabled)" disabled icon={<IconClose />} />
    </div>
);
