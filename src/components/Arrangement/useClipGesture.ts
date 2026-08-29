import { useEffect, useRef, useState } from 'react';
import type { Arrangement, ArrangementClip } from '../../song/types';
import { deleteClips, duplicateClips, moveClips, slipClips, trimClip } from '../../song/ops';
import type { Verb } from '../../song/verbs';
import { gridTicks, snapTimeline, useEditingContextStore } from '../../store/editingContextStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { timebase } from '../../song/time';
import { autoScrollDelta, type DragAxis } from './dragController';
import { createRafPreview, ownPointerGesture, thresholdAxis } from './pointerGestureLifetime';

interface Gesture {
    previewBase: Arrangement;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    originalScrollLeft: number;
    copy: boolean;
    slip: boolean;
    edge: 'start' | 'end' | null;
    axis: DragAxis | null;
    active: boolean;
    selectedIds: string[];
    relativeOffset: number;
    candidates: number[];
    scroll: HTMLElement | null;
    frame: number | null;
    copyTemplates?: Extract<Verb, { kind: 'addClip' }>[];
    cleanup?: () => void;
    finalVerbs?: Verb[];
    pointerType: string;
    lastMotionAt: number;
    previewFrame: ReturnType<typeof createRafPreview<PointerEvent>>;
    lastEvent: PointerEvent;
}

export function useClipGesture(clip: ArrangementClip, trackId: string, pxPerTick: number, width: number, height: number, onClickSelect: (event: React.PointerEvent, phase: 'press' | 'release') => void) {
    const gesture = useRef<Gesture | null>(null);
    const mounted = useRef(true);
    const [dragging, setDragging] = useState(false);

    const stopAutoScroll = () => {
        if (gesture.current?.frame != null) cancelAnimationFrame(gesture.current.frame);
        if (gesture.current) gesture.current.frame = null;
    };

    const finish = (commit: boolean) => {
        if (commit) gesture.current?.previewFrame.flush();
        else gesture.current?.previewFrame.cancel();
        const finalVerbs = gesture.current?.finalVerbs;
        stopAutoScroll();
        gesture.current?.cleanup?.();
        const active = gesture.current?.active;
        gesture.current = null;
        if (mounted.current) setDragging(false);
        useEditingContextStore.getState().setDragActive(false);
        if (useEditingContextStore.getState().activeClipDragIds.length) useEditingContextStore.getState().setActiveClipDragIds([]);
        useEditingContextStore.getState().setClipDragPreview(null);
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        if (active && commit) {
            if (finalVerbs) useArrangementStore.getState().previewGesture(finalVerbs);
            useArrangementStore.getState().commitGesture();
        }
        else useArrangementStore.getState().abortGesture();
    };
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const preview = (event: PointerEvent | React.PointerEvent) => {
        const g = gesture.current;
        const arrangement = useArrangementStore.getState().arrangement;
        if (!g || !arrangement) return;
        g.lastX = event.clientX;
        g.lastY = event.clientY;
        const dx = event.clientX - g.startX + ((g.scroll?.scrollLeft ?? 0) - g.originalScrollLeft);
        const dy = event.clientY - g.startY;
        if (!g.active) {
            const axis = thresholdAxis(dx, dy, g.pointerType, g.copy);
            if (!axis) return;
            g.active = true;
            g.axis = axis;
            if (g.copy) g.copyTemplates = duplicateClips(arrangement, g.selectedIds, 0, (prefix) => useArrangementStore.getState().mintId(prefix)).verbs.filter((verb): verb is Extract<Verb, { kind: 'addClip' }> => verb.kind === 'addClip');
            setDragging(true);
            useEditingContextStore.getState().setDragActive(true);
            useEditingContextStore.getState().setActiveClipDragIds([...g.selectedIds, ...(g.copyTemplates ?? []).map((verb) => verb.clip.id).filter((id): id is string => id !== undefined)]);
        }
        const context = useEditingContextStore.getState();
        const shiftLock = event.shiftKey && !g.edge;
        const horizontalAllowed = !shiftLock || g.axis === 'horizontal';
        const verticalAllowed = !shiftLock || g.axis === 'vertical';
        const hoveredTrackId = verticalAllowed ? (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-track-id]') as HTMLElement | null)?.dataset.trackId : trackId;
        let rawDelta = horizontalAllowed ? Math.round(dx / pxPerTick) : 0;
        const grabbedRaw = clip.startTick + rawDelta;
        const relative = event.altKey && event.shiftKey;
        const snapInvert = event.ctrlKey || event.metaKey;
        const snapRaw = relative ? grabbedRaw - g.relativeOffset : grabbedRaw;
        const snappedResult = snapTimeline({ rawTick: snapRaw, gridUnitTicks: gridTicks(context.gridUnit, timebase(g.previewBase).ticksPerBeat, timebase(g.previewBase).ticksPerBar, pxPerTick), anchorTicks: g.candidates, pxPerTick, mode: context.snapMode, invert: snapInvert, target: context.snapTarget });
        const snapped = snappedResult.tick;
        context.setSnapIndicatorTick(snappedResult.indicatorTick);
        rawDelta = (relative ? snapped + g.relativeOffset : snapped) - clip.startTick;
        if (g.slip) {
            useArrangementStore.getState().previewGesture(slipClips(g.previewBase, g.selectedIds, rawDelta).verbs);
        } else if (g.edge) {
            const at = g.edge === 'start' ? clip.startTick + rawDelta : clip.startTick + clip.lengthTick + rawDelta;
            useArrangementStore.getState().previewGesture(trimClip(g.previewBase, g.selectedIds, g.edge, at).verbs);
        } else if (g.copy) {
            const primaryIndex = g.previewBase.tracks.findIndex((item) => (item.id ?? item.ref) === trackId);
            const hoveredIndex = g.previewBase.tracks.findIndex((item) => (item.id ?? item.ref) === hoveredTrackId);
            const trackDelta = hoveredIndex >= 0 && primaryIndex >= 0 ? hoveredIndex - primaryIndex : 0;
            useArrangementStore.getState().previewGesture((g.copyTemplates ?? []).map((verb) => {
                const sourceIndex = g.previewBase.tracks.findIndex((item) => (item.id ?? item.ref) === verb.trackId);
                const targetIndex = Math.max(0, Math.min(g.previewBase.tracks.length - 1, sourceIndex + trackDelta));
                const target = g.previewBase.tracks[targetIndex];
                return { ...verb, trackId: target ? (target.id ?? target.ref) : verb.trackId, clip: { ...verb.clip, startTick: Math.max(0, verb.clip.startTick + rawDelta) } };
            }));
        } else {
            const ripple = context.editMode === 'ripple';
            const finalVerbs = moveClips(g.previewBase, g.selectedIds, rawDelta, { ripple, toTrackId: ripple ? undefined : hoveredTrackId }).verbs;
            g.finalVerbs = finalVerbs;
            // Keep the dragged ClipView mounted while crossing lanes. The final
            // track reassignment is applied atomically on pointer-up.
            useArrangementStore.getState().previewGesture(hoveredTrackId && hoveredTrackId !== trackId
                ? moveClips(g.previewBase, g.selectedIds, rawDelta, { ripple, toTrackId: ripple ? undefined : trackId }).verbs
                : finalVerbs);
        }
        if (!g.edge && !g.slip) {
            const surface = document.querySelector<HTMLElement>('[data-surface-root="arrangement"]');
            const surfaceRect = surface?.getBoundingClientRect();
            useEditingContextStore.getState().setClipDragPreview({
                clipId: clip.id!,
                sourceTrackId: trackId,
                hoveredTrackId: hoveredTrackId && hoveredTrackId !== trackId ? hoveredTrackId : '',
                x: event.clientX - (surfaceRect?.left ?? 0),
                y: event.clientY - (surfaceRect?.top ?? 0),
                width,
                height,
                copy: g.copy,
            });
        }
    };

    const startAutoScroll = () => {
        const tick = () => {
            const g = gesture.current;
            if (!g) return;
            if (g.active && g.scroll) {
                const rect = g.scroll.getBoundingClientRect();
                const x = autoScrollDelta(g.lastX, rect.left + useTrackLaneViewStore.getState().headerWidth, rect.right);
                const y = autoScrollDelta(g.lastY, rect.top + 64, rect.bottom);
                if (x || y) {
                    g.scroll.scrollLeft += x;
                    g.scroll.scrollTop += y;
                    g.previewFrame.schedule(g.lastEvent);
                }
            }
            g.frame = performance.now() - g.lastMotionAt < 400 ? requestAnimationFrame(tick) : null;
        };
        if (gesture.current) gesture.current.frame = requestAnimationFrame(tick);
    };

    return {
        dragging,
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onClickSelect(event, 'press');
            const arrangement = useArrangementStore.getState().arrangement;
            if (!arrangement || !clip.id) return;
            const selection = useEditingContextStore.getState().viewports.arrangement.selection.clipIds;
            const selectedIds = selection.includes(clip.id) ? selection : [clip.id];
            const zone = Math.max(0, Math.min(8, width / 2 - 1));
            const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
            const edge = x <= zone + 4 ? 'start' : x >= width - zone - 4 ? 'end' : null;
            const context = useEditingContextStore.getState();
            const slip = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey;
            if (slip && context.editMode === 'lock') return;
            const tb = timebase(arrangement);
            const step = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, pxPerTick) ?? 1;
            const candidates: number[] = [];
            if (context.snapTarget !== 'grid') {
                for (const track of arrangement.tracks) for (const item of track.clips) if (item.id !== clip.id) candidates.push(item.startTick, item.startTick + item.lengthTick);
                for (const location of arrangement.locations ?? []) candidates.push(location.startTick, ...(location.endTick == null ? [] : [location.endTick]));
                if (!useArrangementStore.getState().isPlaying) candidates.push(useArrangementStore.getState().playheadTick);
            }
            const gridNearest = Math.round(clip.startTick / step) * step;
            const allCandidates = [gridNearest, ...candidates];
            const nearest = allCandidates.length ? allCandidates.reduce((best, value) => Math.abs(value - clip.startTick) < Math.abs(best - clip.startTick) ? value : best) : clip.startTick;
            const scroll = event.currentTarget.closest('.arrangement-scroll') as HTMLElement | null;
            // Alt+drag copies; Alt+Shift is the distinct relative-snap gesture.
            // Keeping those modes exclusive prevents a relative move from
            // silently becoming a duplicate with snapping inverted.
            const copy = event.altKey && !event.shiftKey && !slip;
            const previewFrame = createRafPreview<PointerEvent>(preview);
            gesture.current = { previewBase: arrangement, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, originalScrollLeft: scroll?.scrollLeft ?? 0, copy, slip, edge: slip ? null : edge, axis: null, active: false, selectedIds, relativeOffset: clip.startTick - nearest, candidates, scroll, frame: null, pointerType: event.pointerType, lastMotionAt: performance.now(), previewFrame, lastEvent: event.nativeEvent };
            useEditingContextStore.setState({ followPlayhead: false });
            const releasePointer = ownPointerGesture(event.pointerId, {
                move: (nativeEvent) => {
                    const current = gesture.current;
                    if (!current) return;
                    current.lastX = nativeEvent.clientX;
                    current.lastY = nativeEvent.clientY;
                    current.lastEvent = nativeEvent;
                    current.lastMotionAt = performance.now();
                    current.previewFrame.schedule(nativeEvent);
                    if (current.frame == null) startAutoScroll();
                },
                commit: () => { if (gesture.current) finish(true); },
                abort: () => { if (gesture.current) finish(false); },
            });
            gesture.current.cleanup = releasePointer;
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
            useArrangementStore.getState().beginGesture(slip ? 'Slip clip contents' : edge ? `Trim clip ${edge}` : copy ? 'Duplicate clips' : 'Move clips');
            startAutoScroll();
        },
        onPointerCancel: () => { if (gesture.current) finish(false); },
        deleteSelection: () => {
            const arrangement = useArrangementStore.getState().arrangement;
            if (!arrangement) return;
            const ids = useEditingContextStore.getState().viewports.arrangement.selection.clipIds;
            useArrangementStore.getState().apply(deleteClips(arrangement, ids).verbs);
        },
    };
}
