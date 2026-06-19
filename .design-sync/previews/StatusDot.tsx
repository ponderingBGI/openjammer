import { StatusDot } from '@openjammer/oj-ui';

const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    fontFamily: 'var(--font-sketch)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
} as const;

export const Statuses = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {/* Signal-Not-Brand: every state color rides next to a label. */}
        <span style={rowStyle}>
            <StatusDot status="ok" /> Engine running
        </span>
        <span style={rowStyle}>
            <StatusDot status="warn" /> Buffer underrun risk
        </span>
        <span style={rowStyle}>
            <StatusDot status="bad" /> Device disconnected
        </span>
        <span style={rowStyle}>
            <StatusDot status="idle" /> Standby
        </span>
        <span style={rowStyle}>
            <StatusDot status="info" /> Stream connected
        </span>
    </div>
);
