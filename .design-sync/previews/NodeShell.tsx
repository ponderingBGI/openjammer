import { NodeShell, Port } from '@openjammer/oj-ui';

/** The node card: paper header (title + type), edge-anchored port rails, content. */
export const Default = () => (
    <NodeShell
        title="Oscillator"
        nodeType="instrument"
        inputs={<Port kind="control" direction="input" connected />}
        outputs={<Port kind="audio" direction="output" connected />}
    >
        <div style={{ fontFamily: 'var(--font-sketch)', fontSize: 'var(--text-md)' }}>
            waveform: sine · 440 Hz
        </div>
    </NodeShell>
);

/** Selected (accent ring) and the agent-pending state (the AI just added it). */
export const States = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-start' }}>
        <NodeShell title="Filter" nodeType="effect" selected
            inputs={<Port kind="audio" direction="input" />}
            outputs={<Port kind="audio" direction="output" />}>
            <div style={{ fontFamily: 'var(--font-sketch)' }}>lowpass · 1.2 kHz</div>
        </NodeShell>
        <NodeShell title="Reverb" nodeType="effect" agentPending
            inputs={<Port kind="audio" direction="input" />}
            outputs={<Port kind="audio" direction="output" />}>
            <div style={{ fontFamily: 'var(--font-sketch)' }}>hall · 40%</div>
        </NodeShell>
    </div>
);
