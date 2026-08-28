import { create } from 'zustand';

export interface PitchRange {
    lo: number;
    hi: number;
}

const EMPTY_RANGE: PitchRange = { lo: 48, hi: 72 };
export const COLLAPSED_LANE_HEIGHT = 72;

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
    previousLaneHeights: Record<string, number>;
    expandedPianoRolls: Record<string, string>;
    automationLaneByTrack: Record<string, string>;
    mixerOpen: boolean;
    rememberPitchRange: (trackId: string, range: PitchRange) => void;
    setLaneHeight: (trackId: string, height: number) => void;
    resetPitchRanges: () => void;
    togglePianoRoll: (trackId: string, clipId: string) => void;
    closePianoRoll: (trackId: string) => void;
    showAutomationLane: (trackId: string, laneId: string | null) => void;
    toggleMixer: () => void;
}

export const useTrackLaneViewStore = create<TrackLaneViewStore>((set) => ({
    pitchRanges: {},
    laneHeights: {},
    previousLaneHeights: {},
    expandedPianoRolls: {},
    automationLaneByTrack: {},
    mixerOpen: false,
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
        const previousLaneHeights = { ...state.previousLaneHeights };
        if (open) {
            delete expandedPianoRolls[trackId];
            const restoredHeight = previousLaneHeights[trackId] ?? COLLAPSED_LANE_HEIGHT;
            delete previousLaneHeights[trackId];
            return {
                expandedPianoRolls,
                previousLaneHeights,
                laneHeights: { ...state.laneHeights, [trackId]: restoredHeight },
            };
        }
        expandedPianoRolls[trackId] = clipId;
        if (state.expandedPianoRolls[trackId] === undefined) {
            previousLaneHeights[trackId] = state.laneHeights[trackId] ?? COLLAPSED_LANE_HEIGHT;
        }
        return {
            expandedPianoRolls,
            previousLaneHeights,
            laneHeights: { ...state.laneHeights, [trackId]: Math.max(220, state.laneHeights[trackId] ?? COLLAPSED_LANE_HEIGHT) },
        };
    }),
    closePianoRoll: (trackId) => set((state) => {
        const expandedPianoRolls = { ...state.expandedPianoRolls };
        const previousLaneHeights = { ...state.previousLaneHeights };
        delete expandedPianoRolls[trackId];
        const restoredHeight = previousLaneHeights[trackId] ?? state.laneHeights[trackId] ?? COLLAPSED_LANE_HEIGHT;
        delete previousLaneHeights[trackId];
        return {
            expandedPianoRolls,
            previousLaneHeights,
            laneHeights: { ...state.laneHeights, [trackId]: restoredHeight },
        };
    }),
    showAutomationLane: (trackId, laneId) => set((state) => {
        const automationLaneByTrack = { ...state.automationLaneByTrack };
        if (laneId === null) delete automationLaneByTrack[trackId];
        else automationLaneByTrack[trackId] = laneId;
        return { automationLaneByTrack };
    }),
    toggleMixer: () => set((state) => ({ mixerOpen: !state.mixerOpen })),
}));
