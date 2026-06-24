/**
 * TrackLane — one track row: a sticky-left header (name + mute) and a scrolling lane
 * of clips. A clip is a soft paper card; its notes are ink marks placed by tick (x)
 * and pitch (y, mapped within the track's own range so a bass and a lead each fill
 * their lane). Mute toggles through the reversible verb, so one Ctrl+Z undoes it.
 */

import { useMemo } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import type { ArrangementTrack } from '../../song/types';

interface TrackLaneProps {
    track: ArrangementTrack;
    pxPerTick: number;
    gutterPx: number;
    laneHeight: number;
    fieldWidth: number;
}

/** Vertical inset so notes never touch the lane edges. */
const PAD_Y = 8;

export function TrackLane({ track, pxPerTick, gutterPx, laneHeight, fieldWidth }: TrackLaneProps) {
    const apply = useArrangementStore((s) => s.apply);
    const selectClip = useArrangementStore((s) => s.selectClip);
    const selectedClipId = useArrangementStore((s) => s.selectedClipId);

    // Pitch range across this track's notes, for vertical mapping (with a margin so a
    // single-pitch track sits centred rather than on an edge).
    const { lo, hi } = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        for (const clip of track.clips) {
            for (const n of clip.notes) {
                min = Math.min(min, n.pitch);
                max = Math.max(max, n.pitch);
            }
        }
        if (!Number.isFinite(min)) return { lo: 48, hi: 72 };
        if (min === max) return { lo: min - 6, hi: max + 6 };
        return { lo: min - 1, hi: max + 1 };
    }, [track.clips]);

    const yFor = (pitch: number) => {
        const span = hi - lo || 1;
        const norm = (pitch - lo) / span; // 0..1, low->0
        return laneHeight - PAD_Y - norm * (laneHeight - 2 * PAD_Y); // invert: high pitch -> top
    };

    const muted = track.mute === true;

    return (
        <div className="song-track" style={{ height: laneHeight }}>
            <div className="song-track-header" style={{ width: gutterPx }}>
                <button
                    className={`song-mute ${muted ? 'is-muted' : ''}`}
                    title={muted ? 'Unmute' : 'Mute'}
                    onClick={() => apply({ kind: 'setTrackMute', trackId: track.id!, mute: !muted })}
                >
                    {muted ? 'M' : 'M'}
                </button>
                <span className="song-track-name">{track.name ?? track.ref}</span>
            </div>
            <div className={`song-lane ${muted ? 'is-muted' : ''}`} style={{ width: fieldWidth }}>
                {track.clips.map((clip) => {
                    const start = clip.startTick * pxPerTick;
                    let end = start;
                    for (const n of clip.notes) {
                        end = Math.max(end, (clip.startTick + n.tick + Math.max(1, n.durTick)) * pxPerTick);
                    }
                    const width = Math.max(6, end - start);
                    return (
                        <div
                            key={clip.id}
                            className={`song-clip ${selectedClipId === clip.id ? 'selected' : ''}`}
                            style={{ left: start, width, height: laneHeight - 6 }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                selectClip(clip.id!);
                            }}
                        >
                            {clip.notes.map((n) => (
                                <span
                                    key={n.id}
                                    className="song-note"
                                    style={{
                                        left: (clip.startTick + n.tick) * pxPerTick - start,
                                        width: Math.max(3, Math.max(1, n.durTick) * pxPerTick - 1),
                                        top: yFor(n.pitch),
                                    }}
                                    title={`pitch ${n.pitch}`}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
