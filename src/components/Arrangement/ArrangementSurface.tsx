import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Kbd } from '@openjammer/oj-ui';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { useBindingSet } from '../../keymap/useKeymap';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { buildTempoMap, sampleToTick } from '../../song/tempoMap';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import { TransportStrip } from './TransportStrip';
import { RulerStack } from './RulerStack';
import { GridLayer } from './GridLayer';
import { TrackLaneView } from './TrackLaneView';
import { PlayheadLayer } from './PlayheadLayer';
import { deleteClips, duplicateClips, nudge, splitAt } from '../../song/ops';
import { gridTicks } from '../../store/editingContextStore';
import { useHistoryStore } from '../../store/historyStore';
import './ArrangementSurface.css';

const HEADER_WIDTH = 200;
const RULER_HEIGHT = 46;

export function ArrangementSurface({ active, visible = active, transition, songNodeId }: { active: boolean; visible?: boolean; transition?: 'in' | 'out'; songNodeId: string | null }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const viewport = useEditingContextStore((state) => state.viewports.arrangement);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const laneHeights = useTrackLaneViewStore((state) => state.laneHeights);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ width: 1000, height: 600, left: 0, top: 0 });
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const marqueeStart = useRef<{ x: number; y: number; clientX: number; clientY: number; pointerId: number; add: boolean; toggle: boolean } | null>(null);

    useBindingSet(useMemo(() => ({
        id: 'arrangement-surface',
        scope: 'surface' as const,
        surface: 'arrangement' as const,
        entries: [
            { actionId: 'arrangement.transport', guard: (event: KeyboardEvent) => !event.repeat, run: () => { const store = useArrangementStore.getState(); if (store.isPlaying) store.stop(); else store.play(); return true; } },
            { actionId: 'arrangement.undo', run: () => { useHistoryStore.getState().undo(); return true; } },
            { actionId: 'arrangement.redo', run: () => { useHistoryStore.getState().redo(); return true; } },
            { actionId: 'arrangement.zoomToSelection', run: () => false },
            ...['arrangement.delete', 'arrangement.deleteBackspace'].map((actionId) => ({ actionId, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (arr) store.apply(deleteClips(arr, context.viewports.arrangement.selection.clipIds, context.editMode === 'ripple').verbs); context.clearSelection('arrangement'); return true; } })),
            { actionId: 'arrangement.duplicate', run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const amount = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; const result = duplicateClips(arr, context.viewports.arrangement.selection.clipIds, amount, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            ...([['arrangement.nudgeLeft', -1, false], ['arrangement.nudgeRight', 1, false], ['arrangement.nudgeLeftFine', -1, true], ['arrangement.nudgeRightFine', 1, true]] as const).map(([actionId, direction, fine]) => ({ actionId, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const grid = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; store.apply(nudge(arr, context.viewports.arrangement.selection.clipIds, fine ? Math.max(1, Math.round(grid / 16)) : grid, direction).verbs); return true; } })),
            { actionId: 'arrangement.split', run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const editTick = store.transportPending === 'seek' && store.pendingSeekSample != null ? sampleToTick(buildTempoMap(arr), store.pendingSeekSample) : store.playheadTick; const result = splitAt(arr, context.viewports.arrangement.selection.clipIds, editTick, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            { actionId: 'arrangement.toggleRipple', run: () => { const context = useEditingContextStore.getState(); context.setEditMode(context.editMode === 'ripple' ? 'slide' : 'ripple'); return true; } },
            { actionId: 'arrangement.escape', guard: () => !useEditingContextStore.getState().dragActive, run: () => { useEditingContextStore.getState().clearSelection('arrangement'); return true; } },
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

    if (!arrangement) {
        return (
            <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active}>
                <TransportStrip fieldWidth={view.width - HEADER_WIDTH} />
                <div className="arrangement-empty-stage">
                    <div className="arrangement-empty-ruler" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span></div>
                    {[0, 1, 2].map((index) => <div className="arrangement-empty-lane" key={index}><span>Track {index + 1}</span></div>)}
                    <div className="arrangement-empty-card">
                        <h1>An empty page.</h1>
                        <p>Start a sketch, or ask the agent to dream one up. Ctrl+Z undoes anything.</p>
                        <Button onClick={() => useArrangementStore.getState().setArrangement({ ...buildPaperSketch(), codeNodes: undefined })}>Start from 'Paper Sketch'</Button>
                        <button className="arrangement-empty-secondary" type="button">Add an empty track</button>
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
    const heights = arrangement.tracks.map((track) => laneHeights[track.id ?? track.ref] ?? 72);
    const offsets = heights.reduce<number[]>((all, height) => [...all, (all.at(-1) ?? 0) + height], [0]);
    const laneTop = Math.max(0, view.top - RULER_HEIGHT);
    const laneBottom = laneTop + view.height - RULER_HEIGHT;
    const firstLane = Math.max(0, offsets.findIndex((_offset, index) => index < heights.length && offsets[index + 1]! >= laneTop) - 1);
    const computedLastLane = offsets.findIndex((offset) => offset > laneBottom) + 1 || arrangement.tracks.length;
    const lastLane = Math.min(arrangement.tracks.length, Math.max(firstLane + 3, computedLastLane));
    const visibleStartTick = Math.max(0, view.left / viewport.pxPerTick);
    const visibleEndTick = (view.left + fieldViewportWidth) / viewport.pxPerTick;

    const seekFromClientX = (clientX: number) => {
        const rect = scrollRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = clientX - rect.left - HEADER_WIDTH + view.left;
        useArrangementStore.getState().seek(x / viewport.pxPerTick);
    };

    return (
        <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active}>
            <TransportStrip fieldWidth={fieldViewportWidth} />
            <div
                className="arrangement-scroll"
                ref={scrollRef}
                onScroll={(event) => {
                    const target = event.currentTarget;
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
                        marqueeStart.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, add: event.shiftKey && !event.ctrlKey && !event.metaKey, toggle: (event.ctrlKey || event.metaKey) && !event.shiftKey };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const start = marqueeStart.current;
                        if (!start || start.pointerId !== event.pointerId) return;
                        const dx = event.clientX - start.clientX;
                        const dy = event.clientY - start.clientY;
                        if (!marquee && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                        setMarquee({ x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy) });
                    }}
                    onPointerUp={(event) => {
                        const start = marqueeStart.current;
                        if (!start || start.pointerId !== event.pointerId) return;
                        if (marquee) {
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const left = bounds.left + marquee.x;
                            const top = bounds.top + marquee.y;
                            const right = left + marquee.width;
                            const bottom = top + marquee.height;
                            const hits = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-clip-id]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top; }).map((element) => element.dataset.clipId!);
                            const context = useEditingContextStore.getState();
                            const current = context.viewports.arrangement.selection.clipIds;
                            const clipIds = start.toggle ? [...new Set([...current.filter((id) => !hits.includes(id)), ...hits.filter((id) => !current.includes(id))])] : start.add ? [...new Set([...current, ...hits])] : hits;
                            context.setSelection('arrangement', { clipIds });
                        } else if (!start.add) useEditingContextStore.getState().clearSelection('arrangement');
                        marqueeStart.current = null;
                        setMarquee(null);
                    }}
                >
                    <RulerStack fieldWidth={fieldViewportWidth} contentWidth={contentWidth} scrollLeft={view.left} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} snapOn={snapMode === 'magnetic'} sections={sections} loop={loop} onSeek={seekFromClientX} onToggleSnap={() => useEditingContextStore.getState().toggleSnap()} />
                    <div className="arrangement-grid-anchor" style={{ transform: `translate3d(${view.left}px,${view.top}px,0)` }}>
                        <GridLayer width={fieldViewportWidth} height={Math.max(1, Math.min(view.height - RULER_HEIGHT, offsets.at(-1)! - laneTop))} scrollLeft={view.left} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} sections={sections} />
                    </div>
                    <div className="arrangement-lanes" role="list" aria-label="Tracks" style={{ paddingTop: offsets[firstLane], height: offsets.at(-1) }}>
                        {arrangement.tracks.slice(firstLane, lastLane).map((track) => <TrackLaneView key={track.id ?? track.ref} track={track} arrangement={arrangement} pxPerTick={viewport.pxPerTick} visibleStartTick={visibleStartTick} visibleEndTick={visibleEndTick} />)}
                    </div>
                    {loop?.endTick != null && <div className="arrangement-loop-wash" aria-hidden="true" style={{ left: HEADER_WIDTH + loop.startTick * viewport.pxPerTick, width: (loop.endTick - loop.startTick) * viewport.pxPerTick, height: offsets.at(-1) }} />}
                    <PlayheadLayer pxPerTick={viewport.pxPerTick} scrollRef={scrollRef} />
                    {marquee && <div className="arrangement-marquee" aria-hidden="true" style={marquee} />}
                </div>
            </div>
        </div>
    );
}
