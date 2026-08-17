import { useEffect, useRef, useState } from 'react';
import type { ArrangementClip } from '../../song/types';
import { deleteClips, duplicateClips, moveClips, slipClips, trimClip } from '../../song/ops';
import type { Verb } from '../../song/verbs';
import { gridTicks, snapTick, useEditingContextStore } from '../../store/editingContextStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { timebase } from '../../song/time';
import { autoScrollDelta, crossedDragThreshold, dominantAxis, type DragAxis } from './dragController';

interface Gesture {
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
    followPlayheadBefore: boolean;
}

export function useClipGesture(clip: ArrangementClip, trackId: string, pxPerTick: number, width: number, onClickSelect: (event: React.PointerEvent, phase: 'press' | 'release') => void) {
    const gesture = useRef<Gesture | null>(null);
    const [dragging, setDragging] = useState(false);

    const stopAutoScroll = () => {
        if (gesture.current?.frame != null) cancelAnimationFrame(gesture.current.frame);
        if (gesture.current) gesture.current.frame = null;
    };

    const finish = (commit: boolean) => {
        stopAutoScroll();
        gesture.current?.cleanup?.();
        const active = gesture.current?.active;
        const followPlayheadBefore = gesture.current?.followPlayheadBefore;
        gesture.current = null;
        setDragging(false);
        useEditingContextStore.getState().setDragActive(false);
        if (followPlayheadBefore !== undefined) useEditingContextStore.setState({ followPlayhead: followPlayheadBefore });
        if (active && commit) useArrangementStore.getState().commitGesture();
        else useArrangementStore.getState().abortGesture();
    };

    useEffect(() => {
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) finish(false); };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    });

    const preview = (event: PointerEvent | React.PointerEvent) => {
        const g = gesture.current;
        const arrangement = useArrangementStore.getState().arrangement;
        if (!g || !arrangement) return;
        g.lastX = event.clientX;
        g.lastY = event.clientY;
        const dx = event.clientX - g.startX + ((g.scroll?.scrollLeft ?? 0) - g.originalScrollLeft);
        const dy = event.clientY - g.startY;
        if (!g.active) {
            if (!crossedDragThreshold(dx, dy, g.copy)) return;
            g.active = true;
            g.axis = dominantAxis(dx, dy);
            if (g.copy) g.copyTemplates = duplicateClips(arrangement, g.selectedIds, 0, (prefix) => useArrangementStore.getState().mintId(prefix)).verbs.filter((verb): verb is Extract<Verb, { kind: 'addClip' }> => verb.kind === 'addClip');
            setDragging(true);
            useEditingContextStore.getState().setDragActive(true);
        }
        const context = useEditingContextStore.getState();
        const shiftLock = event.shiftKey && !g.edge;
        const horizontalAllowed = !shiftLock || g.axis === 'horizontal';
        const verticalAllowed = !shiftLock || g.axis === 'vertical';
        const hoveredTrackId = verticalAllowed ? (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-track-id]') as HTMLElement | null)?.dataset.trackId : trackId;
        let rawDelta = horizontalAllowed ? Math.round(dx / pxPerTick) : 0;
        const grabbedRaw = clip.startTick + rawDelta;
        const relative = event.altKey && event.shiftKey;
        const snapInvert = event.altKey && !event.shiftKey && !g.copy;
        const snapped = snapTick(relative ? grabbedRaw - g.relativeOffset : grabbedRaw, g.candidates, pxPerTick, context.snapMode, snapInvert);
        rawDelta = (relative ? snapped + g.relativeOffset : snapped) - clip.startTick;
        if (g.slip) {
            useArrangementStore.getState().previewGesture(slipClips(arrangement, g.selectedIds, rawDelta).verbs);
        } else if (g.edge) {
            const at = g.edge === 'start' ? clip.startTick + rawDelta : clip.startTick + clip.lengthTick + rawDelta;
            useArrangementStore.getState().previewGesture(trimClip(arrangement, g.selectedIds, g.edge, at).verbs);
        } else if (g.copy) {
            useArrangementStore.getState().previewGesture((g.copyTemplates ?? []).map((verb) => ({ ...verb, clip: { ...verb.clip, startTick: Math.max(0, verb.clip.startTick + rawDelta) } })));
        } else {
            const ripple = context.editMode === 'ripple';
            useArrangementStore.getState().previewGesture(moveClips(arrangement, g.selectedIds, rawDelta, { ripple, toTrackId: ripple ? undefined : hoveredTrackId }).verbs);
        }
    };

    const startAutoScroll = () => {
        const tick = () => {
            const g = gesture.current;
            if (!g) return;
            if (g.active && g.scroll) {
                const rect = g.scroll.getBoundingClientRect();
                const x = autoScrollDelta(g.lastX, rect.left + 200, rect.right);
                const y = autoScrollDelta(g.lastY, rect.top + 46, rect.bottom);
                if (x || y) {
                    g.scroll.scrollLeft += x;
                    g.scroll.scrollTop += y;
                    preview({ clientX: g.lastX, clientY: g.lastY, shiftKey: false, altKey: false } as PointerEvent);
                }
            }
            g.frame = requestAnimationFrame(tick);
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
            const x = event.nativeEvent.offsetX;
            const edge = x <= zone + 4 ? 'start' : x >= width - zone - 4 ? 'end' : null;
            const context = useEditingContextStore.getState();
            const slip = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey;
            if (slip && context.editMode === 'lock') return;
            const tb = timebase(arrangement);
            const step = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, pxPerTick) ?? 1;
            const candidates: number[] = [];
            if (context.snapTarget !== 'other') for (let tick = 0; tick <= Math.max(clip.startTick + clip.lengthTick + tb.ticksPerBar * 16, tb.ticksPerBar * 32); tick += step) candidates.push(tick);
            if (context.snapTarget !== 'grid') {
                for (const track of arrangement.tracks) for (const item of track.clips) if (item.id !== clip.id) candidates.push(item.startTick, item.startTick + item.lengthTick);
                for (const location of arrangement.locations ?? []) candidates.push(location.startTick, ...(location.endTick == null ? [] : [location.endTick]));
                if (!useArrangementStore.getState().isPlaying) candidates.push(useArrangementStore.getState().playheadTick);
            }
            const nearest = candidates.length ? candidates.reduce((best, value) => Math.abs(value - clip.startTick) < Math.abs(best - clip.startTick) ? value : best) : clip.startTick;
            const scroll = event.currentTarget.closest('.arrangement-scroll') as HTMLElement | null;
            // Alt+drag copies; Alt+Shift is the distinct relative-snap gesture.
            // Keeping those modes exclusive prevents a relative move from
            // silently becoming a duplicate with snapping inverted.
            const copy = event.altKey && !event.shiftKey && !slip;
            gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, originalScrollLeft: scroll?.scrollLeft ?? 0, copy, slip, edge: slip ? null : edge, axis: null, active: false, selectedIds, relativeOffset: clip.startTick - nearest, candidates, scroll, frame: null, followPlayheadBefore: context.followPlayhead };
            useEditingContextStore.setState({ followPlayhead: false });
            const move = (nativeEvent: PointerEvent) => { if (gesture.current) preview(nativeEvent); };
            const up = () => { if (gesture.current) finish(true); };
            const cancel = () => { if (gesture.current) finish(false); };
            const mouseMove = (nativeEvent: MouseEvent) => { if (gesture.current) preview(nativeEvent as unknown as PointerEvent); };
            const mouseUp = () => { if (gesture.current) finish(true); };
            gesture.current.cleanup = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', cancel);
                window.removeEventListener('mousemove', mouseMove);
                window.removeEventListener('mouseup', mouseUp);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', cancel);
            window.addEventListener('mousemove', mouseMove);
            window.addEventListener('mouseup', mouseUp);
            event.currentTarget.setPointerCapture(event.pointerId);
            useArrangementStore.getState().beginGesture(slip ? 'Slip clip contents' : edge ? `Trim clip ${edge}` : copy ? 'Duplicate clips' : 'Move clips');
            startAutoScroll();
        },
        onPointerCancel: () => finish(false),
        deleteSelection: () => {
            const arrangement = useArrangementStore.getState().arrangement;
            if (!arrangement) return;
            const ids = useEditingContextStore.getState().viewports.arrangement.selection.clipIds;
            useArrangementStore.getState().apply(deleteClips(arrangement, ids).verbs);
        },
    };
}
