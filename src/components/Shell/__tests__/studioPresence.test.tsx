/**
 * G-12 — being told that another tab holds the studio.
 *
 * `localStorage` is origin-wide and last-writer-wins, and the song now comes
 * back out of it on every clean boot, so a second tab does not merely stomp a
 * patch — it destroys a song, silently. Leader election is the fix and is not
 * here. This is the warning that has to exist first.
 *
 * The protocol is a heartbeat because a goodbye has to survive the tab that
 * sends it being torn down mid-message, and it does not: a closed tab left the
 * chip on screen claiming a peer that was gone (measured in the browser).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAnotherStudioOpen } from '../studioPresence';

/** A minimal same-origin BroadcastChannel, since jsdom has none. */
class TestChannel {
    static open: TestChannel[] = [];
    name: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    closed = false;
    constructor(name: string) { this.name = name; TestChannel.open.push(this); }
    postMessage(data: unknown) {
        for (const peer of TestChannel.open) {
            if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.({ data });
        }
    }
    close() { this.closed = true; }
}

/** A peer tab that beats on the same channel until it is told to stop. */
function peerTab(id: string) {
    const channel = new TestChannel('openjammer-studio-presence');
    const beat = () => channel.postMessage({ from: id });
    const timer = setInterval(beat, 3_000);
    beat();
    return { leave: () => { clearInterval(timer); channel.close(); } };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('BroadcastChannel', TestChannel); });
afterEach(() => { cleanup(); TestChannel.open.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('useAnotherStudioOpen', () => {
    it('is false when this tab is the only one', () => {
        const { result } = renderHook(() => useAnotherStudioOpen());
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(result.current).toBe(false);
    });

    it('is true while a second tab is beating', () => {
        const { result } = renderHook(() => useAnotherStudioOpen());
        const other = peerTab('tab-b');

        act(() => { vi.advanceTimersByTime(3_500); });

        expect(result.current).toBe(true);
        other.leave();
    });

    /*
     * The case the browser run caught: `page.close()` never delivered a goodbye,
     * and the chip went on claiming a tab that was gone. A tab that stops
     * beating ages out on its own.
     */
    it('goes quiet again once that tab stops beating', () => {
        const { result } = renderHook(() => useAnotherStudioOpen());
        const other = peerTab('tab-b');
        act(() => { vi.advanceTimersByTime(3_500); });
        expect(result.current).toBe(true);

        other.leave();
        // Three of our own beats: two are forgiven (a throttled background tab
        // must not read as a closed one), the third ages it out.
        act(() => { vi.advanceTimersByTime(12_000); });

        expect(result.current).toBe(false);
    });

    it('stays true while any peer is still there', () => {
        const { result } = renderHook(() => useAnotherStudioOpen());
        const leaver = peerTab('leaver');
        const survivor = peerTab('survivor');
        act(() => { vi.advanceTimersByTime(3_500); });

        leaver.leave();
        act(() => { vi.advanceTimersByTime(12_000); });

        expect(result.current).toBe(true);
        survivor.leave();
    });

    it('degrades to silence where BroadcastChannel does not exist', () => {
        vi.stubGlobal('BroadcastChannel', undefined);
        const { result } = renderHook(() => useAnotherStudioOpen());
        expect(result.current).toBe(false);
    });
});
