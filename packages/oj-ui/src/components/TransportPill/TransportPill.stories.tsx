import { useEffect, useRef, useState } from 'react';
import type { Story } from '@ladle/react';
import { Meter, type MeterHandle } from '../Meter/Meter';
import { TransportPill } from './TransportPill';

export default { title: 'Composites/TransportPill' };

const stage: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
    alignItems: 'flex-start',
    padding: 'var(--space-lg)',
};

function LiveMeter({ active }: { active: boolean }) {
    const handle = useRef<MeterHandle>(null);
    useEffect(() => {
        let raf = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const t = (now - start) / 1000;
            handle.current?.setSignal(active ? 0.7 * (0.5 + 0.5 * Math.sin(t * 3.4)) : 0);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [active]);
    return <Meter ref={handle} />;
}

/** The full song transport — every zone present. */
export const Song: Story = () => {
    const [playing, setPlaying] = useState(false);
    const [tempo, setTempo] = useState(120);
    const [loop, setLoop] = useState(true);
    const [click, setClick] = useState(false);
    const [countIn, setCountIn] = useState<0 | 1 | 2>(0);
    const [recording, setRecording] = useState(false);
    return (
        <div style={stage}>
            <TransportPill
                playing={playing}
                onPlayToggle={() => setPlaying((p) => !p)}
                onReturnToStart={() => undefined}
                record={{ recording, onToggle: () => setRecording((r) => !r) }}
                position={{ display: playing ? '3.2' : '1.1', onSeek: () => undefined }}
                tempo={{ value: tempo, onCommit: setTempo }}
                loop={{ on: loop, onToggle: () => setLoop((l) => !l) }}
                metronome={{ on: click, countInBars: countIn, onToggle: () => setClick((c) => !c), onCountIn: setCountIn }}
                meter={<LiveMeter active={playing} />}
                hint="space"
            />
        </div>
    );
};

/** A bare canvas: no song, so no position and a tempo that says why it is dead. */
export const CanvasWithoutASong: Story = () => {
    const [playing, setPlaying] = useState(false);
    return (
        <div style={stage}>
            <TransportPill
                playing={playing}
                onPlayToggle={() => setPlaying((p) => !p)}
                tempo={{ value: 120, onCommit: () => undefined, disabled: true, disabledReason: 'Add a Song to set the tempo' }}
                meter={<LiveMeter active={playing} />}
                hint="space"
            />
        </div>
    );
};
CanvasWithoutASong.storyName = 'Canvas without a song';

/** Cold load in the browser tier: the play button asks for the first gesture. */
export const AwaitingFirstGesture: Story = () => (
    <div style={stage}>
        <TransportPill playing={false} pulse onPlayToggle={() => undefined} meter={<LiveMeter active={false} />} hint="space" />
    </div>
);
AwaitingFirstGesture.storyName = 'Awaiting the first gesture';

/** Nothing is armed — the record button says so instead of shrugging. */
export const RecordDisabled: Story = () => (
    <div style={stage}>
        <TransportPill
            playing={false}
            onPlayToggle={() => undefined}
            record={{ recording: false, disabled: true, disabledReason: 'Arm a track first', onToggle: () => undefined }}
            position={{ display: '1.1' }}
            tempo={{ value: 96, onCommit: () => undefined }}
            meter={<LiveMeter active={false} />}
            hint="space"
        />
    </div>
);
RecordDisabled.storyName = 'Record disabled';

export const Recording: Story = () => (
    <div style={stage}>
        <TransportPill
            playing
            onPlayToggle={() => undefined}
            record={{ recording: true, onToggle: () => undefined }}
            position={{ display: '5.3' }}
            tempo={{ value: 96, onCommit: () => undefined }}
            loop={{ on: false, onToggle: () => undefined }}
            metronome={{ on: true, countInBars: 2, onToggle: () => undefined, onCountIn: () => undefined }}
            meter={<LiveMeter active />}
            hint="space"
        />
    </div>
);
