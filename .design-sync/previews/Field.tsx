import { Field, Input } from '@openjammer/oj-ui';

/** Labelled form fields — stacked, and a row layout for compact numerics. */
export const Default = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 260 }}>
        <Field label="Session name">
            <Input defaultValue="Sunset session" />
        </Field>
        <Field label="Tempo (BPM)" row>
            <Input type="number" defaultValue={120} style={{ width: 90 }} />
        </Field>
    </div>
);
