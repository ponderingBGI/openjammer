export type GestureSurface = 'arrangement' | 'pianoroll';

interface PointerGestureLifetime {
    move?: (event: PointerEvent) => void;
    commit: (event: PointerEvent) => void;
    abort: (event?: PointerEvent) => void;
}

const ownedPointerGestureAborts = new Map<GestureSurface, Set<() => void>>();

function abortsFor(surface: GestureSurface) {
    let aborts = ownedPointerGestureAborts.get(surface);
    if (!aborts) {
        aborts = new Set();
        ownedPointerGestureAborts.set(surface, aborts);
    }
    return aborts;
}

export function abortOwnedPointerGestures(surface: GestureSurface = 'arrangement') {
    for (const abort of [...(ownedPointerGestureAborts.get(surface) ?? [])]) abort();
}

export function ownPointerGesture(pointerId: number, handlers: PointerGestureLifetime, surface: GestureSurface = 'arrangement'): () => void {
    let live = true;
    const finish = (kind: 'commit' | 'abort', event?: PointerEvent) => {
        if (!live) return;
        if (kind === 'commit' && event) handlers.commit(event);
        else handlers.abort(event);
    };
    const move = (event: PointerEvent) => { if (live && event.pointerId === pointerId) handlers.move?.(event); };
    const commit = (event: PointerEvent) => { if (event.pointerId === pointerId) finish('commit', event); };
    const abort = (event: PointerEvent) => { if (event.pointerId === pointerId) finish('abort', event); };
    const blur = () => finish('abort');
    const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish('abort');
    };
    const abortOwned = () => finish('abort');
    abortsFor(surface).add(abortOwned);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape);
    return () => {
        if (!live) return;
        live = false;
        const aborts = ownedPointerGestureAborts.get(surface);
        aborts?.delete(abortOwned);
        if (aborts?.size === 0) ownedPointerGestureAborts.delete(surface);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', commit);
        window.removeEventListener('pointercancel', abort);
        window.removeEventListener('blur', blur);
        window.removeEventListener('keydown', escape);
    };
}

export const POINTER_DRAG_THRESHOLD_PX = 4;
export const COPY_DRAG_X_THRESHOLD_PX = 12;
export const COARSE_POINTER_THRESHOLD_SCALE = 1.75;
export type GestureAxis = 'horizontal' | 'vertical';

export function gestureThreshold(pointerType: string, copy: boolean) {
    const scale = pointerType === 'touch' || pointerType === 'pen' ? COARSE_POINTER_THRESHOLD_SCALE : 1;
    return { x: (copy ? COPY_DRAG_X_THRESHOLD_PX : POINTER_DRAG_THRESHOLD_PX) * scale, y: POINTER_DRAG_THRESHOLD_PX * scale };
}

export function thresholdAxis(dx: number, dy: number, pointerType: string, copy: boolean): GestureAxis | null {
    const threshold = gestureThreshold(pointerType, copy);
    if (Math.abs(dx) < threshold.x && Math.abs(dy) < threshold.y) return null;
    return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

export function createRafPreview<T>(render: (value: T) => void) {
    let frame: number | null = null;
    let latest: T | undefined;
    return {
        schedule(value: T) {
            latest = value;
            if (frame != null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                const valueToRender = latest;
                latest = undefined;
                if (valueToRender !== undefined) render(valueToRender);
            });
        },
        flush() {
            if (frame != null) cancelAnimationFrame(frame);
            frame = null;
            const valueToRender = latest;
            latest = undefined;
            if (valueToRender !== undefined) render(valueToRender);
        },
        cancel() {
            if (frame != null) cancelAnimationFrame(frame);
            frame = null;
            latest = undefined;
        },
    };
}
