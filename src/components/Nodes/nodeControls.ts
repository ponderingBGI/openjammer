/**
 * The two hooks every faceplate in the utility/IO family needs and none of them
 * should hand-roll.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';

/**
 * One undo step per gesture, opened LAZILY.
 *
 * A knob is turned by pointer, by wheel and by Arrow keys, and only one of those
 * has a pointer-down to hang `beginGesture` on. So the bracket opens on the
 * first VALUE CHANGE, whatever produced it, and closes on the control's commit —
 * which `Knob` fires once per drag and once per settled key/wheel burst. Unmount
 * and window blur close it too: a gesture left open makes undo/redo refuse to
 * run (UI-015), which on stage is worse than a lost step.
 */
export function useGestureBracket() {
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const open = useRef(false);

    const begin = useCallback(() => {
        if (open.current) return;
        open.current = true;
        beginGesture();
    }, [beginGesture]);

    const end = useCallback(() => {
        if (!open.current) return;
        open.current = false;
        endGesture();
    }, [endGesture]);

    useEffect(() => {
        window.addEventListener('blur', end);
        return () => {
            window.removeEventListener('blur', end);
            end();
        };
    }, [end]);

    return { begin, end };
}

/**
 * Is this node currently refusing something? Pairs with the `.flashing` /
 * `.deletion-attempted` edge in `SchematicBase.css` and the `NodeFeedback`
 * sentence beside it.
 */
export function useNodeRefusal(nodeId: string): boolean {
    return useUIFeedbackStore((s) => s.flashingNodes.has(nodeId));
}
