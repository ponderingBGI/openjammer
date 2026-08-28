export function tickToPx(tick: number, leftTick: number, pxPerTick: number): number {
    return (tick - leftTick) * pxPerTick;
}

export function clipGeometry(startTick: number, lengthTick: number, leftTick: number, pxPerTick: number) {
    return {
        left: tickToPx(startTick, leftTick, pxPerTick),
        width: Math.max(1, lengthTick * pxPerTick),
    };
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
    const laneBottom = laneTop + view.height - rulerHeight;
    const firstLane = Math.max(0, offsets.findIndex((_offset, index) => index < heights.length && offsets[index + 1]! >= laneTop) - 1);
    const computedLastLane = offsets.findIndex((offset) => offset > laneBottom) + 1 || heights.length;
    const lastLane = Math.min(heights.length, Math.max(firstLane + 3, computedLastLane));
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
