import { Spinner } from '@openjammer/oj-ui';

export const Sizes = () => (
    <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
        <Spinner size={12} />
        <Spinner />
        <Spinner size={24} />
        <Spinner size={40} />
    </div>
);

export const Inline = () => (
    <div
        style={{
            display: 'flex',
            gap: 'var(--space-sm)',
            alignItems: 'center',
            fontFamily: 'var(--font-sketch)',
            color: 'var(--text-secondary)',
        }}
    >
        <Spinner />
        <span>Loading guide…</span>
    </div>
);
