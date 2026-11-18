import type { Story } from '@ladle/react';
import { Select } from './Select';

export default { title: 'Primitives/Select' };

const stack = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-md)',
    maxWidth: 320,
};

const options = (
    <>
        <option value="default">System default</option>
        <option value="focusrite">Focusrite Scarlett 2i2</option>
        <option value="builtin">Built-in Output</option>
    </>
);

export const States: Story = () => (
    <div style={stack}>
        <Select defaultValue="default" aria-label="Output device">
            {options}
        </Select>
        <Select defaultValue="focusrite" aria-label="Output device (chosen)">
            {options}
        </Select>
        <Select defaultValue="default" disabled aria-label="Output device (disabled)">
            {options}
        </Select>
    </div>
);
