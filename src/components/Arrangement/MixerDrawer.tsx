import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { LaneButton, Slider, ValueScrubber } from '@openjammer/oj-ui';
import type { ArrangementTrack } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';
import { ownPointerGesture } from './pointerGestureLifetime';
import { registerTimelineLevelWriter } from './timelineSignalLevels';

function Meter({ levelId, active }: { levelId: string; active: boolean }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => registerTimelineLevelWriter((levels) => {
        const value = active ? levels.get(levelId) ?? 0 : 0;
        ref.current?.classList.toggle('is-clipping', value >= 1);
        const fill = ref.current?.firstElementChild as HTMLElement | null;
        if (fill) fill.style.transform = `scaleY(${Math.max(0, Math.min(1, value))})`;
    }), [active, levelId]);
    return <span ref={ref} className="mixer-meter" aria-hidden="true"><span /></span>;
}

function TrackStrip({ track, active }: { track: ArrangementTrack; active: boolean }) {
    const trackId = track.id ?? track.ref;
    const gesture = useRef(false);
    const cleanup = useRef<(() => void) | null>(null);
    const panGesture = useRef<{ y: number; value: number; moved: boolean } | null>(null);
    const suppressPanClick = useRef(false);
    const preview = (verb: Parameters<ReturnType<typeof useArrangementStore.getState>['previewGesture']>[0]) => {
        const store = useArrangementStore.getState();
        if (!gesture.current) {
            store.beginGesture('Adjust mixer');
            gesture.current = true;
        }
        store.previewGesture(verb);
    };
    const finish = (commit = true) => {
        if (!gesture.current) return;
        suppressPanClick.current = panGesture.current?.moved === true;
        cleanup.current?.();
        cleanup.current = null;
        gesture.current = false;
        panGesture.current = null;
        if (commit) useArrangementStore.getState().commitGesture();
        else useArrangementStore.getState().abortGesture();
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
                        onPointerDown={(event) => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ } useArrangementStore.getState().beginGesture('Adjust track gain'); gesture.current = true; cleanup.current = ownPointerGesture(event.pointerId, { commit: () => finish(true), abort: () => finish(false) }); }}
                        onKeyDown={onFaderKey}
                        onChange={(gainDb) => preview({ kind: 'setTrackGain', trackId, gainDb })}
                    />
                </div>
                <Meter levelId={track.ref} active={active} />
            </div>
            <span className="mixer-strip__readout">{(track.gainDb ?? 0).toFixed(1)} dB</span>
            <ValueScrubber
                className="mixer-strip__pan"
                value={track.pan ?? 0}
                display={Math.abs(track.pan ?? 0) < 0.005 ? 'C' : `${(track.pan ?? 0) < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan ?? 0) * 100)}`}
                aria-label={`${track.name ?? track.ref} pan`}
                onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
                    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
                    panGesture.current = { y: event.clientY, value: track.pan ?? 0, moved: false };
                    useArrangementStore.getState().beginGesture('Adjust track pan');
                    gesture.current = true;
                    cleanup.current = ownPointerGesture(event.pointerId, {
                        move: (nativeEvent) => {
                            if (!panGesture.current) return;
                            if (Math.abs(nativeEvent.clientY - panGesture.current.y) < 3) return;
                            panGesture.current.moved = true;
                            preview({ kind: 'setTrackPan', trackId, pan: panGesture.current.value + (panGesture.current.y - nativeEvent.clientY) / 80 });
                        },
                        commit: () => finish(true),
                        abort: () => finish(false),
                    });
                }}
                onClickCapture={(event) => {
                    if (!suppressPanClick.current) return;
                    suppressPanClick.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onCommit={(pan) => {
                    useArrangementStore.getState().apply({ kind: 'setTrackPan', trackId, pan });
                }}
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
    if (!arrangement) return null;
    return (
        <div className={`mixer-drawer${isPlaying ? '' : ' is-idle'}`} role="region" aria-label="Mixer">
            <div className="mixer-drawer__scroll">
                {arrangement.tracks.map((track) => <TrackStrip key={track.id ?? track.ref} track={track} active={isPlaying} />)}
            </div>
            <section className="mixer-strip mixer-strip--master" aria-label="Master mixer strip">
                <div className="mixer-strip__name">Master</div>
                <div className="mixer-master-meter"><Meter levelId="__master__" active={isPlaying} /></div>
                <span className="mixer-strip__readout">0.0 dB</span>
            </section>
        </div>
    );
}
