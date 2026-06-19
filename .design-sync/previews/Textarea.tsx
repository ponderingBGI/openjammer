import { Textarea } from '@openjammer/oj-ui';

export const States = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: 360 }}>
        <Textarea placeholder="Write a prompt…" rows={3} />
        <Textarea defaultValue={'Multiple\nlines\nof prose'} rows={3} />
        <Textarea defaultValue="Disabled" rows={3} disabled />
        <Textarea defaultValue="Read only" rows={3} readOnly />
        <Textarea
            defaultValue="{ &quot;type&quot;: &quot;node&quot; }"
            rows={3}
            style={{ fontFamily: 'var(--font-mono)' }}
        />
    </div>
);
