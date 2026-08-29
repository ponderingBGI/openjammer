export type DragAxis = 'horizontal' | 'vertical';

export function autoScrollDelta(pointer: number, start: number, end: number): number {
    const edge = 28;
    if (pointer < start) return -Math.min(22, 4 + (start - pointer) * 0.18);
    if (pointer > end) return Math.min(22, 4 + (pointer - end) * 0.18);
    if (pointer < start + edge) return -Math.max(0, (start + edge - pointer) / edge * 8);
    if (pointer > end - edge) return Math.max(0, (pointer - (end - edge)) / edge * 8);
    return 0;
}
