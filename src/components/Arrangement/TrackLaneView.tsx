import { useEffect, useMemo } from 'react';
import type { Arrangement, ArrangementTrack } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';
import { growPitchRange, initialPitchRange, useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { ClipView } from './ClipView';
import { LaneButton } from '@openjammer/oj-ui';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { PianoRollLane, applyPianoRollQuantize, auditionPianoRollNote } from '../PianoRoll';
import { AutomationLaneView, AUTOMATION_LANE_HEIGHT } from './AutomationLaneView';
import { outputStageRefs } from '../../song/automation';

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
    const selectedClipIds = useEditingContextStore((state) => state.viewports.arrangement.selection.clipIds);
    const expandedClipId = useTrackLaneViewStore((state) => state.expandedPianoRolls[trackId]);
    const visibleAutomationId = useTrackLaneViewStore((state) => state.automationLaneByTrack[trackId]);
    const visibleAutomation = (track.automation ?? []).find((lane) => lane.id === visibleAutomationId);
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
        <div className={`arrangement-track${visibleAutomation ? ' has-automation' : ''}`} data-track-id={trackId} role="listitem" aria-label={track.name ?? track.ref} style={{ height: laneHeight + (visibleAutomation ? AUTOMATION_LANE_HEIGHT : 0), gridTemplateRows: visibleAutomation ? `${laneHeight}px ${AUTOMATION_LANE_HEIGHT}px` : `${laneHeight}px` }}>
            <div className="arrangement-track__header">
                <span className="arrangement-track__stripe" />
                <div className="arrangement-track__top"><span className="arrangement-track__grab" aria-hidden="true">⠿</span><span className="arrangement-track__name">{track.name ?? track.ref}</span></div>
                <div className="arrangement-track__controls">
                    <LaneButton tone="mute" aria-label={`Mute ${track.name ?? track.ref}`} aria-pressed={track.mute === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackMute', trackId, mute: !track.mute })}>M</LaneButton>
                    <LaneButton tone="solo" aria-label={`Solo ${track.name ?? track.ref}`} aria-pressed={track.solo === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackSolo', trackId, solo: !track.solo })}>S</LaneButton>
                    <LaneButton aria-label={`${visibleAutomation ? 'Hide' : 'Show'} automation for ${track.name ?? track.ref}`} aria-pressed={Boolean(visibleAutomation)} onClick={() => {
                        const view = useTrackLaneViewStore.getState();
                        if (visibleAutomation) {
                            view.showAutomationLane(trackId, null);
                            return;
                        }
                        const existing = track.automation?.[0];
                        if (existing?.id) {
                            view.showAutomationLane(trackId, existing.id);
                            return;
                        }
                        const store = useArrangementStore.getState();
                        const laneId = store.mintId('lane');
                        const ref = outputStageRefs(track).gain;
                        store.apply({ kind: 'addAutomationLane', trackId, index: 0, lane: { id: laneId, ref, param: 0, points: [] } });
                        view.showAutomationLane(trackId, laneId);
                    }}>A</LaneButton>
                    <span className="arrangement-instrument-chip">{typeof instrument === 'string' ? instrument : track.ref}</span>
                </div>
            </div>
            <div className={`arrangement-lane${track.mute ? ' is-muted' : ''}${expandedClipId ? ' has-piano-roll' : ''}`} style={{ height: laneHeight }} role="list" onPointerEnter={() => useEditingContextStore.setState({ enteredTrackId: trackId })}>
                {expandedClipId ? <PianoRollLane trackId={trackId} clipId={expandedClipId} pxPerTick={pxPerTick} leftTick={visibleStartTick} height={220} onClose={() => useTrackLaneViewStore.getState().closePianoRoll(trackId)} onOpenSurface={() => {
                    const arrangementViewport = useEditingContextStore.getState().viewports.arrangement;
                    useEditingContextStore.getState().setViewport('pianoroll', { pxPerTick: arrangementViewport.pxPerTick, leftTick: arrangementViewport.leftTick });
                    useEditingContextStore.getState().setSelection('pianoroll', { clipIds: [expandedClipId] });
                    useUiViewStore.getState().openPianoRoll(expandedClipId);
                }} onQuantize={applyPianoRollQuantize} onAudition={(pitch, velocity, phase) => auditionPianoRollNote(track.ref, pitch, velocity, phase)} /> : clips.map((clip) => {
                    const source = arrangement.sources?.[clip.sourceId];
                    return source && clip.id ? <ClipView key={clip.id} clip={clip} source={source} trackName={track.name ?? track.ref} trackId={trackId} range={range} pxPerTick={pxPerTick} laneHeight={laneHeight} selected={selectedClipIds.includes(clip.id)} onDoubleClick={source.kind === 'midi' ? () => useTrackLaneViewStore.getState().togglePianoRoll(trackId, clip.id!) : undefined} onSelect={(event, phase) => {
                        event.stopPropagation();
                        const context = useEditingContextStore.getState();
                        if (phase === 'press') context.beginSelectionOp('arrangement');
                        const current = context.viewports.arrangement.selection.clipIds;
                        const primary = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
                        const extend = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
                        if (primary && phase === 'press') {
                            context.setSelection('arrangement', { clipIds: current.includes(clip.id!) ? current.filter((id) => id !== clip.id) : [...current, clip.id!] });
                        } else if (extend && phase === 'press') {
                            const selected = arrangement.tracks.flatMap((item) => item.clips).filter((item) => item.id !== undefined && current.includes(item.id));
                            const from = selected.length ? Math.min(...selected.map((item) => item.startTick)) : clip.startTick;
                            const to = Math.max(clip.startTick + clip.lengthTick, ...(selected.map((item) => item.startTick + item.lengthTick)));
                            const ids = arrangement.tracks.flatMap((item) => item.clips).filter((item) => item.startTick < to && item.startTick + item.lengthTick > Math.min(from, clip.startTick)).map((item) => item.id!);
                            context.setSelection('arrangement', { clipIds: [...new Set([...current, ...ids])] });
                        } else if (!primary && !extend && ((phase === 'press' && !current.includes(clip.id!)) || phase === 'release')) {
                            context.setSelection('arrangement', { clipIds: [clip.id!] });
                        }
                        if (phase === 'release') context.commitSelectionOp('arrangement');
                    }} /> : null;
                })}
                {!expandedClipId && track.clips.length === 0 && <div className="arrangement-lane__hint">drag audio here, or press D and draw.</div>}
            </div>
            {visibleAutomation && <AutomationLaneView arrangement={arrangement} track={track} lane={visibleAutomation} pxPerTick={pxPerTick} />}
        </div>
    );
}
