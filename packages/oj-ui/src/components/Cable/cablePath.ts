/** A point in canvas coordinates — the center of a port. */
export interface CablePoint {
    x: number;
    y: number;
}

/**
 * Build the cubic-bézier `d` string for a cable. Control points are pushed
 * horizontally out from each end by half the run (capped), giving the gentle
 * S-curve a patch cable settles into. This is the one home for the math that
 * `ConnectionPath` and `renderTempConnection` used to duplicate.
 */
export function cablePath(start: CablePoint, end: CablePoint): string {
    const dx = end.x - start.x;
    const controlOffset = Math.min(Math.abs(dx) / 2, 100);
    return (
        `M ${start.x} ${start.y} ` +
        `C ${start.x + controlOffset} ${start.y}, ` +
        `${end.x - controlOffset} ${end.y}, ` +
        `${end.x} ${end.y}`
    );
}
