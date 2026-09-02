import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Arrangement, ArrangementTrack } from '../../song/types';
import { useArrangementStore } from '../../store/arrangementStore';
import { growPitchRange, initialPitchRange, useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { ClipView } from './ClipView';
import { LaneButton } from '@openjammer/oj-ui';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { PianoRollLane, applyPianoRollQuantize, auditionPianoRollNote, shouldAutoDetectDrums } from '../PianoRoll';
import { AutomationLaneView, AUTOMATION_LANE_HEIGHT } from './AutomationLaneView';
import { outputStageRefs } from '../../song/automation';
import { trackRecordInput, trackRecordKind } from '../../song/recording';
import { RecordGhost } from './RecordGhost';
import { useGraphStore } from '../../store/graphStore';
import { timebase } from '../../song/time';
import { ownPointerGesture, thresholdAxis } from './pointerGestureLifetime';
import { registerTimelineLevelWriter } from './timelineSignalLevels';
import { usePluginFaultCards } from '../../store/pluginFaultStore';
import { InstrumentLoader } from '../../audio/instrumentCatalog';
import { trackTint, trackTintHex, UNSET_SWATCH_HEX } from './trackTint';

export function TrackLaneView({ track, arrangement, pxPerTick, visibleStartTick, visibleEndTick, index = 0, shell = false }: {
    track: ArrangementTrack;
    arrangement: Arrangement;
    pxPerTick: number;
    visibleStartTick: number;
    visibleEndTick: number;
    /**
     * The track's ABSOLUTE index in the arrangement — the alternating lane tint
     * has to follow the song, not the mounted slice, or the stripes would swap
     * under the eye every time virtualization re-windows.
     */
    index?: number;
    shell?: boolean;
}) {
    const trackId = track.id ?? track.ref;
    const laneHeight = useTrackLaneViewStore((state) => state.laneHeights[trackId] ?? 72);
    const rememberedRange = useTrackLaneViewStore((state) => state.pitchRanges[trackId]);
    const rememberPitchRange = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const selectedClipIds = useEditingContextStore((state) => state.viewports.arrangement.selection.clipIds);
    const selectedTrackIds = useEditingContextStore((state) => state.viewports.arrangement.selection.trackIds);
    const selectedNoteIds = useEditingContextStore((state) => state.viewports.arrangement.selection.noteIds);
    const dragActive = useEditingContextStore((state) => state.dragActive);
    const activeClipDragIds = useEditingContextStore((state) => state.activeClipDragIds);
    const dropTargetId = useEditingContextStore((state) => state.clipDragPreview?.hoveredTrackId ?? null);
    const dropLocked = useEditingContextStore((state) => state.clipDragPreview?.locked === true);
    const expandedClipId = useTrackLaneViewStore((state) => state.expandedPianoRolls[trackId]);
    // Stable identity: `PianoRoll` memoizes its binding set on `onClose`, so a fresh
    // closure here would unregister and re-register the whole set on every render.
    const closeInlineRoll = useCallback(() => useTrackLaneViewStore.getState().closePianoRoll(trackId), [trackId]);
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
    const clips = track.clips.filter((clip) => (dragActive && clip.id !== undefined && activeClipDragIds.includes(clip.id)) || (clip.startTick + clip.lengthTick >= visibleStartTick && clip.startTick <= visibleEndTick));
    const inputLabel = trackRecordInput(arrangement, track);
    const recordKind = trackRecordKind(arrangement, track);
    const faultCards = usePluginFaultCards();
    const [drumMode, setDrumMode] = useState<boolean | undefined>(undefined);
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState(track.name ?? track.ref);
    const levelRef = useRef<HTMLSpanElement>(null);
    /*
     * The native colour picker is the one control on this surface that cannot be
     * handed a token — the OS dialog opens on a literal hex. So the lane resolves
     * its OWN computed `--track-tint` to sRGB once it is mounted, and the picker
     * opens on the colour the player can see. Before this it opened on the
     * hard-coded blue AGENTS.md and DESIGN.md both declare retired, for every
     * track that had no colour of its own -- which is all of them until someone
     * picks one.
     */
    const laneRef = useRef<HTMLDivElement>(null);
    const [swatchHex, setSwatchHex] = useState(UNSET_SWATCH_HEX);
    const tint = trackTint(track);
    /*
     * Resolved LAZILY, at the moment the picker is about to open, rather than
     * eagerly in an effect.
     *
     * The effect version was keyed on `[track, tint]` — neither of which changes
     * when the THEME does — so switching to dark left the swatch holding the
     * light theme's hex while the lane painted the dark one. That is the same
     * class of defect this whole helper exists to fix: a colour asserted once and
     * then quietly wrong.
     *
     * Resolving on `pointerdown`/`focus` fixes it at the root rather than by
     * adding a theme dependency, because "the value is correct when the dialog
     * opens" is the actual requirement, and no dependency list can be wrong about
     * that. It also takes a `getComputedStyle` plus a canvas allocation off every
     * lane's mount — with 8 tracks on screen that is 8 fewer of each per render
     * pass, paid only by the one player who actually clicks a swatch.
     */
    const resolveSwatch = useCallback(() => {
        setSwatchHex(trackTintHex(track, laneRef.current));
    }, [track]);
    /*
     * The level bead is the ONE animated element in the field region (spec D14):
     * "sound is visible" is answered here, at a stationary 3px bar under the
     * track's name, instead of by repainting every clip at 60fps. It is written
     * straight onto the DOM — never through React state — so a rolling
     * transport costs this component zero renders.
     */
    useEffect(() => registerTimelineLevelWriter((levels) => { if (levelRef.current) levelRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, levels.get(track.ref) ?? 0))})`; }), [track.ref]);
    /*
     * Soloed elsewhere: every lane that is NOT the one you are hearing drops to
     * 55%. The eye should be able to answer "what am I listening to" without
     * reading a single S button.
     */
    const dimmed = !track.solo && arrangement.tracks.some((item) => item.solo === true);
    /*
     * A benched plugin keeps playing its last good sound, but the clips it feeds
     * must say so. The fault carries a graph node id, which is exactly what a
     * track's `ref` is — so a latch on this track's instrument marks this track.
     */
    const faulted = faultCards.some((card) => card.nodeId === track.ref);
    const expandedNotes = expandedClipId ? (() => {
        const clip = track.clips.find((item) => item.id === expandedClipId);
        const clipSource = clip && arrangement.sources?.[clip.sourceId];
        return clipSource?.kind === 'midi' ? clipSource.notes : [];
    })() : [];
    /*
     * The inline roll gets the SAME kit signals the full roll gets. It used to
     * call `shouldAutoDetectDrums(expandedNotes)` bare while `PianoRoll` OR'd in
     * the instrument's percussion category first — so the roll a player meets
     * first was deciding on the weakest evidence in the system.
     */
    const effectiveDrumMode = drumMode ?? shouldAutoDetectDrums(expandedNotes, {
        instrumentIsPercussion: typeof instrument === 'string'
            && InstrumentLoader.getDefinition(instrument)?.category === 'percussion',
        trackName: track.name,
        instrumentId: typeof instrument === 'string' ? instrument : undefined,
        ppq: arrangement.ppq,
    });
    const punch = arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    const ghostStart = Math.max(recordStartTick ?? 0, punch?.startTick ?? 0);
    const ghostEnd = punch?.endTick ?? Number.POSITIVE_INFINITY;
    return (
        <div className={`arrangement-track${visibleAutomation ? ' has-automation' : ''}${selectedTrackIds.includes(trackId) ? ' is-selected' : ''}${expandedClipId ? ' has-lane-menu' : ''}${dropTargetId === trackId ? (dropLocked ? ' is-drop-invalid' : ' is-drop-target') : ''}${index % 2 === 1 ? ' is-odd' : ''}${dimmed ? ' is-dimmed' : ''}`} data-track-id={trackId} role="listitem" aria-label={track.name ?? track.ref} style={{ height: laneHeight + (visibleAutomation ? AUTOMATION_LANE_HEIGHT : 0), gridTemplateRows: visibleAutomation ? `${laneHeight}px ${AUTOMATION_LANE_HEIGHT}px` : `${laneHeight}px`, '--track-tint': tint } as CSSProperties} ref={laneRef}>
            <div className="arrangement-track__header" onPointerDown={(event) => { if (shell) return; const context = useEditingContextStore.getState(); const current = context.viewports.arrangement.selection.trackIds; if (event.ctrlKey || event.metaKey) context.setSelection('arrangement', { trackIds: current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId] }); else if (event.shiftKey) { const indices = current.map((id) => arrangement.tracks.findIndex((item) => (item.id ?? item.ref) === id)).filter((index) => index >= 0); const here = arrangement.tracks.findIndex((item) => (item.id ?? item.ref) === trackId); const anchor = indices.at(-1) ?? here; context.setSelection('arrangement', { trackIds: arrangement.tracks.slice(Math.min(anchor, here), Math.max(anchor, here) + 1).map((item) => item.id ?? item.ref) }); } else context.setSelection('arrangement', { trackIds: [trackId] }); }}>
                <span className="arrangement-track__stripe" aria-hidden="true" />
                <div className="arrangement-track__top"><button className="arrangement-track__grab" type="button" aria-label={`Reorder ${track.name ?? track.ref}`} onPointerDown={(event) => { if (shell || event.button !== 0) return; event.stopPropagation(); const startY = event.clientY; let active = false; let targetIndex = arrangement.tracks.findIndex((item) => (item.id ?? item.ref) === trackId); const cleanup = ownPointerGesture(event.pointerId, { move(move) { if (!active) active = thresholdAxis(0, move.clientY - startY, move.pointerType, false) !== null; if (!active) return; const target = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId; const index = arrangement.tracks.findIndex((item) => (item.id ?? item.ref) === target); if (index >= 0) targetIndex = index; }, commit() { cleanup(); if (active) useArrangementStore.getState().apply({ kind: 'moveTrack', trackId, index: targetIndex }); }, abort() { cleanup(); } }); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ } }}>⠿</button>{renaming ? <input className="arrangement-track__rename" aria-label={`Rename ${track.name ?? track.ref}`} autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { const name = nameDraft.trim() || track.ref; if (name !== (track.name ?? track.ref)) useArrangementStore.getState().apply({ kind: 'setTrackName', trackId, name }); setRenaming(false); } else if (event.key === 'Escape') { setNameDraft(track.name ?? track.ref); setRenaming(false); } }} onBlur={() => { const name = nameDraft.trim() || track.ref; if (name !== (track.name ?? track.ref)) useArrangementStore.getState().apply({ kind: 'setTrackName', trackId, name }); setRenaming(false); }} /> : <span className="arrangement-track__name" onDoubleClick={() => { setNameDraft(track.name ?? track.ref); setRenaming(true); }}>{track.name ?? track.ref}</span>}<span className="arrangement-track__swatch"><input type="color" aria-label={`Colour for ${track.name ?? track.ref}`} value={swatchHex} onPointerDown={resolveSwatch} onFocus={resolveSwatch} onChange={(event) => useArrangementStore.getState().apply({ kind: 'setTrackColor', trackId, color: event.target.value })} /></span></div>
                <span ref={levelRef} className="arrangement-track__level-bead" aria-hidden="true" />
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
                    {/*
                     * The roll resolves `undefined` to auto-detection, so the menu has
                     * to resolve it the SAME way. Reading the raw override here made
                     * the label say "Pitched notes" over a lane full of drum diamonds
                     * — chrome that contradicts the thing it labels.
                     */}
                    <span>{effectiveDrumMode ? 'Drum rows' : 'Pitched notes'}</span>
                    <button type="button" aria-pressed={effectiveDrumMode} onClick={() => setDrumMode(!effectiveDrumMode)}>Drums</button>
                    <button className="arrangement-lane-menu__quantize" type="button" disabled={!selectedNoteIds.length} title="Quantize the selected notes" onClick={() => applyPianoRollQuantize(selectedNoteIds, 'arrangement')}>Quantize</button>
                    <button type="button" aria-pressed={useEditingContextStore.getState().stepEntry.trackId === trackId} onClick={() => {
                        const editing = useEditingContextStore.getState();
                        editing.setStepEntry({ trackId: editing.stepEntry.trackId === trackId ? null : trackId, positionTick: arrangement.tracks.find((item) => (item.id ?? item.ref) === trackId)?.clips.find((clip) => clip.id === expandedClipId)?.startTick ?? 0 });
                    }}>Step</button>
                    <button className="arrangement-lane-menu__close" type="button" aria-label="Close piano roll" onClick={() => useTrackLaneViewStore.getState().closePianoRoll(trackId)}>⌃</button>
                </div>}
            </div>
            <div className={`arrangement-lane${track.mute ? ' is-muted' : ''}${expandedClipId ? ' has-piano-roll' : ''}`} style={{ height: laneHeight }} role="list" onPointerEnter={() => useEditingContextStore.setState({ enteredTrackId: trackId })}>
                {expandedClipId ? <PianoRollLane trackId={trackId} clipId={expandedClipId} pxPerTick={pxPerTick} leftTick={visibleStartTick} height={220} drumMode={drumMode} onDrumModeChange={setDrumMode} onClose={closeInlineRoll} onOpenSurface={() => {
                    const arrangementViewport = useEditingContextStore.getState().viewports.arrangement;
                    useEditingContextStore.getState().setViewport('pianoroll', { pxPerTick: arrangementViewport.pxPerTick, leftTick: arrangementViewport.leftTick });
                    useEditingContextStore.getState().setSelection('pianoroll', { clipIds: [expandedClipId] });
                    useUiViewStore.getState().openPianoRoll(expandedClipId);
                }} onQuantize={applyPianoRollQuantize} onAudition={(pitch, velocity, phase, token) => auditionPianoRollNote(track.ref, pitch, velocity, phase, token)} /> : clips.map((clip) => {
                    const source = arrangement.sources?.[clip.sourceId];
                    const takeCount = track.clips.filter((item) => item.startTick < clip.startTick + clip.lengthTick && clip.startTick < item.startTick + item.lengthTick && (item.layerIndex !== undefined || clip.layerIndex !== undefined)).length;
                    return source && clip.id ? <ClipView key={clip.id} clip={clip} source={source} trackName={track.name ?? track.ref} trackId={trackId} range={range} pxPerTick={pxPerTick} laneHeight={laneHeight} timebase={timebase(arrangement)} selected={selectedClipIds.includes(clip.id)} faulted={faulted} takeCount={takeCount} onDoubleClick={source.kind === 'midi' ? () => useTrackLaneViewStore.getState().togglePianoRoll(trackId, clip.id!) : undefined} onSelect={(event, phase) => {
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
                {!expandedClipId && track.clips.length === 0 && <div className="arrangement-lane__hint">drag audio here · press B and draw</div>}
                {!expandedClipId && isRecording && armed && binding && recordStartTick !== null && <RecordGhost node={binding.node} startTick={ghostStart} endTick={ghostEnd} pxPerTick={pxPerTick} laneHeight={laneHeight} notes={ghostNotes} pitchRange={range} />}
            </div>
            {visibleAutomation && <AutomationLaneView arrangement={arrangement} track={track} lane={visibleAutomation} pxPerTick={pxPerTick} />}
            {!shell && <div className="arrangement-lane__resize" role="separator" aria-orientation="horizontal" aria-label={`Resize ${track.name ?? track.ref} lane`} tabIndex={0} style={{ top: laneHeight - 5 }} onDoubleClick={() => { const view = useTrackLaneViewStore.getState(); view.setLaneHeight(trackId, view.expandedPianoRolls[trackId] ? 220 : 72); }} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); const startY = event.clientY; const before = laneHeight; const all = event.altKey; const ids = arrangement.tracks.map((item) => item.id ?? item.ref); const cleanup = ownPointerGesture(event.pointerId, { move(move) { const next = before + move.clientY - startY; const view = useTrackLaneViewStore.getState(); if (all) view.setAllLaneHeights(ids, next); else view.setLaneHeight(trackId, next); }, commit() { cleanup(); }, abort() { const view = useTrackLaneViewStore.getState(); if (all) view.setAllLaneHeights(ids, before); else view.setLaneHeight(trackId, before); cleanup(); } }); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ } }} />}
        </div>
    );
}
