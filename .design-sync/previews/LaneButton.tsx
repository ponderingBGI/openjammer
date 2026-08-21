import type { ReactNode } from 'react';
import { LaneButton } from '@openjammer/oj-ui';

/** Tone styling only lands on the pressed state — an unpressed lane button is always neutral. */
const cell = (caption: string, children: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-xs)' }}>
        {children}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {caption}
        </span>
    </div>
);

export const Tones = () => (
    <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {cell('mute · off', <LaneButton tone="mute" aria-label="Mute" aria-pressed={false}>M</LaneButton>)}
        {cell('mute · on', <LaneButton tone="mute" aria-label="Muted" aria-pressed>M</LaneButton>)}
        {cell('solo · on', <LaneButton tone="solo" aria-label="Soloed" aria-pressed>S</LaneButton>)}
        {cell('armed · on', <LaneButton tone="armed" aria-label="Armed for recording" aria-pressed>●</LaneButton>)}
        {cell('recording', <LaneButton tone="recording" aria-label="Recording" aria-pressed>●</LaneButton>)}
    </div>
);

/** Where they actually live: the button cluster in a timeline lane header. */
export const InLaneHeader = () => (
    <div style={{ width: 280, display: 'flex', flexDirection: 'column' }}>
        {[
            { name: 'Drums', mute: false, solo: false, rec: false },
            { name: 'Bass', mute: true, solo: false, rec: false },
            { name: 'Lead synth', mute: false, solo: true, rec: false },
            { name: 'Vocal take 3', mute: false, solo: false, rec: true },
        ].map((lane) => (
            <div
                key={lane.name}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-sm)',
                    background: 'var(--timeline-lane-bg)',
                    borderBottom: '1px solid var(--timeline-lane-divider)',
                }}
            >
                <span
                    style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {lane.name}
                </span>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', flexShrink: 0 }}>
                    <LaneButton tone="mute" aria-label={`Mute ${lane.name}`} aria-pressed={lane.mute}>M</LaneButton>
                    <LaneButton tone="solo" aria-label={`Solo ${lane.name}`} aria-pressed={lane.solo}>S</LaneButton>
                    <LaneButton tone="recording" aria-label={`Record ${lane.name}`} aria-pressed={lane.rec}>●</LaneButton>
                </div>
            </div>
        ))}
    </div>
);
