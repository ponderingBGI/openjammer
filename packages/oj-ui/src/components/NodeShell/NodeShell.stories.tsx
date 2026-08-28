import type { Story } from '@ladle/react';
import { NodeShell } from './NodeShell';
import { PortRow } from '../PortRow/PortRow';

export default { title: 'Composites/NodeShell' };

const stage: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-lg)',
    padding: 'var(--space-lg)',
    background: 'var(--bg-canvas)',
    backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
    borderRadius: 'var(--radius-lg)',
};

/** A stand-in for whatever faceplate a real node puts under its port row. */
function Body({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center',
                gap: '4px 10px',
                font: "500 13px var(--font-sans)",
                color: 'var(--text-secondary)',
            }}
        >
            {children}
        </div>
    );
}

function Param({ label, value }: { label: string; value: string }) {
    return (
        <>
            <span>{label}</span>
            <span
                style={{
                    font: '500 12px var(--font-mono)',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-tertiary)',
                    padding: '3px 7px',
                    borderRadius: 'var(--radius-sm)',
                }}
            >
                {value}
            </span>
        </>
    );
}

const inputs = (connected = false) => (
    <PortRow side="input" kind="audio" label="In" connected={connected} />
);
const outputs = (connected = false) => (
    <PortRow side="output" kind="audio" label="Out" connected={connected} />
);

export const Card: Story = () => (
    <div style={stage}>
        <NodeShell title="Reverb" nodeType="effect" inputs={inputs(true)} outputs={outputs()}>
            <Body>
                <Param label="Mix" value="42%" />
                <Param label="Decay" value="2.4 s" />
            </Body>
        </NodeShell>
    </div>
);

export const States: Story = () => (
    <div style={stage}>
        <NodeShell title="Rest" nodeType="effect" inputs={inputs()} outputs={outputs()}>
            <Body><Param label="Mix" value="42%" /></Body>
        </NodeShell>
        <NodeShell title="Selected" nodeType="effect" selected inputs={inputs()} outputs={outputs()}>
            <Body><Param label="Mix" value="42%" /></Body>
        </NodeShell>
        <NodeShell title="Dragging" nodeType="effect" dragging inputs={inputs()} outputs={outputs()}>
            <Body><Param label="Mix" value="42%" /></Body>
        </NodeShell>
        <NodeShell
            title="Agent built"
            nodeType="effect"
            agentPending
            inputs={inputs()}
            outputs={outputs()}
        >
            <Body><Param label="Mix" value="42%" /></Body>
        </NodeShell>
    </div>
);

/** Several inputs against one output: the two groups mirror across the body. */
export const ManyPorts: Story = () => (
    <div style={stage}>
        <NodeShell
            title="Mixer"
            nodeType="utility"
            inputs={[
                <PortRow key="a" side="input" kind="audio" label="A" connected />,
                <PortRow key="b" side="input" kind="audio" label="B" />,
                <PortRow key="g" side="input" kind="control" label="Gate" />,
            ]}
            outputs={<PortRow side="output" kind="audio" label="Sum" connected />}
        >
            <Body><Param label="Level" value="0.0 dB" /></Body>
        </NodeShell>
    </div>
);

export const NoPorts: Story = () => (
    <div style={stage}>
        <NodeShell title="Container" nodeType="group">
            <Body><Param label="Nodes" value="4" /></Body>
        </NodeShell>
    </div>
);
