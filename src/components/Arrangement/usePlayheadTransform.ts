import { useEffect, type RefObject } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { registerTimelineFrameWriter } from './sharedAnimationFrame';

/**
 * THE SCROLL-SYNCHRONOUS WRITERS.
 *
 * Everything that has to stay pinned to a tick while the field scrolls writes
 * its transform from HERE, inside the scroll event itself. Not from a rAF, and
 * not from React state: a state hop puts the element one frame of scroll behind
 * the clips it is pointing at, which on a wheel notch is 150px (measured,
 * W4-TBb §2) and on a ruled surface is the same lie as an unlocked pixel.
 *
 * One registry, one call, so no two of them can be a frame apart from each
 * other either. The arrangement's `onScroll` calls `writeScrollTransforms()`
 * exactly once and every registered element moves in that same call.
 */
const scrollWriters = new Set<() => void>();

/** Registers a DOM write that must happen inside `onScroll`. Returns the undo. */
export function registerScrollWriter(write: () => void): () => void {
    scrollWriters.add(write);
    return () => { scrollWriters.delete(write); };
}

/** ONE call per scroll event — the field overlay pane's origin AND the cap. */
export function writeScrollTransforms(): void {
    for (const write of [...scrollWriters]) write();
}

/**
 * ONE law for where the playhead is, written straight onto the DOM.
 *
 * The playhead is drawn as two elements that must never disagree: the LINE,
 * which rides the field overlay pane so it stops at the header's edge, and the
 * CAP, which rides the ruler's own clipped viewport so it can sit in the bars
 * row without ever reaching the 200px corner. Both call this, so there is one
 * tick, one multiply and one transform string — not two clocks that drift.
 *
 * They also have to be counter-translated by the same scroll, in the same call.
 * The line gets that for free — its pane's origin is written in `onScroll`. The
 * cap does not: it used to ride `.arrangement-ruler-content`, whose
 * `translateX(-scrollLeft)` is React state committed in a rAF, so a wheel notch
 * tore the playhead in two — line and cap up to **150px apart** for a frame,
 * exactly one frame of scroll at any rate. So a caller that is NOT inside a
 * counter-translated pane passes `counterScrollX`, and this hook joins the same
 * `onScroll` writer the pane uses.
 *
 * While the engine is rolling it rides the shared timeline frame; while it is
 * stopped it writes once and then only when `playheadTick` actually changes —
 * plus, either way, on every scroll event if it is counter-translating.
 * Reduced motion never enters into it: this is the clock, not decoration.
 *
 * `onWrite` and `counterScrollX` must be stable (`useCallback`) — they are real
 * dependencies of the subscription, not render-time escape hatches.
 */
export function usePlayheadTransform(
    ref: RefObject<HTMLElement | null>,
    pxPerTick: number,
    isPlaying: boolean,
    onWrite?: (tick: number) => void,
    counterScrollX?: () => number,
) {
    useEffect(() => {
        const write = () => {
            const tick = useArrangementStore.getState().currentTick();
            if (ref.current) ref.current.style.transform = `translate3d(${tick * pxPerTick - (counterScrollX?.() ?? 0)}px,0,0)`;
            onWrite?.(tick);
        };
        const unregister = counterScrollX ? registerScrollWriter(write) : undefined;
        if (!isPlaying) {
            write();
            const unsubscribe = useArrangementStore.subscribe((state, previous) => { if (state.playheadTick !== previous.playheadTick) write(); });
            return () => { unregister?.(); unsubscribe(); };
        }
        const stopFrame = registerTimelineFrameWriter(write);
        return () => { unregister?.(); stopFrame(); };
    }, [ref, isPlaying, pxPerTick, onWrite, counterScrollX]);
}
