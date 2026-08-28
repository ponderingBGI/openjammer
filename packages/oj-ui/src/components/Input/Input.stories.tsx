import type { Story } from '@ladle/react';
import { Input } from './Input';

export default { title: 'Primitives/Input' };

const stack = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-md)',
    maxWidth: 320,
};

export const States: Story = () => (
    <div style={stack}>
        <Input placeholder="Search plugins…" />
        <Input defaultValue="Warm Pad" />
        <Input defaultValue="Focus me" autoFocus />
        <Input defaultValue="Not a number" aria-invalid="true" />
        <Input defaultValue="Read only" readOnly />
        <Input defaultValue="Disabled" disabled />
    </div>
);

/**
 * Mono-Means-Exact: prose fields are Outfit, exact values keep JetBrains with
 * tabular figures so digits line up as they change.
 */
export const MonoForExactValues: Story = () => (
    <div style={stack}>
        <Input defaultValue="Bass — take 3" aria-label="Clip name" />
        <Input mono type="number" defaultValue="440" aria-label="Frequency" />
        <Input mono defaultValue="-6.00 dB" aria-label="Gain" />
    </div>
);
