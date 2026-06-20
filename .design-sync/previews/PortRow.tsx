import { PortRow } from '@openjammer/oj-ui';

const column: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
    width: 'var(--node-min-width)',
    padding: 'var(--space-sm)',
    background: 'var(--bg-node)',
    border: 'var(--border-sketch-width) solid var(--sketch-black)',
    borderRadius: 'var(--radius-md)',
};

export const InputsAndOutputs = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
        <div style={column}>
            <PortRow side="input" kind="control" label="Trigger" />
            <PortRow side="input" kind="audio" label="Sidechain" />
            <PortRow side="input" kind="universal" label="Any" />
        </div>
        <div style={column}>
            <PortRow side="output" kind="audio" label="Out L" />
            <PortRow side="output" kind="audio" label="Out R" />
            <PortRow side="output" kind="control" label="Gate" />
        </div>
    </div>
);

export const Connected = () => (
    <div style={column}>
        <PortRow side="input" kind="audio" label="In" connected />
        <PortRow side="output" kind="control" label="Pitch" connected />
        <PortRow side="output" kind="universal" label="Resolved" connected resolvedKind="audio" />
    </div>
);

export const Placeholder = () => (
    <div style={column}>
        <PortRow side="input" kind="universal" label="+ Add input" placeholder />
        <PortRow side="output" kind="universal" label="+ Add output" placeholder />
    </div>
);

export const EditableLabel = () => (
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

export const HiddenLabel = () => (
    <div style={column}>
        <PortRow side="input" kind="audio" label="Hidden but announced" hideLabel />
        <PortRow side="output" kind="control" label="Also announced" hideLabel />
    </div>
);
