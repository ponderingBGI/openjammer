import type { Story } from '@ladle/react';
import { Marquee } from './Marquee';

export default { title: 'Primitives/Marquee' };

export const Default: Story = () => (
    <div
        style={{
            position: 'relative',
            width: 360,
            height: 220,
            background: 'var(--bg-canvas)',
            border: 'var(--border-sketch-width) solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
        }}
    >
        <Marquee x={40} y={32} width={180} height={120} />
    </div>
);

export const Sizes: Story = () => (
    <div
        style={{
            position: 'relative',
            width: 360,
            height: 220,
            background: 'var(--bg-canvas)',
            border: 'var(--border-sketch-width) solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
        }}
    >
        <Marquee x={16} y={16} width={90} height={60} />
        <Marquee x={140} y={48} width={200} height={150} />
        <Marquee x={24} y={120} width={70} height={70} />
    </div>
);
