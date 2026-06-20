import { PanelHeader } from '@openjammer/oj-ui';
import { Button } from '@openjammer/oj-ui';
import { Chip } from '@openjammer/oj-ui';

const frame = {
    maxWidth: 'var(--node-min-width)',
    width: '420px',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--bg-node)',
    overflow: 'hidden',
} as const;

export const Default = () => (
    <div style={frame}>
        <PanelHeader title="Settings" onClose={() => {}} />
    </div>
);

export const WithSubtitle = () => (
    <div style={frame}>
        <PanelHeader
            title="MIDI Devices"
            subtitle="Choose an input to play the canvas"
            onClose={() => {}}
        />
    </div>
);

export const WithBadge = () => (
    <div style={frame}>
        <PanelHeader
            title="Connected"
            badge={<Chip tone="success">live</Chip>}
            onClose={() => {}}
        />
    </div>
);

export const WithBack = () => (
    <div style={frame}>
        <PanelHeader
            title="Pick a model"
            onBack={() => {}}
            backLabel="Back"
            onClose={() => {}}
        />
    </div>
);

export const WithActions = () => (
    <div style={frame}>
        <PanelHeader
            title="AI Assistant"
            subtitle="Describe a change to the patch"
            actions={
                <>
                    <Button variant="ghost">New</Button>
                    <Button variant="ghost">Resume</Button>
                </>
            }
            onClose={() => {}}
        />
    </div>
);

export const Everything = () => (
    <div style={frame}>
        <PanelHeader
            title="Browse Nodes"
            subtitle="Tap a node to drop it on the canvas"
            badge={<Chip count={42}>tags</Chip>}
            onBack={() => {}}
            actions={<Button variant="ghost">Filter</Button>}
            onClose={() => {}}
        />
    </div>
);
