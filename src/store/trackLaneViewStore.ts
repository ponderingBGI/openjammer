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
    laneHeights: Record<string, number>;
    expandedPianoRolls: Record<string, string>;
    rememberPitchRange: (trackId: string, range: PitchRange) => void;
    setLaneHeight: (trackId: string, height: number) => void;
    resetPitchRanges: () => void;
    togglePianoRoll: (trackId: string, clipId: string) => void;
    closePianoRoll: (trackId: string) => void;
}

export const useTrackLaneViewStore = create<TrackLaneViewStore>((set) => ({
    pitchRanges: {},
    laneHeights: {},
    expandedPianoRolls: {},
    rememberPitchRange: (trackId, range) => {
        set((state) => {
            const current = state.pitchRanges[trackId];
            if (current?.lo === range.lo && current.hi === range.hi) return state;
            return { pitchRanges: { ...state.pitchRanges, [trackId]: range } };
        });
    },
    setLaneHeight: (trackId, height) => set((state) => ({
        laneHeights: { ...state.laneHeights, [trackId]: Math.max(28, Math.min(480, height)) },
    })),
    resetPitchRanges: () => set({ pitchRanges: {} }),
    togglePianoRoll: (trackId, clipId) => set((state) => {
        const open = state.expandedPianoRolls[trackId] === clipId;
        const expandedPianoRolls = { ...state.expandedPianoRolls };
        if (open) delete expandedPianoRolls[trackId];
        else expandedPianoRolls[trackId] = clipId;
        return {
            expandedPianoRolls,
            laneHeights: { ...state.laneHeights, [trackId]: open ? 72 : Math.max(220, state.laneHeights[trackId] ?? 72) },
        };
    }),
    closePianoRoll: (trackId) => set((state) => {
        const expandedPianoRolls = { ...state.expandedPianoRolls };
        delete expandedPianoRolls[trackId];
        return { expandedPianoRolls, laneHeights: { ...state.laneHeights, [trackId]: 72 } };
    }),
}));
