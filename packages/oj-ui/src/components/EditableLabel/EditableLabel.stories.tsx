import type { Story } from '@ladle/react';
import { useState } from 'react';
import { EditableLabel } from './EditableLabel';

export default { title: 'Composites/EditableLabel' };

/** Uncontrolled: double-click the name (or focus + Enter) to rename it. */
export const Uncontrolled: Story = () => {
    const [name, setName] = useState('Reverb Bus');
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <EditableLabel value={name} placeholder="Untitled" onCommit={setName} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                committed: {name || '(empty)'}
            </span>
        </div>
    );
};

/** Centered alignment — used for node titles that sit centered in a header. */
export const Centered: Story = () => {
    const [name, setName] = useState('Master Out');
    return (
        <div style={{ width: 200 }}>
            <EditableLabel value={name} align="center" placeholder="Untitled" onCommit={setName} />
        </div>
    );
};

/** Empty value shows the placeholder hint in the muted voice. */
export const EmptyPlaceholder: Story = () => {
    const [name, setName] = useState('');
    return <EditableLabel value={name} placeholder="Name this node…" onCommit={setName} />;
};

/** Controlled: the parent owns the `editing` flag and toggles it explicitly. */
export const Controlled: Story = () => {
    const [name, setName] = useState('Input 1');
    const [editing, setEditing] = useState(false);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <EditableLabel
                value={name}
                editing={editing}
                onCommit={(next) => {
                    setName(next);
                    setEditing(false);
                }}
                onCancel={() => setEditing(false)}
            />
            <button type="button" onClick={() => setEditing((e) => !e)}>
                {editing ? 'editing…' : 'rename'}
            </button>
        </div>
    );
};
