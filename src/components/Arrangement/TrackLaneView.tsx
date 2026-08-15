import { useEffect, useMemo, useState } from 'react';
import type { Arrangement, ArrangementTrack } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';
import { growPitchRange, initialPitchRange, useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { ClipView } from './ClipView';
import { LaneButton } from '@openjammer/oj-ui';

export function TrackLaneView({ track, arrangement, pxPerTick, visibleStartTick, visibleEndTick }: {
    track: ArrangementTrack;
    arrangement: Arrangement;
    pxPerTick: number;
    visibleStartTick: number;
    visibleEndTick: number;
}) {
    const trackId = track.id ?? track.ref;
    const laneHeight = useTrackLaneViewStore((state) => state.laneHeights[trackId] ?? 72);
    const rememberedRange = useTrackLaneViewStore((state) => state.pitchRanges[trackId]);
    const rememberPitchRange = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const selectedClipId = useArrangementStore((state) => state.selectedClipId);
    const [soloed, setSoloed] = useState(false);
    const sourceNotes = useMemo(() => track.clips.flatMap((clip) => {
        const source = arrangement.sources?.[clip.sourceId];
        return source?.kind === 'midi' ? source.notes : [];
    }), [arrangement.sources, track.clips]);
    const min = sourceNotes.reduce((value, note) => Math.min(value, note.pitch), Infinity);
    const max = sourceNotes.reduce((value, note) => Math.max(value, note.pitch), -Infinity);
    const range = rememberedRange ? growPitchRange(rememberedRange, min, max) : initialPitchRange(min, max);
    useEffect(() => rememberPitchRange(trackId, range), [rememberPitchRange, trackId, range]);
    const instrument = arrangement.graph.nodes.find((node) => node.ref === track.ref)?.data?.instrumentId;
    const clips = track.clips.filter((clip) => clip.startTick + clip.lengthTick >= visibleStartTick && clip.startTick <= visibleEndTick);
    return (
        <div className="arrangement-track" role="listitem" aria-label={track.name ?? track.ref} style={{ height: laneHeight }}>
            <div className="arrangement-track__header">
                <span className="arrangement-track__stripe" />
                <div className="arrangement-track__top"><span className="arrangement-track__grab" aria-hidden="true">⠿</span><span className="arrangement-track__name">{track.name ?? track.ref}</span></div>
                <div className="arrangement-track__controls">
                    <LaneButton tone="mute" aria-label={`Mute ${track.name ?? track.ref}`} aria-pressed={track.mute === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackMute', trackId, mute: !track.mute })}>M</LaneButton>
                    <LaneButton tone="solo" aria-label={`Solo ${track.name ?? track.ref}`} aria-pressed={soloed} onClick={() => setSoloed((value) => !value)}>S</LaneButton>
                    <span className="arrangement-instrument-chip">{typeof instrument === 'string' ? instrument : track.ref}</span>
                </div>
            </div>
            <div className={`arrangement-lane${track.mute ? ' is-muted' : ''}`} role="list" onClick={() => useArrangementStore.getState().selectClip(null)}>
                {clips.map((clip) => {
                    const source = arrangement.sources?.[clip.sourceId];
                    return source && clip.id ? <ClipView key={clip.id} clip={clip} source={source} trackName={track.name ?? track.ref} range={range} pxPerTick={pxPerTick} laneHeight={laneHeight} selected={selectedClipId === clip.id} onSelect={() => useArrangementStore.getState().selectClip(clip.id!)} /> : null;
                })}
                {track.clips.length === 0 && <div className="arrangement-lane__hint">drag audio here, or press D and draw.</div>}
            </div>
        </div>
    );
}
