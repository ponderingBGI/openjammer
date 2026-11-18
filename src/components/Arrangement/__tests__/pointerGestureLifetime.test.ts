import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { abortOwnedPointerGestures, createRafPreview, gestureThreshold, ownPointerGesture, thresholdAxis } from '../pointerGestureLifetime';

beforeAll(() => {
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
        }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
});

afterEach(() => {
    abortOwnedPointerGestures('arrangement');
    abortOwnedPointerGestures('pianoroll');
    vi.useRealTimers();
});

describe('pointer gesture lifetime', () => {
    it('routes only the owned pointer and ignores lost capture', () => {
        const move = vi.fn();
        const commit = vi.fn();
        const abort = vi.fn();
        const cleanup = ownPointerGesture(7, { move, commit, abort });
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8 }));
        window.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7 }));
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7 }));
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
        expect(move).toHaveBeenCalledOnce();
        expect(commit).toHaveBeenCalledOnce();
        expect(abort).not.toHaveBeenCalled();
        cleanup();
    });

    it('scopes teardown aborts to one surface', () => {
        const arrangementAbort = vi.fn();
        const pianoAbort = vi.fn();
        const cleanArrangement = ownPointerGesture(1, { commit: vi.fn(), abort: arrangementAbort }, 'arrangement');
        const cleanPiano = ownPointerGesture(2, { commit: vi.fn(), abort: pianoAbort }, 'pianoroll');
        abortOwnedPointerGestures('arrangement');
        expect(arrangementAbort).toHaveBeenCalledOnce();
        expect(pianoAbort).not.toHaveBeenCalled();
        cleanArrangement();
        cleanPiano();
    });

    it.each(['pointercancel', 'blur', 'Escape'] as const)('aborts on %s', (cause) => {
        const abort = vi.fn();
        const cleanup = ownPointerGesture(3, { commit: vi.fn(), abort });
        if (cause === 'blur') window.dispatchEvent(new Event('blur'));
        else if (cause === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        else window.dispatchEvent(new PointerEvent(cause, { pointerId: 3 }));
        expect(abort).toHaveBeenCalledOnce();
        cleanup();
    });
});

describe('gesture motion laws', () => {
    it('uses coarse and copy thresholds and freezes an axis at crossing', () => {
        expect(gestureThreshold('mouse', false)).toEqual({ x: 4, y: 4 });
        expect(gestureThreshold('touch', false)).toEqual({ x: 7, y: 7 });
        expect(gestureThreshold('mouse', true)).toEqual({ x: 12, y: 4 });
        expect(thresholdAxis(11, 3, 'mouse', true)).toBeNull();
        expect(thresholdAxis(12, 3, 'mouse', true)).toBe('horizontal');
        expect(thresholdAxis(3, 7, 'touch', false)).toBe('vertical');
    });

    it('coalesces previews into one animation frame and flushes the latest value', () => {
        vi.useFakeTimers();
        const render = vi.fn();
        const preview = createRafPreview(render);
        preview.schedule(1);
        preview.schedule(2);
        preview.schedule(3);
        expect(render).not.toHaveBeenCalled();
        preview.flush();
        expect(render).toHaveBeenCalledOnce();
        expect(render).toHaveBeenCalledWith(3);
    });
});
