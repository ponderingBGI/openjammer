import type { Location } from '../../song/types';
import type { GridUnit } from '../../store/editingContextStore';
import { getGridLadder } from '../../song/rulerMarks';
import { TimeRuler, type TimeRulerMark } from '@openjammer/oj-ui';
import { useCallback, useRef, useState } from 'react';
import { ownPointerGesture, POINTER_DRAG_THRESHOLD_PX } from './pointerGestureLifetime';
import type { GestureSurface } from './pointerGestureLifetime';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore, gridTicks, snapTimeline } from '../../store/editingContextStore';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { timebase } from '../../song/time';
import { addMarker } from '../../song/ops';
import { PlayheadCap } from './PlayheadLayer';

interface RulerStackProps {
    fieldWidth: number;
    contentWidth: number;
    scrollLeft: number;
    /**
     * The element that actually scrolls, when there is one. The ruler's rows are
     * translated from `scrollLeft` (React state, a frame late); the playhead CAP
     * reads this ref instead, live and inside the scroll event, so it can never
     * be a frame away from its own line. The piano-roll surface has no DOM
     * scroller — its whole viewport is React state — so it passes nothing and
     * the cap falls back to `scrollLeft`, which there is the same clock.
     */
    scrollRef?: RefObject<HTMLElement | null>;
    pxPerTick: number;
    ticksPerBar: number;
    beatsPerBar: number;
    gridUnit: GridUnit;
    snapOn: boolean;
    sections: Location[];
    songEnd: number;
    loop?: Location;
    punch?: Location;
    onToggleSnap: () => void;
    surface?: GestureSurface;
    /** The empty-state ghost draws a ruler with no clock behind it. */
    shell?: boolean;
}

/** The cycle the grid chip walks, and the same ladder `[` / `]` step through. */
const GRID_UNITS: GridUnit[] = ['none', 'bar', 'beat', '1/2', '1/4', '1/8', '1/16', '1/32'];
/** V · B · X — Select, Draw, Erase. The knife and time tools stay on the keys. */
const ARRANGEMENT_TOOLS = [
    ['select', 'V', 'Select tool'],
    ['draw', 'B', 'Draw tool'],
    ['erase', 'X', 'Erase tool'],
] as const;

export function RulerStack(props: RulerStackProps) {
    const scrubCleanup = useRef<(() => void) | null>(null);
    /** Restores the playhead and tears the scrub down when a brace drag takes over. */
    const cancelScrub = useRef<(() => void) | null>(null);
    /**
     * Pointer capture retargets the synthesized click/dblclick to the capturing
     * element, so `event.target` on a double-click is not what the performer
     * pressed. The recorded press target is, and it is the only honest way to tell
     * "rename this section" from "drop a mark here".
     */
    const pressTarget = useRef<HTMLElement | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const selectedSectionIds = useEditingContextStore((state) => state.viewports.arrangement.selection.sectionIds);
    const followPlayhead = useEditingContextStore((state) => state.followPlayhead);
    const activeTool = useEditingContextStore((state) => state.viewports.arrangement.tool);
    const pxPerBar = props.pxPerTick * props.ticksPerBar;
    const ladder = getGridLadder(pxPerBar, props.beatsPerBar, props.gridUnit);
    const firstBar = Math.max(0, Math.floor(props.scrollLeft / pxPerBar));
    const lastBar = Math.ceil((props.scrollLeft + props.fieldWidth) / pxPerBar);
    const bars: TimeRulerMark[] = [];
    for (let bar = firstBar; bar <= lastBar; bar++) {
        if (bar % ladder.labelStride !== 0) continue;
        bars.push({ id: bar, x: bar * pxPerBar, label: String(bar + 1), level: 'bar' });
    }
    const locationTick = (event: Pick<PointerEvent, 'clientX' | 'ctrlKey' | 'metaKey'>, element: HTMLElement) => {
        const rect = element.closest('.arrangement-ruler-viewport')!.getBoundingClientRect();
        const raw = Math.max(0, (event.clientX - rect.left + props.scrollLeft) / props.pxPerTick);
        const arrangement = useArrangementStore.getState().arrangement;
        if (!arrangement) return raw;
        const tb = timebase(arrangement);
        const step = gridTicks(props.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, props.pxPerTick, true);
        const context = useEditingContextStore.getState();
        const anchors = arrangement.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.startTick, clip.startTick + clip.lengthTick])).concat((arrangement.locations ?? []).flatMap((location) => [location.startTick, ...(location.endTick == null ? [] : [location.endTick])]));
        const result = snapTimeline({ rawTick: raw, gridUnitTicks: step, anchorTicks: anchors, pxPerTick: props.pxPerTick, mode: props.snapOn ? 'magnetic' : 'off', invert: event.ctrlKey || event.metaKey, target: context.snapTarget });
        context.setSnapIndicatorTick(result.indicatorTick);
        /*
         * A tick is an INTEGER in this document. Snapping returns a float when it
         * declines to snap, and passing that straight into `moveLocation` /
         * `setLoopRange` wrote markers at 5408.6 — a position no other verb in
         * the model can express, and one the bar.beat readout has to lie about.
         * Round once, here, where the pointer becomes a tick.
         */
        return Math.round(result.tick);
    };
    const addMarkerAt = (event: Pick<PointerEvent, 'clientX' | 'ctrlKey' | 'metaKey'>, element: HTMLElement) => {
        const store = useArrangementStore.getState();
        if (!store.arrangement) return;
        const result = addMarker(store.arrangement, locationTick(event, element), store.mintId);
        if (result.verbs.length) store.apply(result.verbs);
        useEditingContextStore.getState().setSnapIndicatorTick(null);
    };
    const beginRange = (event: ReactPointerEvent, kind: 'loop' | 'punch', mode: 'create' | 'move' | 'start' | 'end', current?: Location) => {
        if (event.button !== 0) return;
        // A press on an existing brace or cap owns the pointer outright. A press on
        // the EMPTY brace row must not swallow the click: it keeps bubbling to the
        // ruler's scrub, so a click without a drag still seeks exactly like the bars
        // row below it. The drag only takes the pointer once it passes the threshold.
        if (mode !== 'create') event.stopPropagation();
        const store = useArrangementStore.getState();
        if (!store.arrangement) return;
        const element = event.currentTarget as HTMLElement;
        const downTick = locationTick(event.nativeEvent, element);
        const range = current ?? { id: store.mintId('location'), name: kind === 'loop' ? 'Loop' : 'Punch', kind, startTick: downTick, endTick: downTick + 1 };
        let active = false;
        const downX = event.clientX;
        const cleanup = ownPointerGesture(event.pointerId, {
            move(nativeEvent) {
                if (!active) {
                    if (Math.abs(nativeEvent.clientX - downX) < POINTER_DRAG_THRESHOLD_PX) return;
                    active = true;
                    cancelScrub.current?.();
                    store.beginGesture(`${mode} ${kind} range`);
                }
                const tick = locationTick(nativeEvent, element);
                const length = Math.max(1, (range.endTick ?? range.startTick + 1) - range.startTick);
                const startTick = mode === 'move' ? Math.max(0, tick - downTick + range.startTick) : mode === 'end' ? range.startTick : Math.min(downTick, tick);
                const endTick = mode === 'move' ? startTick + length : mode === 'start' ? Math.max(range.endTick ?? range.startTick + 1, tick + 1) : Math.max(mode === 'end' ? tick : Math.max(downTick, tick), startTick + 1);
                store.previewGesture({ kind: kind === 'loop' ? 'setLoopRange' : 'setPunchRange', location: { ...range, startTick, endTick } });
            },
            commit(nativeEvent) { this.move?.(nativeEvent); cleanup(); useEditingContextStore.getState().setSnapIndicatorTick(null); if (active) store.commitGesture(); },
            abort() { cleanup(); useEditingContextStore.getState().setSnapIndicatorTick(null); cancelScrub.current?.(); if (active) store.abortGesture(); },
        }, props.surface ?? 'arrangement');
        try { element.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
    };
    /*
     * The piano-roll surface's corner is only as wide as the roll's own key-bed
     * gutter (spec 2.1's pixel-lock rule reaches the ruler too: bar 1 must sit
     * exactly above tick 0, not 124px to its right). So the roll's corner drops
     * the tool strip — the roll has its own — and stacks the rest.
     */
    const isRoll = props.surface === 'pianoroll';
    /*
     * The cap's counter-translation. Live DOM `scrollLeft` where there is a
     * scroller, the React number where there is not — and stable enough that the
     * write is a subscription, never a render.
     */
    const { scrollRef, scrollLeft } = props;
    const capOffsetX = useCallback(() => scrollRef?.current?.scrollLeft ?? scrollLeft, [scrollRef, scrollLeft]);
    const gridChip = (
        <button
            className="arrangement-grid-chip"
            type="button"
            aria-label={`Grid unit: ${props.gridUnit}`}
            title="Grid unit — [ coarser, ] finer"
            onClick={() => {
                const context = useEditingContextStore.getState();
                const index = Math.max(0, GRID_UNITS.indexOf(context.gridUnit));
                context.setGridUnit(GRID_UNITS[(index + 1) % GRID_UNITS.length]!);
            }}
        >{props.gridUnit}</button>
    );
    return (
        <div className="arrangement-ruler-shell">
            {/*
             * The 200×64 corner. Grid, magnet, tool and follow live HERE rather
             * than in the sky band because they act on the ruled field, and the
             * corner is the one place that is directly above the header column
             * and directly left of the bars they measure (spec 2.3).
             */}
            <div className={`arrangement-corner${isRoll ? ' arrangement-corner--roll' : ''}`}>
                <div className="arrangement-corner__row">
                    {!isRoll && gridChip}
                    <button className="arrangement-magnet" type="button" aria-label="Snap to grid" aria-pressed={props.snapOn} onClick={props.onToggleSnap}>∩</button>
                    <button
                        className="arrangement-follow"
                        type="button"
                        aria-label="Follow the playhead"
                        /*
                         * "Follow (F)", not "Follow the playhead": Playwright's
                         * `getByTitle('Play')` substring-matches, and the shipped
                         * transport e2e would have resolved to two elements. The
                         * full sentence stays on `aria-label`, where it belongs.
                         */
                        title="Follow (F)"
                        aria-pressed={followPlayhead}
                        onClick={() => useEditingContextStore.setState({ followPlayhead: !followPlayhead })}
                    >⇥</button>
                </div>
                <div className="arrangement-corner__row">
                    {isRoll ? gridChip : (
                        <div className="arrangement-tool" role="group" aria-label="Tool">
                            {ARRANGEMENT_TOOLS.map(([tool, glyph, name]) => (
                                <button
                                    key={tool}
                                    type="button"
                                    aria-label={name}
                                    aria-pressed={activeTool === tool}
                                    onClick={() => useEditingContextStore.getState().setViewport('arrangement', { tool })}
                                >{glyph}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="arrangement-ruler-viewport" onPointerDownCapture={(event) => { pressTarget.current = event.target as HTMLElement; }} onDoubleClick={(event) => {
                const source = pressTarget.current ?? (event.target as HTMLElement);
                const chip = source.closest<HTMLElement>('.arrangement-section-chip');
                /*
                 * A section chip's label spans the WHOLE chip — that is what made
                 * double-click-to-rename reachable at all — so on a song whose
                 * sections cover every bar there is no "empty band" left to drop a
                 * mark in, and marker creation by hand became unreachable
                 * (W4-TB-REVIEW §2). ALT is the escape: it is free on this row, it
                 * is already this surface's "do the other thing" modifier
                 * (Alt+drag on the brace row makes a punch, Alt+drag in the field
                 * is an object marquee), and it keeps rename as the plain gesture
                 * because renaming is the far commoner act.
                 */
                if (!event.altKey && chip && source.closest('.arrangement-section-chip__label')) {
                    const section = props.sections.find((item) => item.id && item.id === chip.dataset.locationId);
                    if (section?.id) { setRenamingId(section.id); setNameDraft(section.name); }
                    return;
                }
                if (!source.closest('.arrangement-sections-row')) return;
                addMarkerAt(event.nativeEvent, event.currentTarget);
            }} onPointerDown={(event) => {
                if (event.button !== 0) return;
                const element = event.currentTarget;
                const initialTick = useArrangementStore.getState().playheadTick;
                useArrangementStore.getState().seek(locationTick(event.nativeEvent, element));
                const finish = () => {
                    scrubCleanup.current?.();
                    scrubCleanup.current = null;
                    cancelScrub.current = null;
                    useEditingContextStore.getState().setSnapIndicatorTick(null);
                };
                scrubCleanup.current?.();
                scrubCleanup.current = ownPointerGesture(event.pointerId, {
                    move: (nativeEvent) => useArrangementStore.getState().seek(locationTick(nativeEvent, element)),
                    commit: finish,
                    abort: () => { useArrangementStore.getState().seek(initialTick); finish(); },
                }, props.surface ?? 'arrangement');
                cancelScrub.current = () => { useArrangementStore.getState().seek(initialTick); finish(); };
                try { element.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
            }}>
                {/*
                  * The playhead's CAP. It lives here — a direct child of the
                  * ruler's own viewport, which already begins at the header edge
                  * and already clips, so the bars row keeps its 9px marker while
                  * a scrolled field can never push it into the 200px corner.
                  *
                  * Deliberately OUTSIDE `.arrangement-ruler-content`: that box is
                  * translated from React state, a frame behind the scroll, and
                  * riding it tore the cap up to 150px off its own line on one
                  * wheel notch (W4-TBb §2). Out here it counter-translates itself
                  * from the live scroll, in the same `onScroll` call that moves
                  * the line's pane, so the two halves of the playhead cannot
                  * disagree about the instant they mark.
                  */}
                {!props.shell && <PlayheadCap pxPerTick={props.pxPerTick} offsetX={capOffsetX} />}
                {props.loop?.endTick != null && <div className="arrangement-loop-bracket" aria-hidden="true" style={{ transform: `translateX(${props.loop.startTick * props.pxPerTick - props.scrollLeft}px)`, width: (props.loop.endTick - props.loop.startTick) * props.pxPerTick }}><span>[</span><span>]</span></div>}
                <div className="arrangement-ruler-content" style={{ width: props.contentWidth, transform: `translateX(${-props.scrollLeft}px)` }}>
                    {/*
                      * The row says what its two double-clicks do. `Alt` is the
                      * only way to drop a mark inside a section that spans the
                      * bar you are pointing at, and nothing on screen said so —
                      * the capability was in the keybindings catalogue as
                      * `Ctrl+M`, but that drops at the PLAYHEAD, so it is a
                      * different gesture rather than the same one by another
                      * route (W4-TBb §5). `title` rather than a visible legend:
                      * a permanent instruction on a ruler is chrome a performer
                      * reads once and then has to look past forever.
                      */}
                    <div className="arrangement-sections-row" title="Double-click to rename · Alt+double-click to add a marker">
                        {props.sections.map((section, index) => {
                            const next = props.sections[index + 1];
                            /*
                             * A SECTION owns the span up to the next one, so it is a
                             * chip you can read at a glance. A MARK is a point in
                             * time: it gets its natural width and a triangle pin, so
                             * it can never be mistaken for a very short section — and
                             * the strip beside it stays free for the double-click
                             * that drops the next mark.
                             */
                            const isMark = section.kind === 'mark';
                            const width = isMark ? undefined : ((section.endTick ?? next?.startTick ?? props.songEnd) - section.startTick) * props.pxPerTick;
                            const selected = section.id ? selectedSectionIds.includes(section.id) : false;
                            if (renamingId === section.id) return <input key={section.id} className="arrangement-section-chip" style={{ left: section.startTick * props.pxPerTick, width: width ?? 120 }} aria-label={`Rename ${section.name}`} autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => { if (section.id && nameDraft.trim() && nameDraft.trim() !== section.name) useArrangementStore.getState().apply({ kind: 'setLocationName', locationId: section.id, name: nameDraft.trim() }); setRenamingId(null); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') setRenamingId(null); }} />;
                            return <button type="button" key={section.id ?? section.name} className={`arrangement-section-chip${isMark ? ' arrangement-section-chip--mark' : ''}${selected ? ' is-selected' : ''}`} data-location-id={section.id} style={{ left: section.startTick * props.pxPerTick, width }} onPointerDown={(event) => { event.stopPropagation(); if (!section.id || event.button !== 0) return; const pointerId = event.pointerId; const element = event.currentTarget; const startX = event.clientX; let active = false; const cleanup = ownPointerGesture(pointerId, { move: (move) => { if (!active && Math.abs(move.clientX - startX) >= 4) { active = true; useArrangementStore.getState().beginGesture('Move marker'); } if (!active) return; const tick = locationTick(move, element); useArrangementStore.getState().previewGesture({ kind: 'moveLocation', locationId: section.id!, startTick: tick, ...(section.endTick == null ? {} : { endTick: tick + section.endTick - section.startTick }) }); }, commit: () => { cleanup(); useEditingContextStore.getState().setSnapIndicatorTick(null); if (active) useArrangementStore.getState().commitGesture(); }, abort: () => { cleanup(); useEditingContextStore.getState().setSnapIndicatorTick(null); if (active) useArrangementStore.getState().abortGesture(); } }, props.surface ?? 'arrangement'); try { element.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ } }} onClick={(event) => { if (!section.id) return; const context = useEditingContextStore.getState(); const ids = context.viewports.arrangement.selection.sectionIds; context.setSelection('arrangement', { sectionIds: event.ctrlKey || event.metaKey ? ids.includes(section.id) ? ids.filter((id) => id !== section.id) : [...ids, section.id] : [section.id] }); }}><span className="arrangement-section-chip__label">{section.name}</span></button>;
                        })}
                    </div>
                    {/* taste-review #16: sections intentionally stay above bars so the exact bar scale remains adjacent to the field. */}
                    <div className="arrangement-bars-row"><TimeRuler marks={bars} width={props.contentWidth} /></div>
                    <div className="arrangement-braces-row" onPointerDown={(event) => { if (event.target === event.currentTarget) beginRange(event, event.altKey ? 'punch' : 'loop', 'create'); }}>
                        {[props.loop, props.punch].filter((location): location is Location => Boolean(location?.endTick)).map((location) => <div key={location.id ?? location.kind} className={`arrangement-${location.kind}-brace`} style={{ left: location.startTick * props.pxPerTick, width: (location.endTick! - location.startTick) * props.pxPerTick }} onPointerDown={(event) => beginRange(event, location.kind as 'loop' | 'punch', 'move', location)}><button type="button" aria-label={`${location.name} start`} onPointerDown={(event) => beginRange(event, location.kind as 'loop' | 'punch', 'start', location)}>[</button><button type="button" aria-label={`${location.name} end`} onPointerDown={(event) => beginRange(event, location.kind as 'loop' | 'punch', 'end', location)}>]</button></div>)}
                    </div>
                </div>
            </div>
        </div>
    );
}
