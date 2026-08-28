import { useEffect, useRef } from 'react';
import type { Location } from '../../song/types';
import type { GridUnit } from '../../store/editingContextStore';
import { crispLineX, getGridLadder } from '../../song/rulerMarks';

interface GridLayerProps {
    width: number;
    height: number;
    scrollLeft: number;
    pxPerTick: number;
    ticksPerBar: number;
    beatsPerBar: number;
    gridUnit: GridUnit;
    sections: Location[];
}

export function GridLayer(props: GridLayerProps) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas || props.width <= 0 || props.height <= 0) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(props.width * ratio);
        canvas.height = Math.ceil(props.height * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, props.width, props.height);
        const styles = getComputedStyle(canvas);
        const pxPerBar = props.pxPerTick * props.ticksPerBar;
        const ladder = getGridLadder(pxPerBar, props.beatsPerBar, props.gridUnit);
        const firstBar = Math.max(0, Math.floor(props.scrollLeft / pxPerBar));
        const lastBar = Math.ceil((props.scrollLeft + props.width) / pxPerBar);
        const line = (x: number, color: string, width = 1) => {
            context.beginPath();
            context.strokeStyle = color;
            context.lineWidth = width;
            context.moveTo(crispLineX(x), 0);
            context.lineTo(crispLineX(x), props.height);
            context.stroke();
        };
        for (let bar = firstBar; bar <= lastBar; bar++) {
            const barX = bar * pxPerBar - props.scrollLeft;
            if (bar % ladder.barStride === 0) {
                context.globalAlpha = props.gridUnit === 'none' ? 0.6 : 1;
                line(barX, styles.getPropertyValue('--timeline-grid-bar'));
                context.globalAlpha = 1;
            }
            if (ladder.drawBeats) {
                for (let beat = 1; beat < props.beatsPerBar; beat++) {
                    line(barX + beat * pxPerBar / props.beatsPerBar, styles.getPropertyValue('--timeline-grid-beat'));
                }
            }
            if (ladder.drawSubdivisions) {
                const divisions = props.gridUnit === '1/8t' ? 12 : props.gridUnit === '1/16' || props.gridUnit === 'adaptive' ? 16 : props.gridUnit === '1/8' ? 8 : 4;
                for (let sub = 1; sub < divisions; sub++) {
                    if (sub % (divisions / props.beatsPerBar) === 0) continue;
                    line(barX + sub * pxPerBar / divisions, styles.getPropertyValue('--timeline-grid-sub'));
                }
            }
        }
        context.setLineDash([4, 4]);
        context.globalAlpha = 0.45;
        for (const section of props.sections) line(section.startTick * props.pxPerTick - props.scrollLeft, styles.getPropertyValue('--timeline-section-marker'), 2);
        context.globalAlpha = 1;
        context.setLineDash([]);
    }, [props]);
    return <canvas ref={ref} className="arrangement-grid-layer" aria-hidden="true" style={{ width: props.width, height: props.height }} />;
}
