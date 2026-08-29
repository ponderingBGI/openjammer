import type { Story } from '@ladle/react';
import { Swatch } from './Swatch';

export default { title: 'Primitives/Swatch' };

export const Gallery: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Swatch bg="#F4F3F0" node="#FFFFFF" name="Light" selected />
        <Swatch bg="#161510" node="#201F19" name="Dark" />
    </div>
);

export const States: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Swatch bg="#F4F3F0" node="#FFFFFF" name="Unselected" />
        <Swatch bg="#F4F3F0" node="#FFFFFF" name="Selected" selected />
    </div>
);
