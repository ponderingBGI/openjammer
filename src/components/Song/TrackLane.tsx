/**
 * TrackLane — one track row: a sticky-left header (name + mute) and a scrolling lane
 * of clips. A clip is a soft paper card; its notes are ink marks placed by tick (x)
 * and pitch (y, mapped within the track's own range so a bass and a lead each fill
 * their lane). Mute toggles through the reversible verb, so one Ctrl+Z undoes it.
 */

import { useEffect, useMemo } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import {
    growPitchRange,
    initialPitchRange,
    useTrackLaneViewStore,
} from '../../store/trackLaneViewStore';
import { midiToNote } from '../../music/note';
import type { Arrangement, ArrangementNote, ArrangementTrack } from '../../song/types';

interface TrackLaneProps {
    track: ArrangementTrack;
    sources: Arrangement['sources'];
    pxPerTick: number;
    gutterPx: number;
    laneHeight: number;
    fieldWidth: number;
}

/** Vertical inset so notes never touch the lane edges. */
const PAD_Y = 8;

export function TrackLane({ track, sources, pxPerTick, gutterPx, laneHeight, fieldWidth }: TrackLaneProps) {
    const apply = useArrangementStore((s) => s.apply);
    const selectClip = useArrangementStore((s) => s.selectClip);
    const selectedClipId = useArrangementStore((s) => s.selectedClipId);
    const selectNotes = useArrangementStore((s) => s.selectNotes);
    const selectedNoteIds = useArrangementStore((s) => s.selectedNoteIds);

    const trackViewId = track.id ?? track.ref;
    const rememberedRange = useTrackLaneViewStore((s) => s.pitchRanges[trackViewId]);
    const rememberPitchRange = useTrackLaneViewStore((s) => s.rememberPitchRange);
    const { minPitch, maxPitch } = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        for (const clip of track.clips) {
            const source = sources?.[clip.sourceId];
            if (source?.kind !== 'midi') continue;
            for (const n of source.notes) {
                min = Math.min(min, n.pitch);
                max = Math.max(max, n.pitch);
            }
        }
        return { minPitch: min, maxPitch: max };
    }, [sources, track.clips]);
    const range = rememberedRange
        ? growPitchRange(rememberedRange, minPitch, maxPitch)
        : initialPitchRange(minPitch, maxPitch);

    useEffect(() => {
        rememberPitchRange(trackViewId, range);
    }, [rememberPitchRange, trackViewId, range]);

    const { lo, hi } = range;

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
                    aria-label={muted ? 'Unmute track' : 'Mute track'}
                    aria-pressed={muted}
                    onClick={() => apply({ kind: 'setTrackMute', trackId: track.id!, mute: !muted })}
                >
                    M
                </button>
                <span className="song-track-name">{track.name ?? track.ref}</span>
            </div>
            <div className={`song-lane ${muted ? 'is-muted' : ''}`} style={{ width: fieldWidth }}>
                {track.clips.map((clip) => {
                    const start = clip.startTick * pxPerTick;
                    const end = (clip.startTick + clip.lengthTick) * pxPerTick;
                    const width = Math.max(6, end - start);
                    const source = sources?.[clip.sourceId];
                    const sourceStart = clip.sourceStart ?? 0;
                    const notes: ArrangementNote[] = source?.kind === 'midi'
                        ? source.notes.filter((note) => note.tick + Math.max(1, note.durTick) > sourceStart && note.tick < sourceStart + clip.lengthTick)
                        : [];
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
                            {notes.map((n) => (
                                <span
                                    key={n.id}
                                    className={`song-note ${selectedNoteIds.includes(n.id!) ? 'selected' : ''}`}
                                    style={{
                                        left: Math.max(0, n.tick - sourceStart) * pxPerTick,
                                        width: Math.max(3, Math.min(clip.lengthTick - Math.max(0, n.tick - sourceStart), Math.max(1, n.durTick)) * pxPerTick - 1),
                                        top: yFor(n.pitch),
                                    }}
                                    title={midiToNote(n.pitch)}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        selectNotes([n.id!]);
                                    }}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
