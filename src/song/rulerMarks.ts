import type { GridUnit } from '../store/editingContextStore';

export interface GridLadder {
    barStride: number;
    labelStride: number;
    drawBeats: boolean;
    drawSubdivisions: boolean;
}

export function getGridLadder(pxPerBar: number, beatsPerBar: number, gridUnit: GridUnit): GridLadder {
    const barStride = pxPerBar >= 6 ? 1 : pxPerBar >= 3 ? 4 : 16;
    const labelStride = pxPerBar >= 34 ? 1 : pxPerBar >= 9 ? 4 : pxPerBar >= 3 ? 16 : 64;
    const drawBeats = gridUnit !== 'none' && pxPerBar / beatsPerBar >= 12;
    const divisions: Partial<Record<GridUnit, number>> = {
        adaptive: 16,
        bar: 1,
        '1/2': 2,
        '1/4': 4,
        '1/8': 8,
        '1/16': 16,
        '1/8t': 12,
    };
    const division = divisions[gridUnit] ?? 1;
    const drawSubdivisions = gridUnit !== 'none' && division > beatsPerBar && pxPerBar / division >= 9;
    return { barStride, labelStride, drawBeats, drawSubdivisions };
}

export function crispLineX(x: number): number {
    return Math.round(x) + 0.5;
}
