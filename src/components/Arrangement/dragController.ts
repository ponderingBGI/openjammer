export const DRAG_THRESHOLD_PX = 4;
export const COPY_DRAG_X_THRESHOLD_PX = 12;

export type DragAxis = 'horizontal' | 'vertical';

export function crossedDragThreshold(dx: number, dy: number, copy: boolean, uiScale = 1): boolean {
    return Math.abs(dx) >= (copy ? COPY_DRAG_X_THRESHOLD_PX : DRAG_THRESHOLD_PX) * uiScale || Math.abs(dy) >= DRAG_THRESHOLD_PX * uiScale;
}

export function dominantAxis(dx: number, dy: number): DragAxis {
    return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

export function autoScrollDelta(pointer: number, start: number, end: number): number {
    const edge = 28;
    if (pointer < start) return -Math.min(22, 4 + (start - pointer) * 0.18);
    if (pointer > end) return Math.min(22, 4 + (pointer - end) * 0.18);
    if (pointer < start + edge) return -Math.max(0, (start + edge - pointer) / edge * 8);
    if (pointer > end - edge) return Math.max(0, (pointer - (end - edge)) / edge * 8);
    return 0;
}
