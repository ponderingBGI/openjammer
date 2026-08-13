/**
 * TransportBar — the timeline's top strip: play/stop, a live bar.beat readout, the
 * song title, tempo, and undo/redo. Play/stop and undo/redo go through the store's
 * command-log, the SAME one the agent drives, so the controls a human presses and
 * the edits an agent makes share one history.
 *
 * The bar.beat readout updates every animation frame by writing textContent directly
 * (rAF for the visual; no per-frame React re-render).
 */

import { useEffect, useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { formatBarBeat, timebase } from '../../song/time';

function TimeReadout() {
    const ref = useRef<HTMLSpanElement>(null);
    // Mirror the Playhead: the per-frame loop runs only while playing; otherwise a
    // single write keeps the readout correct after stop/seek (no idle 60fps loop).
    const isPlaying = useArrangementStore((s) => s.isPlaying);
    const playheadTick = useArrangementStore((s) => s.playheadTick);
    useEffect(() => {
        const write = () => {
            const { arrangement, currentTick } = useArrangementStore.getState();
            const el = ref.current;
            if (el && arrangement) el.textContent = formatBarBeat(timebase(arrangement), currentTick());
        };
        write();
        if (!isPlaying) return;
        let raf = 0;
        const frame = () => {
            write();
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [isPlaying, playheadTick]);
    return <span className="song-time" ref={ref}>1.1</span>;
}

export function TransportBar() {
    const isPlaying = useArrangementStore((s) => s.isPlaying);
    const play = useArrangementStore((s) => s.play);
    const stop = useArrangementStore((s) => s.stop);
    const seek = useArrangementStore((s) => s.seek);
    const undo = useArrangementStore((s) => s.undo);
    const redo = useArrangementStore((s) => s.redo);
    const canUndo = useArrangementStore((s) => s.undoStack.length > 0);
    const canRedo = useArrangementStore((s) => s.redoStack.length > 0);
    const name = useArrangementStore((s) => s.arrangement?.name ?? 'Song');
    const tempo = useArrangementStore((s) => s.arrangement?.tempoBpm ?? 120);

    return (
        <div className="song-transport">
            <div className="song-transport-left">
                <button
                    className={`song-play ${isPlaying ? 'is-playing' : ''}`}
                    onClick={() => (isPlaying ? stop() : play())}
                    title={isPlaying ? 'Stop' : 'Play'}
                >
                    {isPlaying ? '■' : '▶'}
                </button>
                <button className="song-rewind" onClick={() => seek(0)} title="Return to start">
                    ⏮
                </button>
                <TimeReadout />
            </div>
            <div className="song-transport-title">{name}</div>
            <div className="song-transport-right">
                <span className="song-tempo">{tempo} BPM</span>
                <button className="song-undo" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                    ↶
                </button>
                <button className="song-redo" onClick={redo} disabled={!canRedo} title="Redo">
                    ↷
                </button>
            </div>
        </div>
    );
}
