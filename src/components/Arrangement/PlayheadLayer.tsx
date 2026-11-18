import { useCallback, useRef, type RefObject } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { usePlayheadTransform } from './usePlayheadTransform';

export function PlayheadLayer({ pxPerTick, scrollRef, height }: { pxPerTick: number; scrollRef: RefObject<HTMLDivElement | null>; height: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const follow = useCallback((tick: number) => {
        const scroll = scrollRef.current;
        if (!scroll || !useEditingContextStore.getState().followPlayhead) return;
        const x = tick * pxPerTick;
        const pageWidth = Math.max(1, scroll.clientWidth - useTrackLaneViewStore.getState().headerWidth);
        const rightThreshold = scroll.scrollLeft + pageWidth * 0.85;
        if (x < scroll.scrollLeft || x > rightThreshold) scroll.scrollLeft = Math.max(0, x - pageWidth / 6);
    }, [pxPerTick, scrollRef]);
    usePlayheadTransform(ref, pxPerTick, isPlaying, follow);
    /*
     * Rolling vs stopped is carried by COLOUR and WIDTH, never by blur: the New
     * DNA reserves glow for things carrying live audio, and a position marker is
     * not one (spec D15). 2px accent while the engine is sending frames, a quiet
     * 1.5px --t2 line when it is not — so a frozen playhead reads as stopped
     * rather than as a lie about where you are.
     *
     * This is the LINE only. Its 9px cap is `PlayheadCap`, inside the ruler's
     * own clipped viewport — see `.arrangement-playhead-cap`.
     */
    return <div ref={ref} className={`arrangement-playhead${isPlaying ? ' is-rolling' : ''}`} style={{ height }} aria-hidden="true" />;
}

/**
 * The 9px cap, inside the ruler's VIEWPORT — not inside the ruler's content.
 *
 * The viewport already begins at the header edge and already clips, so the cap
 * keeps its place in the bars row and can never reach the 200px corner. Sitting
 * outside the content is what lets it counter-translate itself from the LIVE
 * scroll offset, in the same `onScroll` call that moves the line's pane: the
 * content's own `translateX` is React state committed a frame later, and while
 * the cap rode it a single wheel notch pulled the cap 150px off its own line
 * (W4-TBb §2). `offsetX` is that counter-translation, and it is the only reason
 * the cap is not simply a child of `.arrangement-ruler-content`.
 */
export function PlayheadCap({ pxPerTick, offsetX }: { pxPerTick: number; offsetX: () => number }) {
    const ref = useRef<HTMLDivElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    usePlayheadTransform(ref, pxPerTick, isPlaying, undefined, offsetX);
    return <div ref={ref} className={`arrangement-playhead-cap${isPlaying ? ' is-rolling' : ''}`} aria-hidden="true" />;
}
