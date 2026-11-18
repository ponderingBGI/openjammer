import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTimelineFrameWriter, timelineFrameWriterCountForTests } from '../sharedAnimationFrame';

describe('shared timeline animation frame', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('runs every writer from one scheduled frame and stops when empty', () => {
        const callbacks: FrameRequestCallback[] = [];
        const cancel = vi.fn();
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; }));
        vi.stubGlobal('cancelAnimationFrame', cancel);
        const a = vi.fn();
        const b = vi.fn();
        const offA = registerTimelineFrameWriter(a);
        const offB = registerTimelineFrameWriter(b);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(timelineFrameWriterCountForTests()).toBe(2);
        callbacks[0]!(16);
        expect(a).toHaveBeenCalledWith(16);
        expect(b).toHaveBeenCalledWith(16);
        offA(); offB();
        expect(timelineFrameWriterCountForTests()).toBe(0);
        expect(cancel).toHaveBeenCalled();
    });
});
