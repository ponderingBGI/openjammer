/**
 * Is another tab holding this studio open?
 *
 * `localStorage` is origin-wide and last-writer-wins, and the emergency backup
 * lives there. Two tabs have always stomped each other's canvas; now that a
 * clean boot restores the SONG from that blob, the loser's song is what is
 * destroyed — silently, on the next reopen (UX-INV Q3 risk 3, gate G-12).
 *
 * The real fix is leader election over this channel. This is not that: it is the
 * warning that has to exist first, because "my song vanished" with no word is
 * the failure a performer cannot even report. Purely advisory — it changes no
 * behaviour, blocks nothing, and degrades to silence where `BroadcastChannel`
 * does not exist.
 *
 * A HEARTBEAT, not a hello/goodbye handshake. A goodbye has to survive the tab
 * that sends it being torn down mid-message, and it does not: measured in a real
 * browser, a closed tab left the chip on screen claiming a peer that was gone. A
 * tab that stops beating ages out on its own, which is the one protocol that
 * cannot lie in either direction.
 */

import { useEffect, useState } from 'react';

const CHANNEL = 'openjammer-studio-presence';
const BEAT_MS = 3_000;
/** Silence through this many of our own beats and a tab is gone. */
const MISSES_ALLOWED = 2;

export function useAnotherStudioOpen(): boolean {
    const [other, setOther] = useState(false);
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const me = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const channel = new BroadcastChannel(CHANNEL);
        // Missed beats per peer, counted against OUR OWN beat rather than a
        // wall clock: liveness is a question about this interval, and a clock
        // that can jump (a sleeping laptop, a throttled background tab) answers
        // it wrong in both directions.
        const missed = new Map<string, number>();
        const beat = () => {
            for (const [id, count] of missed) {
                if (count >= MISSES_ALLOWED) missed.delete(id);
                else missed.set(id, count + 1);
            }
            setOther(missed.size > 0);
            channel.postMessage({ from: me });
        };
        channel.onmessage = (event: MessageEvent<{ from?: string }>) => {
            const from = event.data?.from;
            if (typeof from !== 'string' || from === me) return;
            missed.set(from, 0);
            setOther(true);
        };
        channel.postMessage({ from: me });
        const timer = setInterval(beat, BEAT_MS);
        return () => { clearInterval(timer); channel.close(); };
    }, []);
    return other;
}
