import { Kbd } from '@openjammer/oj-ui';

export const Variants = () => (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Kbd>⌘</Kbd>
        <Kbd>Ctrl</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>↵</Kbd>
        <Kbd>Esc</Kbd>
        <Kbd custom>⌘+K</Kbd>
    </div>
);

export const InContext = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <p style={{ fontFamily: 'var(--font-sketch)', color: 'var(--text-primary)' }}>
            Undo anything with <Kbd>Ctrl+Z</Kbd> — or press <Kbd>Ctrl+↑</Kbd> to edit an
            earlier prompt.
        </p>
        <p style={{ fontFamily: 'var(--font-sketch)', color: 'var(--text-primary)' }}>
            <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline
        </p>
        <p style={{ fontFamily: 'var(--font-sketch)', color: 'var(--text-primary)' }}>
            Remapped: <Kbd custom>F2</Kbd> (custom binding)
        </p>
    </div>
);
