import type { Story } from '@ladle/react';
import { Port } from './Port';

export default { title: 'Primitives/Port' };

/** Sockets are always seen sunk into a node body — never on the page ground —
 *  so every story sits them on a card the way the canvas does. */
const body: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '12px 14px',
    background: 'var(--bg-node)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-overlay)',
};

const caption: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    font: '600 9.5px var(--font-mono)',
    letterSpacing: 'var(--tracking-micro)',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
};

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <span style={caption}>
            {children}
            <span>{label}</span>
        </span>
    );
}

/**
 * Idle: the TYPE reads at reduced chroma before any cable exists (U8/HA-12).
 * A port's type is a property of the socket — what may be plugged in — not of
 * whatever is flowing through it right now, and "where may I drag this?" is a
 * question the player asks *before* there is a cable to answer it.
 */
export const Idle: Story = () => (
    <div style={body}>
        <Cell label="audio">
            <Port kind="audio" direction="input" name="Audio in" />
        </Cell>
        <Cell label="control">
            <Port kind="control" direction="input" name="Level" />
        </Cell>
        <Cell label="universal">
            <Port kind="universal" direction="input" />
        </Cell>
    </div>
);

/**
 * Named: hover any socket. Every port carries `role="button"`, an `aria-label`
 * and the same words as a `title`, built from its type, its direction and the
 * name its row prints beside it — the app's most-repeated verb used to be
 * invisible to assistive tech and had no hover affordance at all (HA-02).
 */
export const Named: Story = () => (
    <div style={body}>
        <Cell label="audio out">
            <Port kind="audio" direction="output" connected />
        </Cell>
        <Cell label="control in · Level">
            <Port kind="control" direction="input" name="Level" />
        </Cell>
        <Cell label="armed">
            <Port kind="audio" direction="output" data-armed="" />
        </Cell>
    </div>
);

/** Live: the core takes the wiring color. That is the whole legend. */
export const Connected: Story = () => (
    <div style={body}>
        <Cell label="audio">
            <Port kind="audio" direction="output" connected />
        </Cell>
        <Cell label="control">
            <Port kind="control" direction="output" connected />
        </Cell>
        <Cell label="universal">
            <Port kind="universal" direction="output" connected />
        </Cell>
        <Cell label="resolved">
            <Port kind="universal" resolvedKind="audio" direction="output" connected />
        </Cell>
    </div>
);

export const States: Story = () => (
    <div style={body}>
        <Cell label="idle">
            <Port kind="audio" direction="input" />
        </Cell>
        <Cell label="firing">
            <Port kind="control" direction="output" active />
        </Cell>
        <Cell label="placeholder">
            <Port kind="universal" direction="input" placeholder />
        </Cell>
        <Cell label="focus (tab)">
            <Port kind="audio" direction="input" tabIndex={0} />
        </Cell>
        <Cell label="armed (Enter)">
            <Port kind="audio" direction="output" data-armed="" />
        </Cell>
    </div>
);

/** A handful of schematic faceplates still size their sockets down. The core is
 *  a percentage of the well, so a 10px socket is the same object, smaller. */
export const Sizes: Story = () => (
    <div style={body}>
        {[10, 12, 14, 18].map((size) => (
            <Cell key={size} label={`${size}px`}>
                <Port kind="audio" direction="input" connected style={{ width: size, height: size }} />
            </Cell>
        ))}
    </div>
);
