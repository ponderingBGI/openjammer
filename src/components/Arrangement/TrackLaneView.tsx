import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { trackRecordInput, trackRecordKind } from '../../song/recording';
import { RecordGhost } from './RecordGhost';
import { useGraphStore } from '../../store/graphStore';

const TRACK_TINTS = ['var(--accent-secondary)', 'var(--accent-success)', 'var(--accent-warning)', 'var(--accent-danger)', 'var(--sketch-gray)'];

export function TrackLaneView({ track, arrangement, pxPerTick, visibleStartTick, visibleEndTick, shell = false }: {
    track: ArrangementTrack;
    arrangement: Arrangement;
    pxPerTick: number;
    visibleStartTick: number;
    visibleEndTick: number;
    shell?: boolean;
}) {
    const trackId = track.id ?? track.ref;
    const laneHeight = useTrackLaneViewStore((state) => state.laneHeights[trackId] ?? 72);
    const rememberedRange = useTrackLaneViewStore((state) => state.pitchRanges[trackId]);
    const rememberPitchRange = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const selectedClipIds = useEditingContextStore((state) => state.viewports.arrangement.selection.clipIds);
    const selectedTrackIds = useEditingContextStore((state) => state.viewports.arrangement.selection.trackIds);
    const selectedNoteIds = useEditingContextStore((state) => state.viewports.arrangement.selection.noteIds);
    const expandedClipId = useTrackLaneViewStore((state) => state.expandedPianoRolls[trackId]);
    const visibleAutomationId = useTrackLaneViewStore((state) => state.automationLaneByTrack[trackId]);
    const visibleAutomation = (track.automation ?? []).find((lane) => lane.id === visibleAutomationId);
    const armed = useArrangementStore((state) => state.armedTrackIds.includes(trackId));
    const isRecording = useArrangementStore((state) => state.isRecording);
    const recordStartTick = useArrangementStore((state) => state.recordStartTick);
    const ghostNotes = useArrangementStore((state) => state.ghostNotes);
    const binding = useArrangementStore((state) => state.recordingBindings.find((item) => item.trackId === trackId));
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
    const inputLabel = trackRecordInput(arrangement, track);
    const recordKind = trackRecordKind(arrangement, track);
    const [drumMode, setDrumMode] = useState<boolean | undefined>(undefined);
    const tintIndex = [...trackId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % TRACK_TINTS.length;
    const punch = arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    const ghostStart = Math.max(recordStartTick ?? 0, punch?.startTick ?? 0);
    const ghostEnd = punch?.endTick ?? Number.POSITIVE_INFINITY;
    return (
        <div className={`arrangement-track${visibleAutomation ? ' has-automation' : ''}${selectedTrackIds.includes(trackId) ? ' is-selected' : ''}${expandedClipId ? ' has-lane-menu' : ''}`} data-track-id={trackId} role="listitem" aria-label={track.name ?? track.ref} style={{ height: laneHeight + (visibleAutomation ? AUTOMATION_LANE_HEIGHT : 0), gridTemplateRows: visibleAutomation ? `${laneHeight}px ${AUTOMATION_LANE_HEIGHT}px` : `${laneHeight}px`, '--track-tint': track.color ?? TRACK_TINTS[tintIndex] } as CSSProperties}>
            <div className="arrangement-track__header" onPointerDown={() => { if (!shell) useEditingContextStore.getState().setSelection('arrangement', { trackIds: [trackId] }); }}>
                <span className="arrangement-track__stripe" />
                <div className="arrangement-track__top"><span className="arrangement-track__grab" aria-hidden="true">⠿</span><span className="arrangement-track__name">{track.name ?? track.ref}</span></div>
                <div className="arrangement-track__controls">
                    <LaneButton tone="mute" aria-label={`Mute ${track.name ?? track.ref}`} aria-pressed={track.mute === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackMute', trackId, mute: !track.mute })}>M</LaneButton>
                    <LaneButton tone="solo" aria-label={`Solo ${track.name ?? track.ref}`} aria-pressed={track.solo === true} onClick={() => useArrangementStore.getState().apply({ kind: 'setTrackSolo', trackId, solo: !track.solo })}>S</LaneButton>
                    <LaneButton className={`arrangement-arm${isRecording && armed ? ' is-recording' : ''}`} aria-label={`${armed ? 'Disarm' : 'Arm'} ${track.name ?? track.ref} for ${recordKind === 'audio' ? 'audio' : 'MIDI'} recording`} aria-pressed={armed} title={`${recordKind === 'audio' ? 'Audio input' : 'MIDI input'}: ${inputLabel}`} onClick={() => useArrangementStore.getState().armTrack(trackId, !armed)}><span aria-hidden="true">●</span></LaneButton>
                    <LaneButton aria-label={`${visibleAutomation ? 'Hide' : 'Show'} automation for ${track.name ?? track.ref}`} aria-pressed={Boolean(visibleAutomation)} onClick={() => {
                        const view = useTrackLaneViewStore.getState();
                        if (visibleAutomation) return view.showAutomationLane(trackId, null);
                        const existing = track.automation?.[0];
                        if (existing?.id) return view.showAutomationLane(trackId, existing.id);
                        const store = useArrangementStore.getState();
                        const laneId = store.mintId('lane');
                        store.apply({ kind: 'addAutomationLane', trackId, index: 0, lane: { id: laneId, ref: outputStageRefs(track).gain, param: 0, points: [] } });
                        view.showAutomationLane(trackId, laneId);
                    }}>A</LaneButton>
                    <span className="arrangement-instrument-chip" title={`${typeof instrument === 'string' ? instrument : track.ref} · ${inputLabel}`}>
                    <button className="arrangement-instrument-chip__name" type="button" onClick={(event) => {
                        event.stopPropagation();
                        if (shell) return;
                        useGraphStore.getState().selectNode(track.ref);
                        useUiViewStore.getState().setSurface('canvas');
                    }}>{typeof instrument === 'string' ? instrument : track.ref}</button>
                    <button className="arrangement-instrument-chip__swap" type="button" aria-label={`Choose instrument for ${track.name ?? track.ref}`} onClick={(event) => { event.stopPropagation(); if (!shell) window.dispatchEvent(new CustomEvent('openjammer:open-browser', { detail: { context: 'pick', trackId } })); }}>⌄</button>
                    </span>
                </div>
                {expandedClipId && <div className="arrangement-track__lane-menu">
                    <span>{drumMode ? 'Drum rows' : 'Pitched notes'}</span>
                    <button type="button" aria-pressed={drumMode === true} onClick={() => setDrumMode((current) => !current)}>Drums</button>
                    <button className="arrangement-lane-menu__quantize" type="button" onClick={() => applyPianoRollQuantize(selectedNoteIds)}>{selectedNoteIds.length ? 'Quantize' : 'select notes to quantize'}</button>
                    <button type="button" aria-pressed={useEditingContextStore.getState().stepEntry.trackId === trackId} onClick={() => {
                        const editing = useEditingContextStore.getState();
                        editing.setStepEntry({ trackId: editing.stepEntry.trackId === trackId ? null : trackId, positionTick: arrangement.tracks.find((item) => (item.id ?? item.ref) === trackId)?.clips.find((clip) => clip.id === expandedClipId)?.startTick ?? 0 });
                    }}>Step</button>
                    <span>Velocity</span>
                    <button className="arrangement-lane-menu__close" type="button" aria-label="Close piano roll" onClick={() => useTrackLaneViewStore.getState().closePianoRoll(trackId)}>⌃</button>
                </div>}
            </div>
            <div className={`arrangement-lane${track.mute ? ' is-muted' : ''}${expandedClipId ? ' has-piano-roll' : ''}`} style={{ height: laneHeight }} role="list" onPointerEnter={() => useEditingContextStore.setState({ enteredTrackId: trackId })}>
                {expandedClipId ? <PianoRollLane trackId={trackId} clipId={expandedClipId} pxPerTick={pxPerTick} leftTick={visibleStartTick} height={220} drumMode={drumMode} onDrumModeChange={setDrumMode} onOpenSurface={() => {
                    const arrangementViewport = useEditingContextStore.getState().viewports.arrangement;
                    useEditingContextStore.getState().setViewport('pianoroll', { pxPerTick: arrangementViewport.pxPerTick, leftTick: arrangementViewport.leftTick });
                    useEditingContextStore.getState().setSelection('pianoroll', { clipIds: [expandedClipId] });
                    useUiViewStore.getState().openPianoRoll(expandedClipId);
                }} onQuantize={applyPianoRollQuantize} onAudition={(pitch, velocity, phase) => auditionPianoRollNote(track.ref, pitch, velocity, phase)} /> : clips.map((clip) => {
                    const source = arrangement.sources?.[clip.sourceId];
                    const takeCount = track.clips.filter((item) => item.startTick < clip.startTick + clip.lengthTick && clip.startTick < item.startTick + item.lengthTick && (item.layerIndex !== undefined || clip.layerIndex !== undefined)).length;
                    return source && clip.id ? <ClipView key={clip.id} clip={clip} source={source} trackName={track.name ?? track.ref} trackId={trackId} range={range} pxPerTick={pxPerTick} laneHeight={laneHeight} selected={selectedClipIds.includes(clip.id)} takeCount={takeCount} onDoubleClick={source.kind === 'midi' ? () => useTrackLaneViewStore.getState().togglePianoRoll(trackId, clip.id!) : undefined} onSelect={(event, phase) => {
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
                {!expandedClipId && isRecording && armed && binding && recordStartTick !== null && <RecordGhost node={binding.node} startTick={ghostStart} endTick={ghostEnd} pxPerTick={pxPerTick} laneHeight={laneHeight} notes={ghostNotes} pitchRange={range} />}
            </div>
            {visibleAutomation && <AutomationLaneView arrangement={arrangement} track={track} lane={visibleAutomation} pxPerTick={pxPerTick} />}
        </div>
    );
}
