/**
 * HintBubble — the beginner's one sentence, on the canvas, next to the rig.
 *
 * It replaces the first-run Sonner toast, which appeared in the corner opposite
 * everything it was talking about and disappeared after twelve seconds whether
 * or not it had been read. This sits where the thing it describes is, stays
 * until it is dismissed, and never comes back. It is shown ONLY to the "first
 * time" persona: a player who told us they have years of it does not need to be
 * reassured that nothing can break.
 */

import { useGraphStore } from '../../store/graphStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import './HintBubble.css';

export function HintBubble() {
    const answers = useOnboardingStore((state) => state.answers);
    const hintDismissed = useOnboardingStore((state) => state.hintDismissed);
    const dismissHint = useOnboardingStore((state) => state.dismissHint);
    /*
     * "This rig is already making sound" was asserted with no rig-existence
     * check, so on an empty canvas the app's most prominent audio claim was
     * about a rig that was not there and keys that could not be pressed
     * (HA-04). The claim is now gated on there being something to claim it
     * about; with nothing on the paper, the empty state speaks instead.
     */
    const hasRig = useGraphStore((state) => state.nodes.size > 0);

    if (answers?.exp !== 'first' || hintDismissed || !hasRig) return null;

    return (
        <div className="oj-hint-bubble" role="status">
            <span>
                Press a key — nothing here can break. Drag a node, turn a knob; Ctrl+Z takes anything back.
            </span>
            <button type="button" className="oj-hint-bubble__close" aria-label="Dismiss" onClick={dismissHint}>
                ✕
            </button>
        </div>
    );
}
