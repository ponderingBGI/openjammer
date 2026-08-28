import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Kbd } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { useBindingSet } from '../../keymap/useKeymap';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { buildTempoMap, sampleToTick } from '../../song/tempoMap';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import { buildFirstLight } from '../../song/songs/firstLight';
import { TransportStrip } from './TransportStrip';
import { RulerStack } from './RulerStack';
import { GridLayer } from './GridLayer';
import { TrackLaneView } from './TrackLaneView';
import { PlayheadLayer } from './PlayheadLayer';
import { deleteTime, duplicateClips, insertTime, nudge, splitAt } from '../../song/ops';
import { gridTicks } from '../../store/editingContextStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUiViewStore } from '../../store/uiViewStore';
import './ArrangementSurface.css';
import { MixerDrawer } from './MixerDrawer';
import { AUTOMATION_LANE_HEIGHT } from './AutomationLaneView';
import { copySelection, cutSelection, deleteSelection, duplicateSelectedRange, loopFromSelection, paste, splitSelectedRange } from '../../song/editingActions';
import { virtualizationWindow } from './geometry';

function parseMusicalDuration(value: string, ticksPerBeat: number, ticksPerBar: number): number | null {
    const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(bars?|beats?)?$/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!(amount > 0)) return null;
    return Math.max(1, Math.round(amount * ((match[2]?.startsWith('beat')) ? ticksPerBeat : ticksPerBar)));
}

const HEADER_WIDTH = 200;
const RULER_HEIGHT = 46;
const EMPTY_GHOST_BARS = 32;
const EMPTY_GHOST_TRACKS = buildPaperSketch().tracks.map((track, index) => ({ ...track, id: `empty-ghost-${index}`, name: `Track ${index + 1}`, clips: [], automation: undefined }));
const EMPTY_TRACK_ARRANGEMENT = { name: 'Untitled song', tempoBpm: 120, ppq: 960, timeSignature: [4, 4] as [number, number], graph: { nodes: [], connections: [] }, tracks: [{ id: 'track-1', name: 'Track 1', ref: 'track-1', clips: [] }] };

export function ArrangementSurface({ active, visible = active, transition, songNodeId, onOpenSettings }: { active: boolean; visible?: boolean; transition?: 'in' | 'out'; songNodeId: string | null; onOpenSettings?: () => void }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const viewport = useEditingContextStore((state) => state.viewports.arrangement);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const laneHeights = useTrackLaneViewStore((state) => state.laneHeights);
    const automationLaneByTrack = useTrackLaneViewStore((state) => state.automationLaneByTrack);
    const mixerOpen = useTrackLaneViewStore((state) => state.mixerOpen);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ width: 1000, height: 600, left: 0, top: 0 });
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number; mode: 'object' | 'range' } | null>(null);
    const [timePrompt, setTimePrompt] = useState<'insert' | 'delete' | null>(null);
    const [timeAmount, setTimeAmount] = useState('1 bar');
    const [timeScope, setTimeScope] = useState<'selected-tracks' | 'all'>('selected-tracks');
    const [timeError, setTimeError] = useState('');
    const marqueeStart = useRef<{ x: number; y: number; clientX: number; clientY: number; pointerId: number; add: boolean; toggle: boolean; mode: 'object' | 'range'; tick: number; trackId: string } | null>(null);
    const scrollbarFade = useRef<number | null>(null);

    useBindingSet(useMemo(() => ({
        id: 'arrangement-surface',
        scope: 'surface' as const,
        surface: 'arrangement' as const,
        entries: [
            { actionId: 'arrangement.transport', guard: (event: KeyboardEvent) => !event.repeat, run: () => { const store = useArrangementStore.getState(); if (store.isPlaying) store.stop(); else store.play(); return true; } },
            { actionId: 'arrangement.undo', run: () => { useHistoryStore.getState().undo(); return true; } },
            { actionId: 'arrangement.redo', run: () => { useHistoryStore.getState().redo(); return true; } },
            { actionId: 'arrangement.selectionUndo', run: () => { useEditingContextStore.getState().undoSelection('arrangement'); return true; } },
            { actionId: 'arrangement.selectionRedo', run: () => { useEditingContextStore.getState().redoSelection('arrangement'); return true; } },
            { actionId: 'arrangement.cut', run: () => { cutSelection('arrangement'); return true; } },
            { actionId: 'arrangement.copy', run: () => { copySelection('arrangement'); return true; } },
            { actionId: 'arrangement.paste', run: () => { paste({ surface: 'arrangement' }); return true; } },
            { actionId: 'arrangement.zoomToSelection', run: () => false },
            ...['arrangement.delete', 'arrangement.deleteBackspace'].map((actionId) => ({ actionId, run: () => { deleteSelection('arrangement'); return true; } })),
            { actionId: 'arrangement.duplicate', run: () => { if (duplicateSelectedRange()) return true; const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const amount = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; const result = duplicateClips(arr, context.viewports.arrangement.selection.clipIds, amount, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            ...([['arrangement.nudgeLeft', -1, false], ['arrangement.nudgeRight', 1, false], ['arrangement.nudgeLeftFine', -1, true], ['arrangement.nudgeRightFine', 1, true]] as const).map(([actionId, direction, fine]) => ({ actionId, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const grid = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; store.apply(nudge(arr, context.viewports.arrangement.selection.clipIds, fine ? Math.max(1, Math.round(grid / 16)) : grid, direction).verbs); return true; } })),
            { actionId: 'arrangement.split', run: () => { if (splitSelectedRange()) return true; const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const editTick = store.transportPending === 'seek' && store.pendingSeekSample != null ? sampleToTick(buildTempoMap(arr), store.pendingSeekSample) : store.playheadTick; const result = splitAt(arr, context.viewports.arrangement.selection.clipIds, editTick, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            { actionId: 'arrangement.toggleRipple', run: () => { const context = useEditingContextStore.getState(); context.setEditMode(context.editMode === 'ripple' ? 'slide' : 'ripple'); return true; } },
            { actionId: 'arrangement.escape', guard: () => !useEditingContextStore.getState().dragActive, run: () => { useEditingContextStore.getState().clearSelection('arrangement'); return true; } },
            { actionId: 'arrangement.openPianoRoll', run: () => {
                const store = useArrangementStore.getState();
                const arr = store.arrangement;
                const context = useEditingContextStore.getState();
                const clipId = context.viewports.arrangement.selection.clipIds[0];
                if (!arr || !clipId) return true;
                const clip = arr.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
                if (!clip || arr.sources?.[clip.sourceId]?.kind !== 'midi') return true;
                const source = context.viewports.arrangement;
                context.setViewport('pianoroll', { pxPerTick: source.pxPerTick, leftTick: source.leftTick });
                context.setSelection('pianoroll', { clipIds: [clipId], noteIds: [] });
                useUiViewStore.getState().openPianoRoll(clipId);
                requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-surface-root="pianoroll"]')?.focus({ preventScroll: true }));
                return true;
            } },
        ],
    }), []));

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const measure = () => setView((current) => ({ ...current, width: element.clientWidth, height: element.clientHeight }));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [arrangement]);

    useEffect(() => {
        const prompt = (event: Event) => { const mode = (event as CustomEvent<{ mode: 'insert' | 'delete' }>).detail?.mode; if (mode) { setTimePrompt(mode); setTimeError(''); } };
        const loopSelection = () => loopFromSelection();
        window.addEventListener('openjammer:time-prompt', prompt);
        window.addEventListener('openjammer:loop-from-selection', loopSelection);
        return () => { window.removeEventListener('openjammer:time-prompt', prompt); window.removeEventListener('openjammer:loop-from-selection', loopSelection); };
    }, []);

    useEffect(() => () => {
        if (scrollbarFade.current !== null) window.clearTimeout(scrollbarFade.current);
    }, []);

    if (!arrangement) {
        return (
            <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active}>
                <TransportStrip fieldWidth={view.width - HEADER_WIDTH} onOpenSettings={onOpenSettings} />
                <div className="arrangement-empty-stage">
                    <div className="arrangement-empty-ghost" aria-hidden="true" inert>
                        <RulerStack fieldWidth={Math.max(1, view.width - HEADER_WIDTH)} contentWidth={Math.max(1, view.width - HEADER_WIDTH)} scrollLeft={0} pxPerTick={(Math.max(1, view.width - HEADER_WIDTH)) / (EMPTY_GHOST_BARS * 960 * 4)} ticksPerBar={960 * 4} beatsPerBar={4} gridUnit="adaptive" snapOn sections={[]} songEnd={EMPTY_GHOST_BARS * 960 * 4} onSeek={() => undefined} onToggleSnap={() => undefined} />
                        <div className="arrangement-lanes" role="list" aria-label="Tracks">
                            {EMPTY_GHOST_TRACKS.map((track) => <TrackLaneView key={track.id} track={track} arrangement={{ ...EMPTY_TRACK_ARRANGEMENT, tracks: EMPTY_GHOST_TRACKS }} pxPerTick={1} visibleStartTick={0} visibleEndTick={0} shell />)}
                        </div>
                    </div>
                    <div className="arrangement-empty-card">
                        <h1>An empty page.</h1>
                        <p>Start a sketch, or ask the agent to dream one up. Ctrl+Z undoes anything.</p>
                        <div className="arrangement-empty-starters">
                            <Button variant="primary" onClick={() => useArrangementStore.getState().setArrangement({ ...buildPaperSketch(), codeNodes: undefined })}>Start from 'Paper Sketch'</Button>
                            <Button onClick={() => useArrangementStore.getState().setArrangement(buildFirstLight())}>Start from 'First Light'</Button>
                        </div>
                        <button className="arrangement-empty-secondary" type="button" onClick={() => useArrangementStore.getState().setArrangement(EMPTY_TRACK_ARRANGEMENT)}>Add an empty track</button>
                        <div className="arrangement-empty-footer"><Kbd>Tab</Kbd><span>back to the canvas</span></div>
                    </div>
                </div>
            </div>
        );
    }

    const tb = timebase(arrangement);
    const lengthTicks = arrangementLengthTicks(arrangement);
    const fieldViewportWidth = Math.max(1, view.width - HEADER_WIDTH);
    const contentWidth = Math.max(fieldViewportWidth, lengthTicks * viewport.pxPerTick + fieldViewportWidth * 0.25);
    const sections = (arrangement.locations ?? []).filter((location) => location.kind === 'section');
    const loop = (arrangement.locations ?? []).find((location) => location.kind === 'loop');
    const heights = arrangement.tracks.map((track) => (laneHeights[track.id ?? track.ref] ?? 72) + (automationLaneByTrack[track.id ?? track.ref] ? AUTOMATION_LANE_HEIGHT : 0));
    const { offsets, laneTop, firstLane, lastLane, visibleStartTick, visibleEndTick } = virtualizationWindow(
        heights, view, viewport.pxPerTick, HEADER_WIDTH, RULER_HEIGHT,
    );

    const seekFromClientX = (clientX: number) => {
        const rect = scrollRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = clientX - rect.left - HEADER_WIDTH + view.left;
        useArrangementStore.getState().seek(x / viewport.pxPerTick);
    };

    return (
        <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active}>
            <TransportStrip fieldWidth={fieldViewportWidth} onOpenSettings={onOpenSettings} />
            <div
                className="arrangement-scroll"
                ref={scrollRef}
                onScroll={(event) => {
                    const target = event.currentTarget;
                    target.classList.add('is-scrolling');
                    if (scrollbarFade.current !== null) window.clearTimeout(scrollbarFade.current);
                    scrollbarFade.current = window.setTimeout(() => target.classList.remove('is-scrolling'), 200);
                    requestAnimationFrame(() => {
                        setView((current) => ({ ...current, left: target.scrollLeft, top: target.scrollTop }));
                        useEditingContextStore.getState().setViewport('arrangement', { leftTick: target.scrollLeft / viewport.pxPerTick, yOrigin: target.scrollTop });
                    });
                }}
                onWheel={(event) => {
                    if (!(event.ctrlKey || event.metaKey)) return;
                    event.preventDefault();
                    const scroll = scrollRef.current;
                    if (!scroll) return;
                    const pointer = event.clientX - scroll.getBoundingClientRect().left - HEADER_WIDTH;
                    useEditingContextStore.getState().zoomAt('arrangement', Math.max(0, pointer), Math.exp(-event.deltaY * 0.002), tb.ticksPerBar);
                    requestAnimationFrame(() => {
                        const next = useEditingContextStore.getState().viewports.arrangement;
                        scroll.scrollLeft = next.leftTick * next.pxPerTick;
                    });
                }}
            >
                <div
                    className="arrangement-timeline-content"
                    style={{ width: HEADER_WIDTH + contentWidth, minHeight: RULER_HEIGHT + offsets.at(-1)! + view.height * 0.4 }}
                    onPointerDown={(event) => {
                        if (event.button !== 0 || !(event.target as HTMLElement).closest('.arrangement-lane') || (event.target as HTMLElement).closest('.arrangement-clip')) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const lane = (event.target as HTMLElement).closest<HTMLElement>('.arrangement-lane')!;
                        const laneRect = lane.getBoundingClientRect();
                        const trackId = lane.closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? '';
                        const inAutomation = Boolean((event.target as HTMLElement).closest('.automation-lane'));
                        const mode = !inAutomation && (event.clientY - laneRect.top) / laneRect.height < 0.5 ? 'range' : 'object';
                        const tick = Math.max(0, (event.clientX - rect.left - HEADER_WIDTH) / viewport.pxPerTick);
                        const exactExtend = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
                        const exactToggle = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
                        useEditingContextStore.getState().beginSelectionOp('arrangement');
                        marqueeStart.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, add: exactExtend, toggle: exactToggle, mode, tick, trackId };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const start = marqueeStart.current;
                        if (!start || start.pointerId !== event.pointerId) return;
                        const dx = event.clientX - start.clientX;
                        const dy = event.clientY - start.clientY;
                        if (!marquee && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                        setMarquee({ x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy), mode: start.mode });
                    }}
                    onPointerUp={(event) => {
                        const start = marqueeStart.current;
                        if (!start || start.pointerId !== event.pointerId) return;
                        const context = useEditingContextStore.getState();
                        if (start.mode === 'range') {
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const endTick = Math.max(0, (event.clientX - bounds.left - HEADER_WIDTH) / viewport.pxPerTick);
                            const top = Math.min(start.clientY, event.clientY);
                            const bottom = Math.max(start.clientY, event.clientY);
                            const crossed = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-track-id]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.top < bottom + 1 && rect.bottom > top - 1; }).map((element) => element.dataset.trackId!).filter(Boolean);
                            const trackIds = crossed.length ? [...new Set(crossed)] : [start.trackId];
                            const previous = context.viewports.arrangement.selection.timeRange;
                            const fromTick = start.add && previous ? Math.min(previous.fromTick, start.tick, endTick) : Math.min(start.tick, endTick);
                            const toTick = start.add && previous ? Math.max(previous.toTick, start.tick, endTick) : Math.max(start.tick, endTick);
                            if (toTick > fromTick) context.setSelection('arrangement', { timeRange: { fromTick, toTick, trackIds: start.add && previous ? [...new Set([...previous.trackIds, ...trackIds])] : trackIds } });
                            else if (!start.add) context.clearSelection('arrangement');
                        } else if (marquee) {
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const left = bounds.left + marquee.x;
                            const top = bounds.top + marquee.y;
                            const right = left + marquee.width;
                            const bottom = top + marquee.height;
                            const hits = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-clip-id]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top; }).map((element) => element.dataset.clipId!);
                            const current = context.viewports.arrangement.selection.clipIds;
                            const clipIds = start.toggle ? [...new Set([...current.filter((id) => !hits.includes(id)), ...hits.filter((id) => !current.includes(id))])] : start.add ? [...new Set([...current, ...hits])] : hits;
                            context.setSelection('arrangement', { clipIds });
                        } else if (!start.add) context.clearSelection('arrangement');
                        context.commitSelectionOp('arrangement');
                        marqueeStart.current = null;
                        setMarquee(null);
                    }}
                >
                    <RulerStack fieldWidth={fieldViewportWidth} contentWidth={contentWidth} scrollLeft={view.left} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} snapOn={snapMode === 'magnetic'} sections={sections} songEnd={lengthTicks} loop={loop} onSeek={seekFromClientX} onToggleSnap={() => useEditingContextStore.getState().toggleSnap()} />
                    <div className="arrangement-field-ground" aria-hidden="true" style={{ width: contentWidth, height: offsets.at(-1) }} />
                    <div className="arrangement-song-end" aria-hidden="true" style={{ left: HEADER_WIDTH + lengthTicks * viewport.pxPerTick, width: Math.max(0, contentWidth - lengthTicks * viewport.pxPerTick), height: offsets.at(-1) }} />
                    <div className="arrangement-grid-anchor" style={{ transform: `translate3d(${view.left}px,${view.top}px,0)` }}>
                        <GridLayer width={fieldViewportWidth} height={Math.max(1, Math.min(view.height - RULER_HEIGHT, offsets.at(-1)! - laneTop))} scrollLeft={view.left} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} sections={sections} />
                    </div>
                    <div className="arrangement-lanes" role="list" aria-label="Tracks" style={{ paddingTop: offsets[firstLane], height: offsets.at(-1) }}>
                        {arrangement.tracks.slice(firstLane, lastLane).map((track) => <TrackLaneView key={track.id ?? track.ref} track={track} arrangement={arrangement} pxPerTick={viewport.pxPerTick} visibleStartTick={visibleStartTick} visibleEndTick={visibleEndTick} />)}
                    </div>
                    {loop?.endTick != null && <div className="arrangement-loop-wash" aria-hidden="true" style={{ left: HEADER_WIDTH + loop.startTick * viewport.pxPerTick, width: (loop.endTick - loop.startTick) * viewport.pxPerTick, height: offsets.at(-1) }} />}
                    {viewport.selection.timeRange && <div className="arrangement-range-selection" aria-label={`Time selection ${Math.round(viewport.selection.timeRange.fromTick)} to ${Math.round(viewport.selection.timeRange.toTick)}`} style={{ left: HEADER_WIDTH + viewport.selection.timeRange.fromTick * viewport.pxPerTick, width: (viewport.selection.timeRange.toTick - viewport.selection.timeRange.fromTick) * viewport.pxPerTick, height: offsets.at(-1) }} />}
                    <PlayheadLayer pxPerTick={viewport.pxPerTick} scrollRef={scrollRef} height={offsets.at(-1)!} />
                    {marquee && <div className={`arrangement-marquee${marquee.mode === 'range' ? ' is-range' : ''}`} aria-hidden="true" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
                </div>
            </div>
            {mixerOpen && <MixerDrawer />}
            {timePrompt && <form className="arrangement-time-prompt" aria-label={`${timePrompt === 'insert' ? 'Insert' : 'Delete'} time`} onSubmit={(event) => {
                event.preventDefault();
                const current = useArrangementStore.getState();
                const arr = current.arrangement;
                if (!arr) return;
                const timing = timebase(arr);
                const duration = parseMusicalDuration(timeAmount, timing.ticksPerBeat, timing.ticksPerBar);
                if (!duration) { setTimeError('Use an amount like “2 bars” or “3 beats”.'); return; }
                const editing = useEditingContextStore.getState();
                const selected = editing.viewports.arrangement.selection.trackIds;
                const trackIds = timeScope === 'selected-tracks' && selected.length ? selected : arr.tracks.map((track) => track.id ?? track.ref);
                const range = editing.viewports.arrangement.selection.timeRange;
                const from = range?.fromTick ?? current.playheadTick;
                const to = range?.toTick ?? from + duration;
                current.apply(timePrompt === 'insert' ? insertTime(arr, from, duration, trackIds).verbs : deleteTime(arr, from, to, trackIds).verbs);
                setTimePrompt(null);
            }}>
                <strong>{timePrompt === 'insert' ? 'Open space' : 'Close time'}</strong>
                <label>Amount<input autoFocus value={timeAmount} onChange={(event) => setTimeAmount(event.target.value)} placeholder="1 bar" /></label>
                <label>Tracks<select value={timeScope} onChange={(event) => setTimeScope(event.target.value as typeof timeScope)}><option value="selected-tracks">Selected tracks</option><option value="all">All tracks</option></select></label>
                {timeError && <span role="alert">{timeError}</span>}
                <div><button type="button" onClick={() => setTimePrompt(null)}>Cancel</button><button type="submit">{timePrompt === 'insert' ? 'Insert' : 'Delete'}</button></div>
            </form>}
        </div>
    );
}
