import { useEffect, useRef, type RefObject } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { registerTimelineFrameWriter } from './sharedAnimationFrame';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';

export function PlayheadLayer({ pxPerTick, scrollRef, height }: { pxPerTick: number; scrollRef: RefObject<HTMLDivElement | null>; height: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    useEffect(() => {
        const write = () => {
            const tick = useArrangementStore.getState().currentTick();
            if (ref.current) ref.current.style.transform = `translate3d(${tick * pxPerTick}px,0,0)`;
            const scroll = scrollRef.current;
            if (scroll && useEditingContextStore.getState().followPlayhead) {
                const x = tick * pxPerTick;
                const pageWidth = Math.max(1, scroll.clientWidth - useTrackLaneViewStore.getState().headerWidth);
                const rightThreshold = scroll.scrollLeft + pageWidth * 0.85;
                if (x < scroll.scrollLeft || x > rightThreshold) scroll.scrollLeft = Math.max(0, x - pageWidth / 6);
            }
        };
        if (!isPlaying) {
            write();
            return useArrangementStore.subscribe((state, previous) => { if (state.playheadTick !== previous.playheadTick) write(); });
        }
        return registerTimelineFrameWriter(write);
    }, [isPlaying, pxPerTick, scrollRef]);
    return <div ref={ref} className="arrangement-playhead" style={{ height }} aria-hidden="true" />;
}
