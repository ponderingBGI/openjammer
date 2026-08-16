import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LaneButton, Slider, ValueScrubber } from '@openjammer/oj-ui';
import { getExecutor } from '../../audio/executor';
import type { ArrangementTrack } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';

const EMPTY_LEVELS = new Map<string, number>();

function Meter({ value }: { value: number }) {
    return <span className={`mixer-meter${value >= 1 ? ' is-clipping' : ''}`} aria-hidden="true"><span style={{ transform: `scaleY(${Math.max(0, Math.min(1, value))})` }} /></span>;
}

function TrackStrip({ track, peak }: { track: ArrangementTrack; peak: number }) {
    const trackId = track.id ?? track.ref;
    const gesture = useRef(false);
    const panGesture = useRef<{ y: number; value: number } | null>(null);
    const preview = (verb: Parameters<ReturnType<typeof useArrangementStore.getState>['previewGesture']>[0]) => {
        const store = useArrangementStore.getState();
        if (!gesture.current) {
            store.beginGesture('Adjust mixer');
            gesture.current = true;
        }
        store.previewGesture(verb);
    };
    const finish = () => {
        if (!gesture.current) return;
        gesture.current = false;
        panGesture.current = null;
        useArrangementStore.getState().commitGesture();
    };
    const onFaderKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
        const amount = event.shiftKey ? 3 : 0.5;
        useArrangementStore.getState().apply({ kind: 'setTrackGain', trackId, gainDb: (track.gainDb ?? 0) + amount * direction });
    };
    return (
        <section className="mixer-strip" aria-label={`${track.name ?? track.ref} mixer strip`}>
            <div className="mixer-strip__name" title={track.name ?? track.ref}>{track.name ?? track.ref}</div>
            <div className="mixer-strip__body">
                <div className="mixer-strip__fader">
                    <Slider
                        aria-label={`${track.name ?? track.ref} gain`}
                        min={-60}
                        max={12}
                        step={0.5}
                        value={track.gainDb ?? 0}
                        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); useArrangementStore.getState().beginGesture('Adjust track gain'); gesture.current = true; }}
                        onPointerUp={finish}
                        onPointerCancel={() => { gesture.current = false; useArrangementStore.getState().abortGesture(); }}
                        onKeyDown={onFaderKey}
                        onChange={(gainDb) => preview({ kind: 'setTrackGain', trackId, gainDb })}
                    />
                </div>
                <Meter value={peak} />
            </div>
            <span className="mixer-strip__readout">{(track.gainDb ?? 0).toFixed(1)} dB</span>
            <ValueScrubber
                className="mixer-strip__pan"
                value={track.pan ?? 0}
                display={Math.abs(track.pan ?? 0) < 0.005 ? 'C' : `${(track.pan ?? 0) < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan ?? 0) * 100)}`}
                aria-label={`${track.name ?? track.ref} pan`}
                onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    panGesture.current = { y: event.clientY, value: track.pan ?? 0 };
                    useArrangementStore.getState().beginGesture('Adjust track pan');
                    gesture.current = true;
                }}
                onPointerMove={(event: PointerEvent<HTMLSpanElement>) => {
                    if (!panGesture.current) return;
                    preview({ kind: 'setTrackPan', trackId, pan: panGesture.current.value + (panGesture.current.y - event.clientY) / 80 });
                }}
                onPointerUp={finish}
                onPointerCancel={() => { gesture.current = false; panGesture.current = null; useArrangementStore.getState().abortGesture(); }}
                onCommit={(pan) => useArrangementStore.getState().apply({ kind: 'setTrackPan', trackId, pan })}
            />
            <div className="mixer-strip__switches">
                <LaneButton tone="mute" aria-label={`Mute ${track.name ?? track.ref}`} aria-pressed={track.mute === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackMute', trackId, mute: !track.mute })}>M</LaneButton>
                <LaneButton tone="solo" aria-label={`Solo ${track.name ?? track.ref}`} aria-pressed={track.solo === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackSolo', trackId, solo: !track.solo })}>S</LaneButton>
            </div>
        </section>
    );
}

export function MixerDrawer() {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const [levels, setLevels] = useState<Map<string, number>>(new Map());
    useEffect(() => {
        if (!isPlaying) return;
        return getExecutor().subscribeSignalLevels((next) => setLevels(new Map(next)));
    }, [isPlaying]);
    if (!arrangement) return null;
    const displayedLevels = isPlaying ? levels : EMPTY_LEVELS;
    return (
        <div className={`mixer-drawer${isPlaying ? '' : ' is-idle'}`} role="region" aria-label="Mixer">
            <div className="mixer-drawer__scroll">
                {arrangement.tracks.map((track) => <TrackStrip key={track.id ?? track.ref} track={track} peak={displayedLevels.get(track.ref) ?? 0} />)}
            </div>
            <section className="mixer-strip mixer-strip--master" aria-label="Master mixer strip">
                <div className="mixer-strip__name">Master</div>
                <div className="mixer-master-meter"><Meter value={displayedLevels.get('__master__') ?? 0} /></div>
                <span className="mixer-strip__readout">0.0 dB</span>
            </section>
        </div>
    );
}
