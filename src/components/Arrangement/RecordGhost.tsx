import { useEffect, useMemo, useRef } from 'react';
import type { CapturedNote } from '@openjammer/oj-protocol';
import { useArrangementStore } from '../../store/arrangementStore';

export function RecordGhost({
    node, startTick, endTick, pxPerTick, laneHeight, notes, pitchRange,
}: {
    node: number;
    startTick: number;
    endTick: number;
    pxPerTick: number;
    laneHeight: number;
    notes: readonly CapturedNote[];
    pitchRange: { lo: number; hi: number };
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let frame = 0;
        const paint = () => {
            const element = ref.current;
            if (element) {
                const tick = Math.min(endTick, Math.max(startTick, useArrangementStore.getState().currentTick()));
                element.style.width = `${Math.max(1, (tick - startTick) * pxPerTick)}px`;
            }
            frame = requestAnimationFrame(paint);
        };
        frame = requestAnimationFrame(paint);
        return () => cancelAnimationFrame(frame);
    }, [endTick, pxPerTick, startTick]);

    const marks = useMemo(() => notes.filter((note) => note.node === node && note.on), [node, notes]);
    const span = Math.max(1, pitchRange.hi - pitchRange.lo + 1);
    return (
        <div ref={ref} className="arrangement-record-ghost" style={{ left: startTick * pxPerTick, height: laneHeight - 8 }} aria-hidden="true">
            {marks.map((note, index) => (
                <span key={`${note.tick}:${note.note}:${index}`} style={{
                    left: Math.max(0, (note.tick - startTick) * pxPerTick),
                    top: Math.max(20, (pitchRange.hi - note.note) / span * Math.max(1, laneHeight - 24)),
                }} />
            ))}
        </div>
    );
}
