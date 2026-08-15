import { create } from 'zustand';

export interface PitchRange {
    lo: number;
    hi: number;
}

const EMPTY_RANGE: PitchRange = { lo: 48, hi: 72 };

export function initialPitchRange(min: number, max: number): PitchRange {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return EMPTY_RANGE;
    if (min === max) return { lo: min - 6, hi: max + 6 };
    return { lo: min - 1, hi: max + 1 };
}

export function growPitchRange(range: PitchRange, min: number, max: number): PitchRange {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return range;
    const lo = min < range.lo ? min - 1 : range.lo;
    const hi = max > range.hi ? max + 1 : range.hi;
    return lo === range.lo && hi === range.hi ? range : { lo, hi };
}

interface TrackLaneViewStore {
    pitchRanges: Record<string, PitchRange>;
    rememberPitchRange: (trackId: string, range: PitchRange) => void;
    resetPitchRanges: () => void;
}

export const useTrackLaneViewStore = create<TrackLaneViewStore>((set) => ({
    pitchRanges: {},
    rememberPitchRange: (trackId, range) => {
        set((state) => {
            const current = state.pitchRanges[trackId];
            if (current?.lo === range.lo && current.hi === range.hi) return state;
            return { pitchRanges: { ...state.pitchRanges, [trackId]: range } };
        });
    },
    resetPitchRanges: () => set({ pitchRanges: {} }),
}));
