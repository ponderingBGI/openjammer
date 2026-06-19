import { Port } from '@openjammer/oj-ui';

/** The wiring ports: audio (blue), control (grey), universal (rainbow until typed). */
export const Kinds = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <Port kind="audio" direction="output" />
        <Port kind="control" direction="output" />
        <Port kind="universal" direction="output" />
    </div>
);

/** State: connected (soft glow), an active/firing control port, a dashed placeholder slot. */
export const States = () => (
    <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center' }}>
        <Port kind="audio" direction="output" connected />
        <Port kind="control" direction="input" connected />
        <Port kind="control" direction="output" active />
        <Port kind="universal" placeholder />
    </div>
);
