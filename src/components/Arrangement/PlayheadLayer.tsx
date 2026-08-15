import { useEffect, useRef, type RefObject } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';

export function PlayheadLayer({ pxPerTick, scrollRef }: { pxPerTick: number; scrollRef: RefObject<HTMLDivElement | null> }) {
    const ref = useRef<HTMLDivElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    useEffect(() => {
        const write = () => {
            const tick = useArrangementStore.getState().currentTick();
            if (ref.current) ref.current.style.transform = `translate3d(${tick * pxPerTick}px,0,0)`;
            const scroll = scrollRef.current;
            if (scroll) {
                const x = tick * pxPerTick;
                const pageWidth = Math.max(1, scroll.clientWidth - 200);
                if (x < scroll.scrollLeft || x > scroll.scrollLeft + pageWidth - 64) scroll.scrollLeft = Math.max(0, x - pageWidth / 3);
            }
        };
        write();
        if (!isPlaying) return;
        let frame = requestAnimationFrame(function loop() { write(); frame = requestAnimationFrame(loop); });
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, playheadTick, pxPerTick, scrollRef]);
    return <div ref={ref} className="arrangement-playhead" aria-hidden="true" />;
}
