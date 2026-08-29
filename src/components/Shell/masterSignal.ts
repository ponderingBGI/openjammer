/**
 * The master output level, for the transport pill's meter.
 *
 * There is no second analyser here and no second animation frame: this rides the
 * engine's existing per-node level stream and the app's ONE shared frame writer
 * (`Arrangement/sharedAnimationFrame`), which already drives the playhead, the
 * mixer meters and the track level beads. A meter that opened its own rAF loop
 * would be a parallel clock, and a parallel clock is how a UI starts fighting
 * the audio thread for a frame budget.
 *
 * WHAT "master" MEANS depends on what is playing, and both answers come from the
 * engine rather than from a guess:
 *   • A song is rolling → `conduct()` publishes the arrangement's master sink
 *     under the synthetic `__master__` address.
 *   • The canvas is live → the master IS the speaker node (the same address
 *     `SpeakerNode` renders its own meter from). With several speakers, the
 *     loudest is the honest reading of "how loud is this getting".
 *
 * The value is published on a dB SCALE, not raw RMS. A linear meter is a lie
 * dressed as precision: a comfortably loud held note reads about 0.02 RMS, which
 * on a linear bar is indistinguishable from silence, and everything interesting a
 * performer needs to see happens in the top few percent. Mapping -60…0 dBFS onto
 * 0…1 puts the useful range where the eye is, and keeps 0 dBFS at exactly 1.0 so
 * the meter's clip latch still means what it says.
 *
 * Nothing here writes to a store, so a level change costs one style property and
 * zero React work.
 */

import { registerTimelineLevelWriter } from '../Arrangement/timelineSignalLevels';
import { useGraphStore } from '../../store/graphStore';

/** The engine's synthetic address for the arrangement's master sink. */
const MASTER_KEY = '__master__';

/** The bottom of the meter's scale. Below this the bars sit at their floor. */
const FLOOR_DB = -60;

/** Linear amplitude -> the 0..1 the meter draws. 0 dBFS lands exactly on 1. */
export function meterScale(level: number): number {
    if (!Number.isFinite(level) || level <= 0) return 0;
    const db = 20 * Math.log10(level);
    return Math.max(0, Math.min(1, 1 + db / -FLOOR_DB));
}

/**
 * Subscribe to the master level. `write` is called once per animation frame with
 * a 0..1 value; the caller is expected to put it straight onto the DOM.
 * Returns an unsubscribe.
 */
export function subscribeMasterSignal(write: (level: number) => void): () => void {
    // The speaker ids change only when the graph does, so resolve them on graph
    // changes rather than scanning the node map 60 times a second.
    let speakerIds: string[] = useGraphStore
        .getState()
        .getNodesByType('speaker')
        .map((node) => node.id);
    let lastNodes = useGraphStore.getState().nodes;

    const unsubscribeGraph = useGraphStore.subscribe((state) => {
        if (state.nodes === lastNodes) return;
        lastNodes = state.nodes;
        speakerIds = state.getNodesByType('speaker').map((node) => node.id);
    });

    const unsubscribeLevels = registerTimelineLevelWriter((levels) => {
        const master = levels.get(MASTER_KEY);
        if (master !== undefined) {
            write(meterScale(master));
            return;
        }
        let peak = 0;
        for (const id of speakerIds) {
            const level = levels.get(id);
            if (level !== undefined && level > peak) peak = level;
        }
        write(meterScale(peak));
    });

    return () => {
        unsubscribeGraph();
        unsubscribeLevels();
    };
}
