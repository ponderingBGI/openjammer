import type { Story } from '@ladle/react';
import { PortRow } from './PortRow';

export default { title: 'Composites/PortRow' };

/** Rows are only ever seen inside a node body, so the stories put them there. */
const card: React.CSSProperties = {
    width: 'var(--node-min-width)',
    padding: '12px 14px',
    background: 'var(--bg-node)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-overlay)',
};

const column: React.CSSProperties = {
    ...card,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
};

/** The shape a node body actually uses: one space-between row, inputs grouped
 *  left, outputs grouped right. */
export const InputsAndOutputs: Story = () => (
    <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <PortRow side="input" kind="control" label="Trigger" />
                <PortRow side="input" kind="audio" label="Sidechain" />
                <PortRow side="input" kind="universal" label="Any" />
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 'var(--space-sm)',
                }}
            >
                <PortRow side="output" kind="audio" label="Out L" />
                <PortRow side="output" kind="audio" label="Out R" />
                <PortRow side="output" kind="control" label="Gate" />
            </div>
        </div>
    </div>
);

export const Connected: Story = () => (
    <div style={column}>
        <PortRow side="input" kind="audio" label="In" connected />
        <PortRow side="output" kind="control" label="Pitch" connected />
        <PortRow side="output" kind="universal" label="Resolved" connected resolvedKind="audio" />
    </div>
);

export const Placeholder: Story = () => (
    <div style={column}>
        <PortRow side="input" kind="universal" label="+ Add input" placeholder />
        <PortRow side="output" kind="universal" label="+ Add output" placeholder />
    </div>
);

/** Declared but not engine-wired yet: dimmed, still hoverable so the `title`
 *  can say why, and impossible to connect. */
export const Gated: Story = () => (
    <div style={column}>
        <PortRow
            side="input"
            kind="control"
            label="Sustain"
            className="is-disabled"
            title="Not wired to the engine yet"
            aria-disabled
        />
    </div>
);

export const EditableLabel: Story = () => (
    <div style={column}>
        <PortRow
            side="input"
            kind="control"
            label="Note"
            editableLabel={
                <input
                    defaultValue="Note"
                    style={{
                        font: 'inherit',
                        color: 'inherit',
                        background: 'transparent',
                        border: 0,
                        borderBottom: '1px solid var(--border-strong)',
                        width: '100%',
                    }}
                />
            }
        />
    </div>
);

/** The socket survives when the name is hidden — a row you cannot read is still
 *  a row you must be able to plug into. */
export const HiddenLabel: Story = () => (
    <div style={column}>
        <PortRow side="input" kind="audio" label="Hidden but announced" hideLabel />
        <PortRow side="output" kind="control" label="Also announced" hideLabel />
    </div>
);
