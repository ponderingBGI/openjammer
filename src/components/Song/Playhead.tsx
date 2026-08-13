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
    /** The scrolling `.song-grid` container, so the playhead can keep itself in view. */
    scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function Playhead({ pxPerTick, gutterPx, scrollRef }: PlayheadProps) {
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

            // Follow-scroll: keep the playhead in view on a long song (perception is the
            // medium — the performer must never lose their position). Continuous tracking,
            // not an animation, so prefers-reduced-motion does not apply here.
            const grid = scrollRef.current;
            if (grid) {
                const headX = gutterPx + tick * pxPerTick; // x within the scroll content
                const laneLeft = grid.scrollLeft + gutterPx; // first non-gutter column
                const viewRight = grid.scrollLeft + grid.clientWidth;
                if (headX > viewRight - 64 || headX < laneLeft) {
                    // Re-seat the playhead ~a third in from the gutter.
                    grid.scrollLeft = Math.max(0, headX - gutterPx - (grid.clientWidth - gutterPx) / 3);
                }
            }
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
    }, [pxPerTick, gutterPx, scrollRef, isPlaying, playheadTick]);

    return <div ref={ref} className="song-playhead" style={{ left: gutterPx }} />;
}
