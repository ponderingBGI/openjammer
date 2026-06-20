import type { Story } from '@ladle/react';
import { Swatch } from './Swatch';

export default { title: 'Primitives/Swatch' };

export const Gallery: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Swatch bg="#faf6ef" node="#ffffff" name="Sketchbook" selected />
        <Swatch bg="#1c1c1c" node="#2b2b2b" name="Midnight" />
        <Swatch bg="#0a1f2b" node="#13384a" name="Deep Sea" />
        <Swatch bg="#fdf0e6" node="#fff7f0" name="Sunrise" />
    </div>
);

export const States: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        <Swatch bg="#faf6ef" node="#ffffff" name="Unselected" />
        <Swatch bg="#faf6ef" node="#ffffff" name="Selected" selected />
    </div>
);
