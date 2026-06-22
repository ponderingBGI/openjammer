/**
 * MIDI -> voice routing entry point (U13).
 *
 * Wires the {@link MIDIVoiceRouter} to the production singletons — the graph
 * store (node/connection state), the audio {@link Executor} seam, and the
 * {@link MIDIManager} — and exposes a single initialize/dispose pair the app
 * calls once at startup. The router itself stays singleton-free and injectable
 * (see {@link RoutingContext}) so it can be unit-tested with fakes.
 */

import { MIDIVoiceRouter } from './MIDIVoiceRouter';
import type { RoutingContext } from './types';
import { getMIDIManager } from '../MIDIManager';
import { getExecutor } from '../../audio/executor';
import { useGraphStore } from '../../store/graphStore';

export { MIDIVoiceRouter } from './MIDIVoiceRouter';
export type {
    RoutingContext,
    GraphAccess,
    VoiceExecutor,
    MIDISource,
    ResolvedVoice
} from './types';
export {
    midiNoteToRowKey,
    midiNoteToOctave,
    midiNotePitchClass,
    isRowKeyInRange,
    DEFAULT_ROW_OCTAVES,
    type RowKey
} from './noteMapping';

/** Build a {@link RoutingContext} from the production singletons. */
export function createDefaultRoutingContext(): RoutingContext {
    return {
        graph: {
            getNodes: () => useGraphStore.getState().nodes,
            getConnections: () => useGraphStore.getState().connections
        },
        executor: getExecutor(),
        midi: getMIDIManager()
    };
}

// Process-wide router singleton, mirroring the executor/MIDIManager pattern.
let router: MIDIVoiceRouter | null = null;

/**
 * Initialize MIDI -> voice routing. Idempotent: repeated calls return the same
 * router without re-subscribing. Call {@link disposeMidiVoiceRouting} to tear
 * down.
 */
export function initMidiVoiceRouting(
    ctx: RoutingContext = createDefaultRoutingContext()
): MIDIVoiceRouter {
    if (!router) {
        router = new MIDIVoiceRouter(ctx);
        router.start();
    }
    return router;
}

/**
 * The live router singleton, or null if routing has not been initialized. The
 * computer-keyboard sustain path (audioStore) uses this to drive the *same*
 * per-note {@link SustainController} as hardware CC64, so both share one
 * mechanism instead of forking parallel hold logic.
 */
export function getMidiVoiceRouter(): MIDIVoiceRouter | null {
    return router;
}

/** Tear down MIDI -> voice routing and release the subscription. */
export function disposeMidiVoiceRouting(): void {
    if (router) {
        router.stop();
        router = null;
    }
}
