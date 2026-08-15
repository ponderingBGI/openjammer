export function tickToPx(tick: number, leftTick: number, pxPerTick: number): number {
    return (tick - leftTick) * pxPerTick;
}

export function clipGeometry(startTick: number, lengthTick: number, leftTick: number, pxPerTick: number) {
    return {
        left: tickToPx(startTick, leftTick, pxPerTick),
        width: Math.max(1, lengthTick * pxPerTick),
    };
}
