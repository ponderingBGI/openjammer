/**
 * Ruler — the bar/beat strip across the top of the timeline, with section markers.
 * It is sticky-top so it stays in view while the lanes scroll. Bars are 1-based and
 * labelled; sections show their name at the bar they begin. Clicking anywhere seeks
 * the playhead (a hand aiming, never an auto-snap).
 */

import type { ArrangementSection } from '../../song/types';

interface RulerProps {
    bars: number;
    pxPerBar: number;
    gutterPx: number;
    pxPerTick: number;
    sections: ArrangementSection[];
    sectionTick: (startBar: number) => number;
    onSeek: (clientX: number) => void;
}

export function Ruler({ bars, pxPerBar, gutterPx, pxPerTick, sections, sectionTick, onSeek }: RulerProps) {
    return (
        <div className="song-ruler-row">
            {/* sticky corner over the gutter */}
            <div className="song-ruler-corner" style={{ width: gutterPx }} />
            <div
                className="song-ruler"
                onMouseDown={(e) => {
                    e.preventDefault();
                    onSeek(e.clientX);
                }}
            >
                {Array.from({ length: bars }, (_, i) => (
                    <div key={i} className="song-bar-tick" style={{ left: i * pxPerBar }}>
                        <span className="song-bar-num">{i + 1}</span>
                    </div>
                ))}
                {sections.map((s) => (
                    <div
                        key={s.id ?? s.name}
                        className="song-section-marker"
                        style={{ left: sectionTick(s.startBar) * pxPerTick }}
                        title={`Section: ${s.name} (bar ${s.startBar})`}
                    >
                        <span className="song-section-label">{s.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
