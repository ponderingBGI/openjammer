import { useState } from 'react';
import { SegmentedControl, Tabs } from '@openjammer/oj-ui';

const CHANNELS = [
    { value: 'stable', label: 'Stable' },
    { value: 'beta', label: 'Beta' },
    { value: 'nightly', label: 'Nightly' },
] as const;

type Channel = (typeof CHANNELS)[number]['value'];

const SECTIONS = [
    { value: 'graphics', label: 'Graphics' },
    { value: 'keybindings', label: 'Keybindings' },
    { value: 'audio', label: 'Audio' },
    { value: 'updates', label: 'Updates' },
    { value: 'about', label: 'About' },
] as const;

type Section = (typeof SECTIONS)[number]['value'];

export const Horizontal = () => {
    const [value, setValue] = useState<Channel>('stable');
    return (
        <SegmentedControl
            aria-label="Release channel"
            options={CHANNELS as unknown as { value: Channel; label: string }[]}
            value={value}
            onChange={setValue}
        />
    );
};

export const Vertical = () => {
    const [value, setValue] = useState<Section>('graphics');
    return (
        <div style={{ width: 180 }}>
            <SegmentedControl
                aria-label="Settings section"
                orientation="vertical"
                options={SECTIONS as unknown as { value: Section; label: string }[]}
                value={value}
                onChange={setValue}
            />
        </div>
    );
};

export const AsTabs = () => {
    const [value, setValue] = useState<Section>('updates');
    return (
        <div style={{ width: 180 }}>
            <Tabs
                aria-label="Settings section"
                options={SECTIONS as unknown as { value: Section; label: string }[]}
                value={value}
                onChange={setValue}
            />
        </div>
    );
};
