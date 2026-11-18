import { tickToBarBeat, type Timebase } from '../../song/time';

export function tickToPx(tick: number, leftTick: number, pxPerTick: number): number {
    return (tick - leftTick) * pxPerTick;
}

export function clipGeometry(startTick: number, lengthTick: number, leftTick: number, pxPerTick: number) {
    return {
        left: tickToPx(startTick, leftTick, pxPerTick),
        width: Math.max(1, lengthTick * pxPerTick),
    };
}

/** Bars occupied by [startTick, endTick): an end exactly on a bar line stays in the preceding bar. */
export function clipBarSpan(tb: Timebase, startTick: number, lengthTick: number): { startBar: number; endBar: number } {
    const startBar = tickToBarBeat(tb, startTick).bar;
    const endExclusive = startTick + Math.max(0, lengthTick);
    const lastOccupiedTick = endExclusive > startTick ? endExclusive - 1 : startTick;
    return { startBar, endBar: tickToBarBeat(tb, lastOccupiedTick).bar };
}

export interface VirtualizationWindow {
    offsets: number[];
    firstLane: number;
    lastLane: number;
    laneTop: number;
    visibleStartTick: number;
    visibleEndTick: number;
}

/** Pure arrangement viewport math shared by rendering and performance benches. */
export function virtualizationWindow(
    heights: readonly number[],
    view: { left: number; top: number; width: number; height: number },
    pxPerTick: number,
    headerWidth: number,
    rulerHeight: number,
): VirtualizationWindow {
    const offsets = new Array<number>(heights.length + 1);
    offsets[0] = 0;
    for (let index = 0; index < heights.length; index++) {
        offsets[index + 1] = offsets[index]! + heights[index]!;
    }
    const laneTop = Math.max(0, view.top - rulerHeight);
    const laneBottom = Math.max(laneTop, laneTop + Math.max(0, view.height - rulerHeight));
    let firstVisible = 0;
    while (firstVisible < heights.length && offsets[firstVisible + 1]! <= laneTop) firstVisible += 1;
    let lastVisible = firstVisible;
    while (lastVisible < heights.length && offsets[lastVisible]! < laneBottom) lastVisible += 1;
    const firstLane = heights.length === 0 ? 0 : Math.max(0, firstVisible - 1);
    const lastLane = Math.min(heights.length, Math.max(lastVisible + 1, view.height <= rulerHeight ? firstLane + 3 : firstLane + 1));
    const fieldViewportWidth = Math.max(1, view.width - headerWidth);
    return {
        offsets,
        firstLane,
        lastLane,
        laneTop,
        visibleStartTick: Math.max(0, view.left / pxPerTick),
        visibleEndTick: (view.left + fieldViewportWidth) / pxPerTick,
    };
}
