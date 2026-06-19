import type { Story } from '@ladle/react';
import { Callout } from './Callout';

export default { title: 'Primitives/Callout' };

/** A simple inline glyph so each variant carries an icon, not color alone. */
function Glyph({ char }: { char: string }) {
    return <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700 }}>{char}</span>;
}

export const Variants: Story = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: 480 }}>
        <Callout variant="info" title="Heads up" icon={<Glyph char="i" />}>
            Patch the keyboard into the synth to hear it.
        </Callout>
        <Callout variant="success" title="Connected" icon={<Glyph char="✓" />}>
            Audio is flowing from the synth to the speakers.
        </Callout>
        <Callout variant="warning" title="High latency" icon={<Glyph char="!" />}>
            The browser tier runs around 15–25ms. Use the native build on stage.
        </Callout>
        <Callout variant="danger" title="Dropout detected" icon={<Glyph char="✕" />}>
            The audio thread blocked. A held note beats a glitch — recover when ready.
        </Callout>
        <Callout variant="tip" title="Tip" icon={<Glyph char="★" />}>
            Press Ctrl+Z to undo any graph edit the AI agent made.
        </Callout>
    </div>
);

export const TitleAndIconOptional: Story = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: 480 }}>
        <Callout variant="info">Body-only callout, no title and no icon.</Callout>
        <Callout variant="warning" icon={<Glyph char="!" />}>
            Icon, no title.
        </Callout>
        <Callout variant="tip" title="Title, no icon">
            The accent still shows on the left edge.
        </Callout>
    </div>
);
