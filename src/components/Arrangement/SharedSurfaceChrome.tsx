import { useEffect, useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { formatBarBeat, timebase } from '../../song/time';
import type { SurfaceId } from '../../store/uiViewStore';

export function SharedSurfaceChrome({ surface, setSurface }: { surface: SurfaceId; setSurface: (surface: SurfaceId) => void }) {
    const readoutRef = useRef<HTMLSpanElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    useEffect(() => {
        const write = () => {
            const { arrangement, currentTick } = useArrangementStore.getState();
            if (readoutRef.current) readoutRef.current.textContent = arrangement ? formatBarBeat(timebase(arrangement), currentTick()) : '1.1';
        };
        write();
        if (!isPlaying) return;
        let frame = requestAnimationFrame(function loop() { write(); frame = requestAnimationFrame(loop); });
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, playheadTick]);
    return (
        <div className="shared-surface-chrome">
            <span ref={readoutRef} className="shared-bar-beat" aria-label="Playhead position">1.1</span>
            <div className="surface-switcher" role="group" aria-label="Editing surface">
                <button aria-pressed={surface === 'canvas'} onClick={() => setSurface('canvas')}>Canvas</button>
                <button aria-pressed={surface === 'arrangement'} onClick={() => setSurface('arrangement')}>Arrangement</button>
            </div>
        </div>
    );
}
