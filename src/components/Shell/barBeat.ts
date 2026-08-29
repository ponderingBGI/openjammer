/**
 * Reading a position the way a musician writes one.
 *
 * The transport pill's readout is click-to-type, and what a player types is
 * `12`, `12.3` or `12.3.240` — never a tick. This is the one place that turns
 * that back into ticks. Bars and beats are 1-based on the page and 0-based
 * underneath, which is the whole reason this needs a name instead of being
 * inlined in a handler.
 *
 * Anything unreadable returns `null` rather than a guess: seeking somewhere the
 * player did not ask for is worse than not seeking at all.
 */
export function parseBarBeat(text: string, ticksPerBar: number, ticksPerBeat: number): number | null {
    const parts = text.trim().split('.');
    if (parts.length === 0 || parts.length > 3) return null;
    const numbers = parts.map((part) => Number.parseFloat(part));
    if (numbers.some((value) => !Number.isFinite(value))) return null;
    const [bar = 1, beat = 1, tick = 0] = numbers;
    return Math.max(0, (bar - 1) * ticksPerBar + (beat - 1) * ticksPerBeat + tick);
}
