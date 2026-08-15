/**
 * SongInterior — the timeline body rendered by the peer arrangement surface.
 * It is a VIEW over the arrangementStore (the ONE Arrangement); a human drag
 * and an agent verb both flow through the same store + command-log, so the timeline
 * a human edits and the one an agent edits are the same surface (the meeting ground).
 *
 * Layout is a CSS sticky grid: a fixed left gutter of track headers, a sticky ruler
 * across the top, and a horizontally-scrolling field of lanes. The playhead is anchored
 * to AudioContext.currentTime (see Playhead) and FREEZES on stop — never a jump.
 *
 * Living Sketchbook: warm paper, ink lines, Caveat, hard blur-free shadows; bars and
 * sections are labelled (never raw ticks); audio is blue, control grey.
 */

import { useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import { Ruler } from './Ruler';
import { TrackLane } from './TrackLane';
import { Playhead } from './Playhead';
import { TransportBar } from './TransportBar';
import './SongInterior.css';

/** Horizontal scale: pixels per bar. The single knob that sets the timeline zoom. */
export const PX_PER_BAR = 104;
/** Fixed left column holding each track's name + mute. */
export const GUTTER_PX = 156;
/** Height of one track lane. */
export const LANE_PX = 64;

export function SongInterior({ songNodeId }: { songNodeId: string }) {
    const arrangement = useArrangementStore((s) => s.arrangement);
    const setArrangement = useArrangementStore((s) => s.setArrangement);
    const seek = useArrangementStore((s) => s.seek);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Empty state: a warm invitation, plus the one-click Paper Sketch starter so the
    // first timeline a human ever sees is already a real little song (delight: a warm
    // canvas, never a blank grey grid). Strip codeNodes — the agent-authored faust
    // node is native/headless only; the Karplus voices play in the browser as-is.
    if (!arrangement) {
        const startFromSketch = () => {
            const sketch = buildPaperSketch();
            setArrangement({ ...sketch, codeNodes: undefined });
        };
        return (
            <div className="song-interior song-interior--empty" data-song-node={songNodeId}>
                <div className="song-empty-card">
                    <div className="song-empty-title">An empty page.</div>
                    <div className="song-empty-sub">
                        Start a sketch — or ask the agent to dream one up. You can undo anything with Ctrl+Z.
                    </div>
                    <button className="song-empty-start" onClick={startFromSketch}>
                        Start from “Paper Sketch”
                    </button>
                </div>
            </div>
        );
    }

    const tb = timebase(arrangement);
    const lengthTicks = arrangementLengthTicks(arrangement);
    const pxPerTick = PX_PER_BAR / tb.ticksPerBar;
    const fieldWidth = lengthTicks * pxPerTick;
    const bars = Math.round(lengthTicks / tb.ticksPerBar);

    // Click the ruler to drop the playhead on that bar/tick (snaps nowhere — the
    // player aims; a held read of the position beats an auto-snap that lies).
    const seekFromClientX = (clientX: number) => {
        const field = scrollRef.current;
        if (!field) return;
        const rect = field.getBoundingClientRect();
        const xInField = clientX - rect.left - GUTTER_PX + field.scrollLeft;
        seek(Math.max(0, xInField / pxPerTick));
    };

    return (
        <div className="song-interior" data-song-node={songNodeId}>
            <TransportBar />
            <div className="song-grid" ref={scrollRef}>
                <div className="song-grid-content" style={{ width: GUTTER_PX + fieldWidth }}>
                    <Ruler
                        bars={bars}
                        pxPerBar={PX_PER_BAR}
                        gutterPx={GUTTER_PX}
                        sections={(arrangement.locations ?? []).filter((location) => location.kind === 'section')}
                        pxPerTick={pxPerTick}
                        onSeek={seekFromClientX}
                    />
                    <div className="song-lanes">
                        {arrangement.tracks.map((track) => (
                            <TrackLane
                                key={track.id}
                                track={track}
                                sources={arrangement.sources}
                                pxPerTick={pxPerTick}
                                gutterPx={GUTTER_PX}
                                laneHeight={LANE_PX}
                                fieldWidth={fieldWidth}
                            />
                        ))}
                    </div>
                    <Playhead pxPerTick={pxPerTick} gutterPx={GUTTER_PX} scrollRef={scrollRef} />
                </div>
            </div>
        </div>
    );
}
