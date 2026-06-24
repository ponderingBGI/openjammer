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
    // The rAF loop runs ONLY while playing; when stopped the playhead is frozen, so a
    // single write settles it (and a seek-while-stopped re-runs this effect via the
    // playheadTick dep) — no idle 60fps loop pinning a core when the timeline is open.
    const isPlaying = useArrangementStore((s) => s.isPlaying);
    const playheadTick = useArrangementStore((s) => s.playheadTick);

    useEffect(() => {
        const write = () => {
            const tick = useArrangementStore.getState().currentTick();
            const el = ref.current;
            if (el) el.style.transform = `translateX(${tick * pxPerTick}px)`;
        };
        write(); // settle the frozen / seeked position immediately
        if (!isPlaying) return; // stopped: no loop, the playhead holds still
        let raf = 0;
        const frame = () => {
            write();
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [pxPerTick, isPlaying, playheadTick]);

    return <div ref={ref} className="song-playhead" style={{ left: gutterPx }} />;
}
