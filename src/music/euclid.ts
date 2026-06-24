// src/music/euclid.ts — Euclidean rhythms + simple arpeggios (pure). The agent
// composes patterns by CALLING these instead of hand-placing every hit.

/**
 * A Euclidean rhythm: spread `pulses` hits as evenly as possible across `steps`
 * positions (Bjorklund). Returns a boolean[] of length `steps` (true = a hit).
 * `rotation` rotates the pattern left so the downbeat can land where you want.
 */
export function euclid(pulses: number, steps: number, rotation = 0): boolean[] {
    const s = Math.max(1, Math.floor(steps));
    const p = Math.max(0, Math.min(Math.floor(pulses), s));
    const out: boolean[] = [];
    // The classic running-accumulator construction: even, deterministic spread.
    let bucket = 0;
    for (let i = 0; i < s; i++) {
        bucket += p;
        if (bucket >= s) {
            bucket -= s;
            out.push(true);
        } else {
            out.push(false);
        }
    }
    const r = ((rotation % s) + s) % s;
    return out.slice(r).concat(out.slice(0, r));
}

/** Indices (0-based step positions) of the hits in a Euclidean pattern. */
export function euclidHits(pulses: number, steps: number, rotation = 0): number[] {
    return euclid(pulses, steps, rotation)
        .map((hit, i) => (hit ? i : -1))
        .filter((i) => i >= 0);
}

export type ArpStyle = 'up' | 'down' | 'updown' | 'downup';

/** Arpeggiate a chord into a pitch sequence of `length` notes in the given style. */
export function arpeggiate(chord: number[], length: number, style: ArpStyle = 'up'): number[] {
    if (chord.length === 0) return [];
    let order: number[];
    switch (style) {
        case 'down':
            order = [...chord].reverse();
            break;
        case 'updown':
            order = [...chord, ...[...chord].reverse().slice(1, -1)];
            break;
        case 'downup': {
            const d = [...chord].reverse();
            order = [...d, ...[...chord].slice(1, -1)];
            break;
        }
        default:
            order = [...chord];
    }
    if (order.length === 0) order = [...chord];
    return Array.from({ length }, (_, i) => order[i % order.length]!);
}
