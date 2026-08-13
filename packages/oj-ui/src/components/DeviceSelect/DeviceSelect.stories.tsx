import type { Story } from '@ladle/react';
import { useState } from 'react';
import { DeviceSelect, type DeviceSelectItem } from './DeviceSelect';

export default { title: 'Composites/DeviceSelect' };

const INPUTS: DeviceSelectItem[] = [
    { id: 'built-in', label: 'Built-in Microphone' },
    { id: 'focusrite', label: 'Focusrite Scarlett 2i2', lowLatency: true },
    { id: 'rode', label: 'RØDE NT-USB' },
    { id: 'aggregate', label: 'Aggregate Device', lowLatency: true },
];

const OUTPUTS: DeviceSelectItem[] = [
    { id: 'speakers', label: 'MacBook Pro Speakers' },
    { id: 'monitors', label: 'Studio Monitors', lowLatency: true },
    { id: 'airpods', label: 'AirPods Pro' },
];

export const Microphone: Story = () => {
    const [value, setValue] = useState('focusrite');
    const [open, setOpen] = useState(true);
    return (
        <div style={{ width: 280 }}>
            <DeviceSelect
                ariaLabel="Microphone"
                items={INPUTS}
                value={value}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                onSelect={(id) => {
                    setValue(id);
                    setOpen(false);
                }}
            />
        </div>
    );
};

export const Speaker: Story = () => {
    const [value, setValue] = useState('monitors');
    const [open, setOpen] = useState(true);
    return (
        <div style={{ width: 280 }}>
            <DeviceSelect
                ariaLabel="Speaker"
                items={OUTPUTS}
                value={value}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                onSelect={(id) => {
                    setValue(id);
                    setOpen(false);
                }}
            />
        </div>
    );
};

export const Closed: Story = () => {
    const [value, setValue] = useState('focusrite');
    const [open, setOpen] = useState(false);
    return (
        <div style={{ width: 280 }}>
            <DeviceSelect
                ariaLabel="Microphone"
                items={INPUTS}
                value={value}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                onSelect={(id) => {
                    setValue(id);
                    setOpen(false);
                }}
            />
        </div>
    );
};

export const Placeholder: Story = () => {
    const [value, setValue] = useState('');
    const [open, setOpen] = useState(false);
    return (
        <div style={{ width: 280 }}>
            <DeviceSelect
                ariaLabel="Microphone"
                placeholder="No device chosen"
                items={INPUTS}
                value={value}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                onSelect={(id) => {
                    setValue(id);
                    setOpen(false);
                }}
            />
        </div>
    );
};
