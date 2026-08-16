import type { Location } from '../../song/types';
import type { GridUnit } from '../../store/editingContextStore';
import { getGridLadder } from '../../song/rulerMarks';
import { TimeRuler, type TimeRulerMark } from '@openjammer/oj-ui';

interface RulerStackProps {
    fieldWidth: number;
    contentWidth: number;
    scrollLeft: number;
    pxPerTick: number;
    ticksPerBar: number;
    beatsPerBar: number;
    gridUnit: GridUnit;
    snapOn: boolean;
    sections: Location[];
    songEnd: number;
    loop?: Location;
    onSeek: (x: number) => void;
    onToggleSnap: () => void;
}

export function RulerStack(props: RulerStackProps) {
    const pxPerBar = props.pxPerTick * props.ticksPerBar;
    const ladder = getGridLadder(pxPerBar, props.beatsPerBar, props.gridUnit);
    const firstBar = Math.max(0, Math.floor(props.scrollLeft / pxPerBar));
    const lastBar = Math.ceil((props.scrollLeft + props.fieldWidth) / pxPerBar);
    const bars: TimeRulerMark[] = [];
    for (let bar = firstBar; bar <= lastBar; bar++) {
        if (bar % ladder.labelStride !== 0) continue;
        bars.push({ id: bar, x: bar * pxPerBar, label: String(bar + 1), level: 'bar' });
    }
    return (
        <div className="arrangement-ruler-shell">
            <div className="arrangement-corner">
                <span className="arrangement-grid-chip">{props.gridUnit}</span>
                <button className="arrangement-magnet" type="button" aria-label="Snap to grid" aria-pressed={props.snapOn} onClick={props.onToggleSnap}>∩</button>
            </div>
            <div className="arrangement-ruler-viewport" onPointerDown={(event) => props.onSeek(event.clientX)} aria-hidden="true">
                <div className="arrangement-ruler-content" style={{ width: props.contentWidth, transform: `translateX(${-props.scrollLeft}px)` }}>
                    <div className="arrangement-sections-row">
                        {props.sections.map((section, index) => {
                            const next = props.sections[index + 1];
                            const width = ((section.endTick ?? next?.startTick ?? props.songEnd) - section.startTick) * props.pxPerTick;
                            return <span key={section.id ?? section.name} className="arrangement-section-chip" style={{ left: section.startTick * props.pxPerTick, width }}>{section.name}</span>;
                        })}
                        {props.loop?.endTick != null && <div className="arrangement-loop-bracket" style={{ left: props.loop.startTick * props.pxPerTick, width: (props.loop.endTick - props.loop.startTick) * props.pxPerTick }}><span>[</span><span>]</span></div>}
                    </div>
                    {/* taste-review #16: sections intentionally stay above bars so the exact bar scale remains adjacent to the field. */}
                    <div className="arrangement-bars-row"><TimeRuler marks={bars} width={props.contentWidth} /></div>
                </div>
            </div>
        </div>
    );
}
