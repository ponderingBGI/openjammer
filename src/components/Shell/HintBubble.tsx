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

import { useOnboardingStore } from '../../store/onboardingStore';
import './HintBubble.css';

export function HintBubble() {
    const answers = useOnboardingStore((state) => state.answers);
    const hintDismissed = useOnboardingStore((state) => state.hintDismissed);
    const dismissHint = useOnboardingStore((state) => state.dismissHint);

    if (answers?.exp !== 'first' || hintDismissed) return null;

    return (
        <div className="oj-hint-bubble" role="status">
            <span>
                This rig is already making sound — drag a node, turn a knob, press the keys. Nothing can break.
            </span>
            <button type="button" className="oj-hint-bubble__close" aria-label="Dismiss" onClick={dismissHint}>
                ✕
            </button>
        </div>
    );
}
