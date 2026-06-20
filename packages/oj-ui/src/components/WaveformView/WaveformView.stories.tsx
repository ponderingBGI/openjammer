import type { Story } from '@ladle/react';
import { WaveformView } from './WaveformView';

export default { title: 'Composites/WaveformView' };

/** A few cycles of a damped sine — enough to read as a clip preview. */
const PEAKS = Array.from({ length: 64 }, (_, i) => {
    const t = i / 63;
    return Math.sin(t * Math.PI * 6) * (1 - t) * 0.9;
});

const cardStyle = { width: 160 };

export const States: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <WaveformView peaks={PEAKS} durationLabel="2.4s" name="kick_loop.wav" style={cardStyle} />
        <WaveformView peaks={PEAKS} durationLabel="2.4s" name="snare_roll.wav" selected style={cardStyle} />
        <WaveformView peaks={PEAKS} durationLabel="0.8s" name="vocal_chop.wav" dropTarget style={cardStyle} />
        <WaveformView peaks={PEAKS} durationLabel="2.4s" name="hat_loop.wav" dragging style={cardStyle} />
        <WaveformView peaks={PEAKS} durationLabel="1.1s" name="a_very_long_sample_name_here.wav" cropped style={cardStyle} />
    </div>
);

export const Single: Story = () => (
    <WaveformView
        peaks={PEAKS}
        durationLabel="3.0s"
        name="bass_drop.wav"
        draggable
        style={cardStyle}
    />
);
