/**
 * Transport Store - Global transport state for continuous audio sources
 *
 * Controls play/pause for continuous audio sources (Loopers) while allowing
 * live instruments to still be played.
 */

import { create } from 'zustand';
import { getExecutor } from '../audio/executor';

// ============================================================================
// Store Interface
// ============================================================================

interface TransportStore {
    // State
    isGloballyPaused: boolean;

    // Actions
    toggleGlobalPause: () => void;
    pause: () => void;
    resume: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useTransportStore = create<TransportStore>((set, get) => ({
    isGloballyPaused: false,

    toggleGlobalPause: () => {
        const { isGloballyPaused } = get();
        if (isGloballyPaused) {
            get().resume();
        } else {
            get().pause();
        }
    },

    pause: () => {
        getExecutor().pauseContinuousSources();
        set({ isGloballyPaused: true });
    },

    resume: () => {
        getExecutor().resumeContinuousSources();
        set({ isGloballyPaused: false });
    },
}));
