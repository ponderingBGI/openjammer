import { NodeFrame } from '@openjammer/oj-ui';
import { NodeShell } from '@openjammer/oj-ui';

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

export const Placed = () =>
    canvas(
        <NodeFrame position={{ x: 40, y: 32 }}>
            <NodeShell title="Reverb" nodeType="effect">
                A node placed by NodeFrame.
            </NodeShell>
        </NodeFrame>,
    );

export const Dragging = () =>
    canvas(
        <NodeFrame position={{ x: 60, y: 48 }} dragging>
            <NodeShell title="Delay" nodeType="effect" dragging>
                Mid-drag — the frame shows the grabbing cursor.
            </NodeShell>
        </NodeFrame>,
    );

export const Stacked = () =>
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
