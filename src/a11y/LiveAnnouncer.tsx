/**
 * The app's one POLITE live region for player verbs (U12 / HA-07 + HA-09).
 *
 * Measured across add-node, undo, Space, Ctrl+S, theme change and disconnect,
 * *no* user-facing verb produced a confirmation of any kind, and the app's only
 * live region never said anything but "Canvas surface active". This one closes
 * that: every entry the unified history records, undoes or redoes is spoken by
 * name, once, politely.
 *
 * Three deliberate constraints:
 *
 *  - **No toasts.** A routine verb that throws a card on the stage is worse than
 *    silence mid-set. The visible half of the feedback is SELECTION (the palette
 *    now selects the card it just made); this is the spoken half.
 *  - **Portalled to `document.body`.** The surfaces that are not active carry
 *    `inert` + `aria-hidden`, and a live region inside one of them would go
 *    silent exactly when the player switched away from it.
 *  - **Subscribed to the STORE, not wired into call sites.** One seam names every
 *    verb — including the ones a future lane adds — instead of thirty call sites
 *    remembering to announce.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHistoryStore } from '../store/historyStore';
import { useGraphStore } from '../store/graphStore';
import { resolveNodeDefinition } from '../engine/registry';
import { describeHistoryEntry } from './historyPhrase';
import { subscribeAnnounce } from './announce';

/** The words on a node's card, for a sentence about it. */
function nodeName(nodeId: string): string | undefined {
    const node = useGraphStore.getState().nodes.get(nodeId);
    return node ? resolveNodeDefinition(node).name : undefined;
}

/** The no-break space that makes a repeat a different string, not a different sentence. */
const PAD = '\u00A0';

/**
 * How many recent renders a new announcement must differ from.
 *
 * Two, because of the cycle this exists for: `Ctrl+Z` -> `Ctrl+Shift+Z` ->
 * `Ctrl+Z` renders "Undo X", "Redo X", "Undo X", and the first and third are two
 * steps apart. One step of memory (or a parity bit, which is what shipped and
 * what the gate caught) cannot see that far.
 */
const RECENT = 2;

export function LiveAnnouncer() {
    /*
     * The padding is not decoration. A screen reader ignores a live region whose
     * text is byte-identical to what it already read, and React's key does not
     * help — the DOM node itself has to change text. A trailing no-break space
     * changes the string without changing a single spoken word.
     *
     * What shipped first derived that space from `nonce % 2` over ALL
     * announcements, which is exactly wrong for the case it exists for: any two
     * identical messages separated by an EVEN number of others render
     * byte-identical. Measured at gate time on the commonest cycle in the app —
     * "Undo Add Speaker", "Redo Add Speaker ", "Undo Add Speaker".
     *
     * So `seq` is monotonic (it makes every announcement a fresh state object, so
     * React always commits) but it does NOT choose the padding. The padding is
     * chosen against a short window of what was actually RENDERED, so a repeat is
     * guaranteed a different string whether it follows immediately or two steps
     * later. `recent` is a plain array in state, oldest last; the whole decision
     * happens inside the updater, so nothing is mutated during a render and
     * StrictMode's double-invoke is harmless.
     */
    const [announcement, setAnnouncement] = useState<{ spoken: string; seq: number; recent: string[] }>({
        spoken: '',
        seq: 0,
        recent: [],
    });

    /** Queue one message, padded just enough to be a new string. */
    const say = useCallback((text: string) => {
        if (!text) return;
        setAnnouncement((current) => {
            // Prefer the bare sentence; pad it only when that would repeat one of
            // the last renders. One bit is always enough to clear the MOST recent,
            // which is the hard requirement, and clears the window whenever the
            // two recent entries are not the two variants of these same words.
            const bare = text;
            const padded = `${text}${PAD}`;
            const spoken = !current.recent.includes(bare)
                ? bare
                : (!current.recent.includes(padded) ? padded : (current.recent[0] === bare ? padded : bare));
            return {
                spoken,
                seq: current.seq + 1,
                recent: [spoken, ...current.recent].slice(0, RECENT),
            };
        });
    }, []);

    useEffect(() => {
        return useHistoryStore.subscribe((state, previous) => {
            if (state.cursor === previous.cursor && state.entries === previous.entries) return;

            if (state.cursor > previous.cursor) {
                const entry = state.entries[state.cursor - 1];
                if (!entry) return;
                const phrase = describeHistoryEntry(entry, nodeName);
                // A NEW entry means the player did something; an unchanged entry
                // list with an advanced cursor is a redo.
                const isRedo = state.entries.length === previous.entries.length
                    && previous.entries[previous.cursor] === entry;
                say(isRedo ? `Redo ${phrase.name}` : phrase.done);
                return;
            }

            const undone = previous.entries[previous.cursor - 1];
            if (!undone) return;
            const phrase = describeHistoryEntry(undone, nodeName);
            say(`Undo ${phrase.name}`);
        });
    }, [say]);

    // The second source: gesture moments that record no history and would
    // otherwise be silence (arming a cable, a refused connection).
    useEffect(() => subscribeAnnounce(say), [say]);

    return createPortal(
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-history-live>
            {announcement.spoken}
        </div>,
        document.body,
    );
}
