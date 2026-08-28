interface PointerGestureLifetime {
    move?: (event: PointerEvent) => void;
    commit: (event: PointerEvent) => void;
    abort: (event?: PointerEvent) => void;
}

const ownedPointerGestureAborts = new Set<() => void>();

export function abortOwnedPointerGestures() {
    for (const abort of [...ownedPointerGestureAborts]) abort();
}

export function ownPointerGesture(pointerId: number, handlers: PointerGestureLifetime): () => void {
    const move = (event: PointerEvent) => { if (event.pointerId === pointerId) handlers.move?.(event); };
    const commit = (event: PointerEvent) => { if (event.pointerId === pointerId) handlers.commit(event); };
    const abort = (event: PointerEvent) => { if (event.pointerId === pointerId) handlers.abort(event); };
    const blur = () => handlers.abort();
    const abortOwned = () => handlers.abort();
    ownedPointerGestureAborts.add(abortOwned);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', blur);
    return () => {
        ownedPointerGestureAborts.delete(abortOwned);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', commit);
        window.removeEventListener('pointercancel', abort);
        window.removeEventListener('blur', blur);
    };
}
