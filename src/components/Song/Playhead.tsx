/**
 * Playhead — the vertical line that tracks playback. It reads the store's
 * `currentTick()` every animation frame and moves itself by writing `transform`
 * DIRECTLY to the DOM (rAF for the VISUAL only — audio timing lives on
 * AudioContext.currentTime inside the store). When the transport is stopped,
 * `currentTick()` returns the frozen anchor, so the line simply holds still — it
 * never snaps back to zero (the Live Performance Rule at the timeline surface).
 */

import { useEffect, useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';

interface PlayheadProps {
    pxPerTick: number;
    gutterPx: number;
}

export function Playhead({ pxPerTick, gutterPx }: PlayheadProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let raf = 0;
        const frame = () => {
            const tick = useArrangementStore.getState().currentTick();
            const el = ref.current;
            if (el) el.style.transform = `translateX(${tick * pxPerTick}px)`;
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [pxPerTick]);

    return <div ref={ref} className="song-playhead" style={{ left: gutterPx }} />;
}
