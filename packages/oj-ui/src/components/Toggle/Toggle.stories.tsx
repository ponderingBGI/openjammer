import type { Story } from '@ladle/react';
import { useState } from 'react';
import { Toggle } from './Toggle';

export default { title: 'Primitives/Toggle' };

export const States: Story = () => {
    const [autoUpdate, setAutoUpdate] = useState(true);
    const [lowLatency, setLowLatency] = useState(false);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxWidth: 360 }}>
            <Toggle
                checked={autoUpdate}
                onChange={setAutoUpdate}
                label="Auto-update"
                description="Install new versions automatically when they're ready."
            />
            <Toggle
                checked={lowLatency}
                onChange={setLowLatency}
                label="Low-latency mode"
            />
            <Toggle checked={false} onChange={() => {}} label="Off (static)" />
            <Toggle checked onChange={() => {}} label="On (static)" />
            <Toggle
                checked={false}
                onChange={() => {}}
                disabled
                label="Disabled (off)"
                description="This switch can't be changed right now."
            />
            <Toggle checked disabled onChange={() => {}} label="Disabled (on)" />
        </div>
    );
};
