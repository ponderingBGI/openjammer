/**
 * Transport Store — the ONE transport gesture, and the continuous-source pause
 * underneath it.
 *
 * There is exactly one place in OpenJammer that answers "is it running?" — the
 * floating transport pill — and exactly one gesture that changes the answer
 * (Space, or the pill's play button). Both land here, so the key and the button
 * can never disagree about what they just did.
 *
 * What the gesture MEANS depends, honestly, on whether there is a song:
 *   • A Song exists → the arrangement IS the transport. Play/stop the song.
 *   • No Song → there is no timeline to roll, so the gesture is the global
 *     pause/resume for continuous sources (loopers), which is what it has always
 *     been on a bare canvas.
 *
 * {@link TransportStore.pause} / {@link TransportStore.resume} remain the raw
 * continuous-source verbs, reachable from the View menu even while a song owns
 * the transport, so consolidating the gesture never costs a capability.
 */

import { create } from 'zustand';
import { getExecutor } from '../audio/executor';
import { stopReturnsToOrigin, transportAwaitingEngine, useArrangementStore } from './arrangementStore';

// ============================================================================
// Store Interface
// ============================================================================

interface TransportStore {
    // State
    /** Continuous sources (loopers) are held. Independent of song playback. */
    isGloballyPaused: boolean;

    // Actions
    /**
     * The one transport gesture. Routes to the arrangement when a song exists,
     * otherwise toggles the continuous-source pause. Called by the transport
     * pill AND by Space on the canvas — they are the same act.
     */
    toggleGlobalPause: () => void;
    /** Hold continuous sources, whatever the song is doing. */
    pause: () => void;
    /** Release continuous sources. */
    resume: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useTransportStore = create<TransportStore>((set, get) => ({
    isGloballyPaused: false,

    toggleGlobalPause: () => {
        // A song owns the transport whenever one exists — on every surface,
        // including the canvas, because a rig with a Song in it is a song.
        const arrangement = useArrangementStore.getState();
        if (arrangement.arrangement) {
            // Spec §7 is a THREE-state grammar, not a toggle: rolling → Stop;
            // stopped away from where playback started → the second Stop, which
            // returns the playhead there; otherwise → Play. Asking only
            // `isPlaying` is what made "stop twice and you are back where you
            // started" unreachable from every shipped control.
            // The pill shows PLAY while the engine has not confirmed a start, so
            // the gesture has to mean play too — asking `isPlaying` here while
            // the glyph asked `transportAwaitingEngine` is exactly how a button
            // labelled Play came to stop the song (HA-03). Space and the button
            // read the same predicate, so they can never disagree.
            if (transportAwaitingEngine(arrangement)) { arrangement.retryTransport(); return; }
            if (arrangement.isPlaying || stopReturnsToOrigin(arrangement)) arrangement.stop();
            else arrangement.play();
            return;
        }
        if (get().isGloballyPaused) get().resume();
        else get().pause();
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

/**
 * Is anything actually rolling right now? The single source the transport pill's
 * glyph reads, so the button never claims a state the engine is not in.
 *
 * With a song: the song's own `isPlaying`. Without one: continuous sources are
 * running AND audio has actually been unlocked — before the browser's first
 * gesture nothing is making sound, and the button must say `Play`, not `Stop`.
 */
export function transportIsRolling(hasAudio: boolean): boolean {
    const arrangement = useArrangementStore.getState();
    if (arrangement.arrangement) return arrangement.isPlaying;
    return hasAudio && !useTransportStore.getState().isGloballyPaused;
}
