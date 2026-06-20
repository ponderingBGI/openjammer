import { CodeBlock } from '@openjammer/oj-ui';

const SAMPLE = `## Issue
freq knob jitters above 2 kHz

## Steps
1. add Oscillator
2. sweep frequency
3. listen for the click

## Env
oj-core 0.4.2 · webaudio executor`;

const LONG = Array.from({ length: 40 }, (_, i) => `line ${i + 1}\tvalue=${(i * 1.5).toFixed(2)}`).join(
    '\n',
);

export const Variants = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: 420 }}>
        <CodeBlock text={SAMPLE} />
        <CodeBlock>{'inline children win over text'}</CodeBlock>
        <CodeBlock text={LONG} maxHeight="160px" />
        <CodeBlock text="not selectable — informational only" selectable={false} />
    </div>
);
