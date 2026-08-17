import type { Story } from '@ladle/react';
import { LaneButton } from './LaneButton';

export const StateMatrix: Story = () => <div style={{ display: 'flex', gap: 12 }}>
    <LaneButton aria-label="Mute" aria-pressed={false} tone="mute">M</LaneButton>
    <LaneButton aria-label="Muted" aria-pressed tone="mute">M</LaneButton>
    <LaneButton aria-label="Soloed" aria-pressed tone="solo">S</LaneButton>
    <LaneButton aria-label="Armed" aria-pressed tone="armed">●</LaneButton>
    <LaneButton aria-label="Recording" aria-pressed tone="recording">●</LaneButton>
</div>;
