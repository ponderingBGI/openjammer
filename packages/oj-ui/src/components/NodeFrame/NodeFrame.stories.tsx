import type { Story } from '@ladle/react';
import { NodeFrame } from './NodeFrame';
import { NodeShell } from '../NodeShell/NodeShell';

export default { title: 'Composites/NodeFrame' };

const canvas = (children: React.ReactNode) => (
    <div
        style={{
            position: 'relative',
            height: 360,
            background: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
        }}
    >
        {children}
    </div>
);

export const Placed: Story = () =>
    canvas(
        <NodeFrame position={{ x: 40, y: 32 }}>
            <NodeShell title="Reverb" nodeType="effect">
                A node placed by NodeFrame.
            </NodeShell>
        </NodeFrame>,
    );

export const Dragging: Story = () =>
    canvas(
        <NodeFrame position={{ x: 60, y: 48 }} dragging>
            <NodeShell title="Delay" nodeType="effect" dragging>
                Mid-drag — the frame shows the grabbing cursor.
            </NodeShell>
        </NodeFrame>,
    );

export const Stacked: Story = () =>
    canvas(
        <>
            <NodeFrame position={{ x: 24, y: 24 }}>
                <NodeShell title="Keyboard" nodeType="input">
                    Sends notes.
                </NodeShell>
            </NodeFrame>
            <NodeFrame position={{ x: 220, y: 120 }}>
                <NodeShell title="Piano" nodeType="instrument" selected>
                    Makes sound.
                </NodeShell>
            </NodeFrame>
        </>,
    );
